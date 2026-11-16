/** Purpose-scoped, loopback-only installation maintenance. The running server is the sole writer. */
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Hono } from 'hono';
import type { AppHonoEnv } from './app.js';
import type { AppEnv } from './env.js';
import type { HiveAdminAccountReceipt, StoreState, UserRecord } from './domain.js';
import type { StateStore } from './store.js';
import type { AuditLogService } from './services.js';
import { hashPassword, safeEqualText } from './security.js';
import { badRequest, conflict, createId, forbidden, notFound } from '../shared/mattermost.js';

const operationIdSchema = z.uuid();
export const hiveAdminAccountRequestSchema = z.object({
  version: z.literal(1),
  issuer: z.url().max(2048).refine(value => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  }),
  subject: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
  user_id: z.string().regex(/^[a-z0-9]{26}$/u),
  username: z.string().min(2).max(64).regex(/^[a-z0-9._-]{2,64}$/u),
  email: z.email().max(320).transform(value => value.toLowerCase())
}).strict();
type Request = z.infer<typeof hiveAdminAccountRequestSchema>;
const ADMIN_ROLES = 'system_admin system_user';
const ROLE_SET = ['system_admin', 'system_user'];
function digest(request: Request): string {
  return createHash('sha256').update(JSON.stringify({ domain: 'chattermost.hive-admin-account.v1',
    version: request.version, issuer: request.issuer, subject: request.subject, user_id: request.user_id,
    username: request.username, email: request.email, role: ADMIN_ROLES })).digest('hex');
}
/** Fail closed on corrupted restore/input state, before any receipt can authorize a retry. */
export function validatedHiveAdminAccountReceipts(value: unknown): HiveAdminAccountReceipt[] {
  const receiptSchema = z.object({ operationId: operationIdSchema, userId: z.string().regex(/^[a-z0-9]{26}$/u),
    issuer: z.string(), subject: z.string(), username: z.string(), email: z.string(),
    requestSHA256: z.string().regex(/^[a-f0-9]{64}$/u), createAt: z.number().int().nonnegative() }).strict();
  const receipts = z.array(receiptSchema).max(10000).parse(value);
  const operations = new Set<string>(), users = new Set<string>(), identities = new Set<string>();
  for (const receipt of receipts) {
    const request = hiveAdminAccountRequestSchema.parse({ version: 1, issuer: receipt.issuer, subject: receipt.subject,
      user_id: receipt.userId, username: receipt.username, email: receipt.email });
    const identity = JSON.stringify([receipt.issuer, receipt.subject]);
    if (request.email !== receipt.email || digest(request) !== receipt.requestSHA256 || operations.has(receipt.operationId)
      || users.has(receipt.userId) || identities.has(identity)) throw new Error('Invalid retained Hive account provisioning authority');
    operations.add(receipt.operationId); users.add(receipt.userId); identities.add(identity);
  }
  return receipts;
}
function accountMatches(user: UserRecord | undefined, receipt: HiveAdminAccountReceipt): boolean {
  return user !== undefined && !user.isBot && user.deleteAt === 0 && user.disabledAt === 0
    && user.username === receipt.username && user.email === receipt.email
    && JSON.stringify(user.roles.split(/\s+/u).filter(Boolean).sort()) === JSON.stringify(ROLE_SET);
}
function response(receipt: HiveAdminAccountReceipt) {
  return { schema: 1, operation_id: receipt.operationId, user_id: receipt.userId, issuer: receipt.issuer,
    subject: receipt.subject, username: receipt.username, email: receipt.email, role: ADMIN_ROLES,
    status: 'committed', request_sha256: receipt.requestSHA256, created_at: receipt.createAt };
}

export class HiveAdminAccounts {
  public constructor(private readonly store: StateStore, private readonly env: Pick<AppEnv, 'OATHWEAVE_ISSUER' | 'OATHWEAVE_CHAT_IDENTITIES_JSON'>,
    private readonly audit: Pick<AuditLogService, 'enqueue' | 'publishPending'>) {}

  public read(operationId: string) {
    return this.store.read(state => {
      const receipt = state.hiveAdminAccountReceipts.find(item => item.operationId === operationId);
      if (!receipt) throw notFound('Provisioning operation');
      if (receipt.issuer !== this.env.OATHWEAVE_ISSUER) throw conflict('Provisioning receipt belongs to a different configured issuer');
      if (!accountMatches(state.users.find(user => user.id === receipt.userId), receipt))
        throw conflict('Provisioned account changed; review the retained operation without reactivating or replacing it');
      return response(receipt);
    });
  }

  public async provision(operationId: string, request: Request) {
    if (request.issuer !== this.env.OATHWEAVE_ISSUER) throw forbidden('Provisioning issuer must match the configured Oathweave issuer');
    const requestSHA256 = digest(request);
    // Never return or retain a recoverable native password. Oathweave signs this account in only
    // after Hive separately installs its explicitly reviewed issuer/subject link.
    const passwordHash = await hashPassword(randomBytes(48).toString('base64url'));
    const result = await this.store.write(state => {
      const prior = state.hiveAdminAccountReceipts.find(item => item.operationId === operationId);
      if (prior) {
        if (prior.requestSHA256 !== requestSHA256) throw conflict('Provisioning operation is bound to different inputs');
        if (!accountMatches(state.users.find(user => user.id === prior.userId), prior))
          throw conflict('Provisioned account changed; the original operation cannot restore its access');
        return response(prior);
      }
      if (state.hiveAdminAccountReceipts.length >= 10000) throw conflict('Provisioning receipt capacity requires reviewed maintenance');
      if (state.hiveAdminAccountReceipts.some(item => item.userId === request.user_id || item.issuer === request.issuer && item.subject === request.subject)
        || state.auditOutbox.some(item => item.operationId === operationId)
        || state.botOperationReceipts.some(item => item.operationId === operationId)) throw conflict('Identity or operation already belongs to another provisioning operation');
      if (state.users.some(user => user.id === request.user_id || user.username.toLowerCase() === request.username
        || user.email.toLowerCase() === request.email)) throw conflict('Native account identity already exists; accounts are never adopted');
      const links = z.array(z.object({ issuer: z.string(), subject: z.string(), localUserId: z.string() })).parse(JSON.parse(this.env.OATHWEAVE_CHAT_IDENTITIES_JSON));
      if (links.some(link => link.issuer === request.issuer && link.subject === request.subject || link.localUserId === request.user_id))
        throw conflict('Requested identity already has an account link');
      const now = Date.now();
      const user: UserRecord = { id: request.user_id, createAt: now, updateAt: now, deleteAt: 0,
        username: request.username, email: request.email, passwordHash, nickname: '', firstName: '', lastName: '', position: '',
        roles: ADMIN_ROLES, locale: 'en', timezone: { useAutomaticTimezone: 'true', automaticTimezone: '', manualTimezone: '' },
        notifyProps: { desktop: 'default', email: 'true', push: 'mention' }, lastPictureUpdate: 0,
        isBot: false, botDescription: '', disabledAt: 0 };
      state.users.push(user);
      state.statuses.push({ user_id: user.id, status: 'offline', manual: false, last_activity_at: now });
      this.defaultMemberships(state, user.id, now);
      const receipt: HiveAdminAccountReceipt = { operationId, userId: user.id, issuer: request.issuer, subject: request.subject,
        username: request.username, email: request.email, requestSHA256, createAt: now };
      state.hiveAdminAccountReceipts.push(receipt);
      this.audit.enqueue(state, { actorUserId: null, action: 'user.hive_provisioned', targetId: user.id,
        metadata: { authority: 'hive-admin-provisioning', request_sha256: requestSHA256 } }, operationId);
      return response(receipt);
    });
    await this.audit.publishPending();
    return result;
  }

  private defaultMemberships(state: StoreState, userId: string, now: number): void {
    const team = state.teams.find(item => item.name === 'supervised-chat' && item.deleteAt === 0 && item.type === 'O');
    if (!team) throw conflict('Default supervised team is unavailable; no account was created');
    state.teamMembers.push({ id: createId(), teamId: team.id, userId, roles: 'team_user', createAt: now, updateAt: now, deleteAt: 0 });
    for (const channel of state.channels.filter(item => item.teamId === team.id && item.type === 'O' && item.deleteAt === 0)) {
      state.channelMembers.push({ id: createId(), channelId: channel.id, userId, roles: 'channel_user', lastViewedAt: 0,
        msgCount: 0, mentionCount: 0, notifyProps: {}, lastUpdateAt: now, schemeUser: true, schemeAdmin: false });
    }
  }
}

export function registerHiveAdminAccountRoutes(app: Hono<AppHonoEnv>, env: AppEnv, accounts: HiveAdminAccounts): void {
  const route = '/internal/hive/admin-accounts/:operationId';
  app.use(route, async (c, next) => {
    if (!env.HIVE_ADMIN_PROVISIONING_SECRET) throw notFound('Route');
    const address = c.env?.incoming?.socket.remoteAddress;
    if (!address || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)
      || ['origin', 'referer', 'forwarded', 'x-forwarded-for', 'x-real-ip', 'cookie'].some(header => c.req.header(header) !== undefined)
      || c.req.header('authorization') !== undefined || !env.TLS_CERT_PATH || !env.TLS_KEY_PATH
      || !safeEqualText(c.req.header('x-hive-admin-provisioning-secret') ?? '', env.HIVE_ADMIN_PROVISIONING_SECRET))
      throw forbidden('Installation provisioning authority required');
    if (!operationIdSchema.safeParse(c.req.param('operationId')).success) throw badRequest('A UUID operation ID is required');
    c.header('Cache-Control', 'no-store');
    await next();
  });
  app.get(route, c => c.json(accounts.read(c.req.param('operationId'))));
  app.post(route, async c => {
    const text = await c.req.text();
    if (Buffer.byteLength(text) > 16384) throw badRequest('Provisioning request is too large');
    let raw: unknown;
    try { raw = JSON.parse(text) as unknown; } catch { throw badRequest('Invalid provisioning JSON'); }
    const parsed = hiveAdminAccountRequestSchema.safeParse(raw);
    if (!parsed.success) throw badRequest('Invalid provisioning request');
    return c.json(await accounts.provision(c.req.param('operationId'), parsed.data));
  });
}
