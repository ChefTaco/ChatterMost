import { AuthenticatedRehearsalStore, rehearsalRequestAllowed } from './rehearsal.js';
import { configuredBrowserOrigins } from './oathweave.js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';

import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import { bodyLimit as honoBodyLimit } from 'hono/body-limit';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { parse as parseCookie, serialize as serializeCookie } from 'cookie';
import { z } from 'zod';

import { HttpAppError, asJsonRecord, badRequest, forbidden, mattermostError, notFound, ok, unauthorized, type JsonRecord } from '../shared/mattermost.js';
import { renderShell, webClient, webFavicon, webStyles } from '../web/assets.js';
import { websocketFanout } from './capabilities.js';
import type { AppEnv } from './env.js';
import { resolveDataPath } from './env.js';
import { bootstrap, createIncomingWebhook, createServices, isAdmin, requireAdmin, type AuthContext, type ServiceBundle } from './services.js';
import { JsonStore, PostgresStore, type StateStore } from './store.js';
import { toMattermostChannel, toMattermostChannelMember, toMattermostCommand, toMattermostFileInfo, toMattermostPost, toMattermostPostList, toMattermostPreference, toMattermostReaction, toMattermostTeam, toMattermostTeamMember, toMattermostUser } from './mappers.js';
import { AbuseControl, rateLimit } from './rate-limit.js';
import { hashToken, safeEqualText } from './security.js';

export type AppBindings = {
  incoming?: {
    socket: {
      remoteAddress?: string | null;
    };
  };
};

export type AppVariables = {
  requestId: string;
  env: AppEnv;
  rateLimitAccount: (account: string) => Promise<void>;
};

export type AppHonoEnv = {
  Bindings: AppBindings;
  Variables: AppVariables;
};

export type ServerApp = {
  app: Hono<AppHonoEnv>;
  services: ServiceBundle;
  store: StateStore;
  abuseControl: AbuseControl;
};

const LoginTypeSchema = z.object({ login_id: z.string().min(1).max(320) });
const LoginSchema = z.object({
  login_id: z.string().min(1).max(320),
  password: z.string().min(1).max(1024),
  device_id: z.string().max(512).optional().default('')
});
const SignupSchema = z.object({
  invite_code: z.string().min(1),
  username: z
    .string()
    .min(2)
    .regex(/^[a-z0-9][a-z0-9._-]*$/u, 'Username must be lowercase and may contain only letters, numbers, dots, dashes, and underscores'),
  email: z.email(),
  password: z.string().min(10)
});
const AdminUserCreateSchema = z.object({
  username: z
    .string()
    .min(2)
    .regex(/^[a-z0-9][a-z0-9._-]*$/u, 'Username must be lowercase and may contain only letters, numbers, dots, dashes, and underscores'),
  email: z.email(),
  password: z.string().min(10),
  role: z.string().optional().default('system_user'),
  first_name: z.string().optional().default(''),
  last_name: z.string().optional().default(''),
  nickname: z.string().optional().default(''),
  position: z.string().optional().default('')
});
const AdminBotCreateSchema = z.object({
  username: z
    .string()
    .regex(/^[a-z0-9][a-z0-9._-]*$/u)
    .min(2),
  display_name: z.string().min(1).max(128),
  operation_id: z.string().regex(/^[a-z0-9]{26}$/u).optional(),
  create_only: z.boolean().optional()
});
const AdminBotUpdateSchema = AdminBotCreateSchema;
const UserSearchSchema = z.object({ term: z.string().max(512).optional().default('') });
const ChannelSearchSchema = z.object({
  term: z.string().optional().default(''),
  team_ids: z.array(z.string()).optional().default([])
});
const NativeDarkTheme = JSON.stringify({
  type: 'Onyx',
  sidebarBg: '#202228',
  sidebarText: '#ffffff',
  sidebarUnreadText: '#ffffff',
  sidebarTextHoverBg: '#25262a',
  sidebarTextActiveBorder: '#4a7ce8',
  sidebarTextActiveColor: '#ffffff',
  sidebarHeaderBg: '#24272d',
  sidebarHeaderTextColor: '#ffffff',
  sidebarTeamBarBg: '#292c33',
  onlineIndicator: '#3db887',
  awayIndicator: '#f5ab00',
  dndIndicator: '#d24b4e',
  mentionBg: '#4b7ce7',
  mentionColor: '#ffffff',
  centerChannelBg: '#191b1f',
  centerChannelColor: '#e3e4e8',
  newMessageSeparator: '#1adbdb',
  linkColor: '#5d89ea',
  buttonBg: '#4a7ce8',
  buttonColor: '#ffffff',
  errorTextColor: '#da6c6e',
  mentionHighlightBg: '#0d6e6e',
  mentionHighlightLink: '#a4f4f4',
  codeTheme: 'monokai'
});
const PatchUserSchema = z.object({
  nickname: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  position: z.string().optional(),
  locale: z.string().optional()
});
const PasswordSchema = z.object({ new_password: z.string().min(10), current_password: z.string().optional() });
const InviteSchema = z.object({
  max_uses: z.number().int().positive().optional().default(1),
  expires_in_hours: z.number().int().positive().optional().default(72),
  role: z.string().optional()
});
const ChannelCreateSchema = z.object({
  team_id: z.string().default(''),
  name: z.string().min(1),
  display_name: z.string().min(1),
  type: z.enum(['O', 'P', 'D', 'G']).default('O'),
  header: z.string().optional().default(''),
  purpose: z.string().optional().default('')
});
const ChannelPatchSchema = z.object({
  display_name: z.string().optional(),
  header: z.string().optional(),
  purpose: z.string().optional(),
  retention_days: z.number().int().positive().nullable().optional()
});
const DirectSchema = z.array(z.string().min(1)).min(1);
const PostCreateSchema = z.object({
  channel_id: z.string().min(1),
  message: z
    .string()
    .max(16_383)
    .nullish()
    .transform((value) => value ?? ''),
  root_id: z
    .string()
    .nullish()
    .transform((value) => value ?? ''),
  file_ids: z
    .array(z.string())
    .max(10)
    .nullish()
    .transform((value) => value ?? []),
  pending_post_id: z
    .string()
    .nullish()
    .transform((value) => value ?? ''),
  props: z
    .record(z.string(), z.unknown())
    .nullish()
    .transform((value) => value ?? {})
});
const PostPatchSchema = z.object({
  message: z.string().max(16_383).optional(),
  is_pinned: z.boolean().optional(),
  file_ids: z.array(z.string()).optional()
});
const PostSearchSchema = z.object({ terms: z.string().optional().default('') });
const ReactionSchema = z.object({
  post_id: z.string().min(1),
  emoji_name: z.string().min(1)
});
const CustomEmojiSchema = z.object({
  name: z.string().min(2).max(32),
  emoji: z.string().min(1).max(16)
});
const PreferenceSchema = z.array(z.object({ category: z.string(), name: z.string(), value: z.string() }));
const DeletePreferenceSchema = z.array(z.object({ category: z.string(), name: z.string() }));
const StatusSchema = z.object({
  status: z.enum(['online', 'away', 'offline', 'dnd']),
  manual: z.boolean().optional().default(true)
});
const ConfigPatchSchema = z.record(z.string(), z.unknown());
const SupervisionPatchSchema = z.object({
  mode: z.enum(['disabled', 'audit_only', 'pre_moderation', 'post_moderation']).optional(),
  blockedTerms: z.array(z.string()).optional()
});
const TestCleanupSchema = z.object({
  dry_run: z.boolean().optional().default(true),
  username_prefix: z.string().min(1).optional().default('testotron-'),
  channel_name_prefix: z.string().min(1).optional().default('Test'),
  older_than_hours: z.number().min(0).optional().default(0),
  confirm: z.string().optional().default('')
});
const AgentSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  username: z.string().min(1),
  permissions: z.record(z.string(), z.unknown()).optional(),
  channelRouting: z.record(z.string(), z.unknown()).optional(),
  userAllowlists: z.record(z.string(), z.unknown()).optional(),
  memoryPolicy: z.record(z.string(), z.unknown()).optional(),
  verified: z.boolean().optional()
});
const PushNotifySchema = z.object({
  user_id: z.string().optional(),
  channel_id: z.string().optional(),
  post_id: z.string().optional(),
  message: z.string().optional().default('')
});
const MattermostImportSchema = z.object({
  dry_run: z.boolean().optional().default(true),
  channels: z
    .array(
      z.object({
        team_id: z.string().optional(),
        name: z.string().min(1),
        display_name: z.string().min(1),
        type: z.enum(['O', 'P']).optional().default('O'),
        header: z.string().optional().default(''),
        purpose: z.string().optional().default(''),
        retention_days: z.number().int().positive().nullable().optional()
      })
    )
    .optional()
    .default([]),
  posts: z
    .array(
      z.object({
        channel_id: z.string().optional().default(''),
        message: z.string().default(''),
        root_id: z.string().optional().default(''),
        props: z.record(z.string(), z.unknown()).optional().default({})
      })
    )
    .optional()
    .default([])
});

export async function createServerApp(env: AppEnv, options: { storePath?: string | null } = {}): Promise<ServerApp> {
  if (env.AUTHENTICATED_REHEARSAL && (!env.HIVE_REHEARSAL || !env.PREFLIGHT_MODE)) throw new Error('Authenticated rehearsal requires read-only isolation');
  if (!env.PREFLIGHT_MODE) {
    await mkdir(resolveDataPath(env.FILE_STORAGE_PATH), { recursive: true, mode: 0o700 });
    await mkdir(resolveDataPath(env.PROFILE_IMAGE_STORAGE_PATH), { recursive: true, mode: 0o700 });
  }
  const sourceStore =
    env.STORE_BACKEND === 'postgres' && options.storePath !== null
      ? new PostgresStore(env.DATABASE_URL, env.PREFLIGHT_MODE)
      : new JsonStore(options.storePath === undefined ? resolveDataPath(env.STORE_PATH) : options.storePath, env.PREFLIGHT_MODE);
  const store: StateStore = env.AUTHENTICATED_REHEARSAL ? new AuthenticatedRehearsalStore(sourceStore) : sourceStore;
  await store.initialize();
  const services = createServices(store, env);
  if (!env.PREFLIGHT_MODE) await bootstrap(services);
  if (!env.PREFLIGHT_MODE) services.auditLog.publishPendingSoon();
  const abuseControl = new AbuseControl(env);
  if (!env.PREFLIGHT_MODE) await abuseControl.initialize();

  const app = new Hono<AppHonoEnv>();
  if (env.PREFLIGHT_MODE) {
    app.use('*', async (c, next) => {
      if ((c.req.method === 'GET' && c.req.path === '/api/v4/system/ping') ||
          (env.AUTHENTICATED_REHEARSAL && rehearsalRequestAllowed(c.req.method, c.req.path))) {
        await next();
        return;
      }
      return c.json(
        {
          id: 'api.context.preflight_read_only.app_error',
          message: 'Preflight mode exposes health validation only',
          detailed_error: '',
          request_id: '',
          status_code: 503
        },
        503
      );
    });
  }
  app.use('*', requestContext(store, env));
  app.use('*', secureHeaders(env));
  app.use('*', rateLimit(env, abuseControl));
  app.use('*', csrfProtection(env));
  app.use('*', requestBodyLimit());

  app.onError((error, c) => {
    const requestId = c.get('requestId') ?? 'unknown';
    store.incrementMetric('errors');
    if (error instanceof HttpAppError) {
      return c.json(mattermostError(error, requestId), error.statusCode as ContentfulStatusCode);
    }
    if (error instanceof z.ZodError) {
      // Zod error strings can contain submitted values, including credentials.
      const appError = badRequest('Invalid request body');
      return c.json(mattermostError(appError, requestId), appError.statusCode as ContentfulStatusCode);
    }
    // Unexpected errors are not surfaced to clients, but must be observable in
    // production logs so a 500 can be diagnosed after the fact.
    process.stdout.write(
      JSON.stringify({
        level: 'error',
        message: 'unhandled_request_error',
        request_id: requestId,
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      }) + '\n'
    );
    const appError = new HttpAppError('api.context.internal_server_error.app_error', 'Internal server error', 500);
    return c.json(mattermostError(appError, requestId), 500);
  });

  app.get('/assets/styles.css', (c) => c.text(webStyles, 200, { 'Content-Type': 'text/css; charset=utf-8' }));
  app.get('/assets/app.js', (c) => c.text(webClient, 200, { 'Content-Type': 'application/javascript; charset=utf-8' }));
  app.get('/favicon.svg', (c) => c.text(webFavicon, 200, { 'Content-Type': 'image/svg+xml; charset=utf-8' }));
  app.get('/', (c) => c.html(renderShell()));
  app.get('/login', (c) => c.html(renderShell()));
  app.get('/signup', (c) => c.html(renderShell()));
  app.get('/admin/system-console', (c) => c.html(renderShell()));

  app.get('/api/v4/system/ping', (c) =>
    c.json({
      status: 'OK',
      version: env.ALLOW_VERSION_ADVERTISEMENT ? env.COMPATIBILITY_SERVER_VERSION : '0.0.0-compatible',
      build_number: env.BUILD_NUMBER,
      build_hash: env.BUILD_HASH,
      build_hash_enterprise: 'none',
      build_date: env.BUILD_DATE,
      release_id: env.RELEASE_ID,
      database_status: 'OK',
      filestore_status: 'OK',
      websocket_status: 'OK',
      compatibility_profile: env.COMPATIBILITY_PROFILE
    })
  );
  app.get('/api/v4/system/version', (c) =>
    c.json({
      version: env.ALLOW_VERSION_ADVERTISEMENT ? env.COMPATIBILITY_SERVER_VERSION : '0.0.0-compatible'
    })
  );
  app.get('/api/v4/system/status', (c) =>
    c.json({
      status: 'OK',
      version: env.ALLOW_VERSION_ADVERTISEMENT ? env.COMPATIBILITY_SERVER_VERSION : '0.0.0-compatible',
      database_status: 'OK',
      filestore_status: 'OK',
      websocket_status: 'OK',
      can_receive_email: false,
      is_cloud: false,
      warnings: []
    })
  );
  app.get('/api/v4/desktop/compatibility', (c) =>
    c.json({
      profile: 'mattermost-desktop-compatible',
      api_version: 'v4',
      server_version: env.ALLOW_VERSION_ADVERTISEMENT ? env.COMPATIBILITY_SERVER_VERSION : '0.0.0-compatible',
      unsupported_features: ['calls', 'plugins', 'marketplace'],
      websocket_path: '/api/v4/websocket'
    })
  );
  app.get('/api/v4/sso/providers', (c) =>
    c.json({
      oidc: { enabled: false },
      saml: { enabled: false },
      ldap: { enabled: false }
    })
  );
  app.get('/api/v4/config/client', (c) => c.json(services.config.clientConfig()));
  app.get('/api/v4/security/events', (c) => {
    const bearer = c.req.header('authorization')?.replace(/^Bearer\s+/iu, '') ?? '';
    const configuredHash = env.SECURITY_FUSION_SERVICE_TOKEN_HASH;
    const presentedHash = createHash('sha256').update(bearer).digest('hex');
    if (!configuredHash || !bearer || !safeEqualText(presentedHash, configuredHash)) {
      throw unauthorized('Invalid Security Fusion service credential');
    }
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 200), 1), 500);
    const cursor = c.req.query('cursor');
    const chronological = [...services.auditLog.list(2000)].reverse();
    const earliestSequence = chronological.at(0)?.exportSequence;
    const latestSequence = chronological.at(-1)?.exportSequence;
    let cursorIndex = -1;
    if (cursor !== undefined) {
      const numericCursor = /^\d+$/u.test(cursor) ? Number(cursor) : null;
      if (numericCursor !== null && Number.isSafeInteger(numericCursor)) {
        if (earliestSequence !== undefined && numericCursor < earliestSequence - 1) {
          return c.json({
            id: 'api.security_fusion.cursor_expired',
            code: 'CURSOR_EXPIRED',
            message: 'Security Fusion audit cursor is older than the retained event window',
            detailed_error: '',
            request_id: c.get('requestId'),
            status_code: 410,
            earliest_available_cursor: String(earliestSequence - 1),
            earliest_available_sequence: earliestSequence,
          }, 410);
        }
        if (latestSequence !== undefined && numericCursor > latestSequence) {
          throw badRequest('Security Fusion audit cursor is ahead of the latest event');
        }
        cursorIndex = chronological.findIndex((record) => record.exportSequence > numericCursor);
        cursorIndex = cursorIndex === -1 ? chronological.length - 1 : cursorIndex - 1;
      } else {
        cursorIndex = chronological.findIndex((record) => record.id === cursor);
        if (cursorIndex === -1) {
          return c.json({
            id: 'api.security_fusion.cursor_expired',
            code: 'CURSOR_EXPIRED',
            message: 'Security Fusion audit cursor is no longer retained',
            detailed_error: '',
            request_id: c.get('requestId'),
            status_code: 410,
            earliest_available_cursor: earliestSequence === undefined ? null : String(earliestSequence - 1),
            earliest_available_sequence: earliestSequence ?? null,
          }, 410);
        }
      }
    }
    const page = chronological.slice(cursorIndex + 1, cursorIndex + 1 + limit);
    const allowedMetadata = new Set(['outcome', 'reason', 'method', 'path', 'role', 'status', 'channelType', 'permission']);
    const events = page.map((record) => ({
      id: record.id,
      sequence: record.exportSequence,
      timestamp: new Date(record.createAt).toISOString(),
      eventType: `chattermost.${record.action}`,
      action: record.action,
      actor: record.actorUserId,
      ipAddress: record.ip,
      targetId: record.targetId,
      severity: /fail|deny|lock|security/iu.test(record.action) ? 7 : 2,
      summary: `ChatterMost ${record.action}`,
      metadata: Object.fromEntries(Object.entries(record.metadata).filter(([key]) => allowedMetadata.has(key))),
    }));
    return c.json({
      events,
      nextCursor: page.at(-1)?.exportSequence.toString() ?? cursor ?? null,
      earliestAvailableCursor: earliestSequence === undefined ? null : String(earliestSequence - 1),
    });
  });
  app.get('/api/v4/license/client', (c) => c.json(services.config.license()));
  app.get('/api/v4/plugins/webapp', async (c) => {
    await requireAuth(c, services);
    return c.json([]);
  });
  app.post('/api/v4/roles/names', async (c) => {
    await requireAuth(c, services);
    const names = await readJson(c, z.array(z.string().min(1)).max(100));
    return c.json(names.map(toMattermostBuiltInRole));
  });
  app.get('/api/v4/system/timezones', (c) => c.json(['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles']));
  app.get('/api/v4/system/notices/:team_id', (c) => c.json([]));
  app.put('/api/v4/system/notices/view', (c) => c.json(ok()));
  app.get('/api/v4/logs', async (c) => {
    requireAdmin((await requireAuth(c, services)).user);
    return c.json(services.auditLog.list());
  });
  app.post('/api/v4/logs', (c) => c.json(ok()));
  app.post('/api/v4/logs/query', async (c) => {
    requireAdmin((await requireAuth(c, services)).user);
    return c.json(services.auditLog.list());
  });

  app.post('/api/v4/users/login/type', async (c) => {
    const body = await readJson(c, LoginTypeSchema);
    return c.json(services.auth.loginType(body.login_id));
  });
  app.post('/api/v4/auth/oathweave/session', async (c) => {
    if(!configuredBrowserOrigins(env).includes(c.req.header('origin')??'')) throw forbidden('Browser origin is not allowed');
    const token=/^Bearer\s+(.+)$/iu.exec(c.req.header('authorization')??'')?.[1];
    if(!token)throw unauthorized();
    const result=await services.sessions.exchangeIdentity(token);
    c.header('Set-Cookie',serializeCookie(env.SESSION_COOKIE_NAME,result.token,{httpOnly:true,sameSite:'strict',secure:new URL(env.SERVER_URL).protocol==='https:',path:'/',maxAge:Math.max(1,Math.floor((result.expiresAt-Date.now())/1000))}));
    c.header('Cache-Control','no-store');
    return c.json({user:toMattermostUser(result.user,{includeEmail:true}),expires_at:result.expiresAt});
  });
  app.post('/api/v4/users/login', async (c) => {
    const body = await readJson(c, LoginSchema);
    await c.get('rateLimitAccount')(body.login_id);
    const result = await services.auth.login(body.login_id, body.password, body.device_id);
    const secure = env.NODE_ENV === 'production' || env.SERVER_URL.startsWith('https:');
    c.header('Token', result.token);
    c.header(
      'Set-Cookie',
      serializeCookie(env.SESSION_COOKIE_NAME, result.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        path: '/',
        maxAge: env.SESSION_DAYS * 24 * 60 * 60
      })
    );
    return c.json(toMattermostUser(result.user, { includeEmail: true }));
  });
  app.post('/api/v4/users/logout', async (c) => {
    const auth = await requireAuth(c, services);
    await services.sessions.revokeCurrent(auth.sessionId, auth.user);
    c.header('Set-Cookie', serializeCookie(env.SESSION_COOKIE_NAME, '', { path: '/', maxAge: 0 }));
    return c.json(ok());
  });
  app.get('/api/v4/users/me', async (c) => {
    const auth = await requireAuth(c, services);
    return c.json(toMattermostUser(auth.user, { includeEmail: true }));
  });
  app.get('/api/v4/users', async (c) => {
    const auth = await requireAuth(c, services);
    const teamId = c.req.query('in_team');
    const channelId = c.req.query('in_channel');
    let userIds: string[];
    if (channelId !== undefined && channelId.length > 0) {
      services.channels.assertMember(channelId, auth.user.id);
      userIds = services.channels.listMembers(channelId).map((member) => member.userId);
    } else if (teamId !== undefined && teamId.length > 0) {
      services.teams.getMember(teamId, auth.user.id);
      userIds = services.teams.listMembers(teamId).map((member) => member.userId);
    } else {
      userIds = services.users.search('').map((user) => user.id);
    }
    const users = userIds.flatMap((id) => {
      const user = services.users.findById(id);
      return user === null || user.deleteAt > 0 ? [] : [user];
    });
    return c.json(
      paginate(
        c,
        users.map((user) => toMattermostUser(user, { includeEmail: canSeeEmail(auth.user, user, services) }))
      )
    );
  });
  app.post('/api/v4/users/ids', async (c) => {
    const auth = await requireAuth(c, services);
    const ids = await readJson(c, z.array(z.string()).max(100));
    return c.json(
      ids
        .flatMap((id) => {
          const user = services.users.findById(id);
          return user === null || user.deleteAt > 0 ? [] : [user];
        })
        .map((user) => toMattermostUser(user, { includeEmail: canSeeEmail(auth.user, user, services) }))
    );
  });
  app.get('/api/v4/users/autocomplete', async (c) => {
    const auth = await requireAuth(c, services);
    const teamId = c.req.query('in_team') ?? '';
    const channelId = c.req.query('in_channel') ?? '';
    const name = (c.req.query('name') ?? '').toLowerCase();
    const limit = Math.min(100, Math.max(1, Number.parseInt(c.req.query('limit') ?? '25', 10) || 25));
    let allowedIds: Set<string> | null = null;
    if (teamId.length > 0) {
      services.teams.getMember(teamId, auth.user.id);
      allowedIds = new Set(services.teams.listMembers(teamId).map((member) => member.userId));
    }
    if (channelId.length > 0) {
      services.channels.assertMember(channelId, auth.user.id);
      const channelIds = new Set(services.channels.listMembers(channelId).map((member) => member.userId));
      allowedIds = allowedIds === null ? channelIds : new Set([...allowedIds].filter((id) => channelIds.has(id)));
    }
    const users = services.users
      .search(name, { includeEmail: canSearchEmail(auth.user, services) })
      .filter((user) => allowedIds === null || allowedIds.has(user.id))
      .slice(0, limit)
      .map((user) => toMattermostUser(user, { includeEmail: canSeeEmail(auth.user, user, services) }));
    return c.json({ users, out_of_channel: [] });
  });
  app.post('/api/v4/users', async (c) => {
    const body = await readJson(c, SignupSchema);
    const user = await services.invites.enroll({
      inviteCode: body.invite_code,
      username: body.username,
      email: body.email,
      password: body.password
    });
    return c.json(toMattermostUser(user, { includeEmail: true }), 201);
  });
  app.get('/api/v4/users/:user_id', async (c) => {
    const auth = await requireAuth(c, services);
    const user = services.users.getById(c.req.param('user_id'));
    return c.json(toMattermostUser(user, { includeEmail: canSeeEmail(auth.user, user, services) }));
  });
  app.get('/api/v4/users/username/:username', async (c) => {
    const auth = await requireAuth(c, services);
    const user = services.users.findByUsername(c.req.param('username'));
    if (user === null) {
      throw notFound('User');
    }
    return c.json(toMattermostUser(user, { includeEmail: canSeeEmail(auth.user, user, services) }));
  });
  app.get('/api/v4/users/email/:email', async (c) => {
    const auth = await requireAuth(c, services);
    const user = services.users.findByEmail(c.req.param('email'));
    if (user === null || (!canSearchEmail(auth.user, services) && user.id !== auth.user.id)) {
      throw notFound('User');
    }
    return c.json(toMattermostUser(user, { includeEmail: canSeeEmail(auth.user, user, services) }));
  });
  app.post('/api/v4/users/search', async (c) => {
    const auth = await requireAuth(c, services);
    const body = await readJson(c, UserSearchSchema);
    return c.json(
      services.users
        .search(body.term, { includeEmail: canSearchEmail(auth.user, services) })
        .map((user) => toMattermostUser(user, { includeEmail: canSeeEmail(auth.user, user, services) }))
    );
  });
  app.put('/api/v4/users/:user_id', async (c) => patchUserRoute(c, services));
  app.put('/api/v4/users/:user_id/patch', async (c) => patchUserRoute(c, services));
  app.put('/api/v4/users/:user_id/password', async (c) => {
    const auth = await requireAuth(c, services);
    const body = await readJson(c, PasswordSchema);
    await services.users.changePassword(c.req.param('user_id'), body.new_password, auth.user, body.current_password, auth.sessionId);
    return c.json(ok());
  });
  app.get('/api/v4/users/:user_id/sessions', async (c) => {
    const auth = await requireAuth(c, services);
    const userId = c.req.param('user_id') === 'me' ? auth.user.id : c.req.param('user_id');
    return c.json(
      services.sessions.listUserSessions(userId, auth.user).map((session) => ({
        id: session.id,
        create_at: session.createAt,
        expires_at: session.expiresAt,
        user_id: session.userId,
        device_id: session.deviceId,
        props: {}
      }))
    );
  });
  app.put('/api/v4/users/sessions/device', async (c) => {
    const auth = await requireAuth(c, services);
    const body = await readJson(c, z.object({ device_id: z.string().default('') }).loose());
    await services.sessions.updateDevice(auth.sessionId, body.device_id);
    return c.json(ok());
  });

  app.get('/api/v4/users/:user_id/image/default', async (c) => {
    await requireAuth(c, services);
    return svgResponse(services.profileImages.defaultAvatarSvg(c.req.param('user_id')));
  });
  app.get('/api/v4/users/:user_id/image', async (c) => {
    await requireAuth(c, services);
    const image = services.profileImages.getImage(c.req.param('user_id'));
    if (image === null) {
      return svgResponse(services.profileImages.defaultAvatarSvg(c.req.param('user_id')));
    }
    const bytes = await services.profileImages.readImage(image);
    return new Response(Buffer.from(bytes), {
      headers: { 'Content-Type': image.mimeType, 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff' }
    });
  });
  app.post('/api/v4/users/:user_id/image', async (c) => {
    const auth = await requireAuth(c, services);
    const body = await c.req.parseBody();
    const image = body.image;
    if (!(image instanceof File)) {
      throw badRequest('Multipart field image is required');
    }
    const record = await services.profileImages.setImage({
      actor: auth.user,
      userId: c.req.param('user_id'),
      mimeType: image.type,
      bytes: new Uint8Array(await image.arrayBuffer())
    });
    return c.json({ id: record.id, update_at: record.updateAt });
  });
  app.delete('/api/v4/users/:user_id/image', async (c) => {
    const auth = await requireAuth(c, services);
    await services.profileImages.resetImage(c.req.param('user_id'), auth.user);
    return c.json(ok());
  });

  app.get('/api/v4/users/me/teams', async (c) => {
    const auth = await requireAuth(c, services);
    return c.json(services.teams.listUserTeams(auth.user.id).map(toMattermostTeam));
  });
  app.get('/api/v4/users/me/teams/members', async (c) => {
    const auth = await requireAuth(c, services);
    return c.json(services.teams.listUserTeams(auth.user.id).map((team) => toMattermostTeamMember(services.teams.getMember(team.id, auth.user.id))));
  });
  app.get('/api/v4/teams', async (c) => {
    const auth = await requireAuth(c, services);
    return c.json(services.teams.listVisibleTeams(auth.user).map(toMattermostTeam));
  });
  app.get('/api/v4/teams/:team_id', async (c) => {
    await requireAuth(c, services);
    return c.json(toMattermostTeam(services.teams.getTeam(c.req.param('team_id'))));
  });
  app.get('/api/v4/teams/name/:team_name', async (c) => {
    await requireAuth(c, services);
    return c.json(toMattermostTeam(services.teams.getTeamByName(c.req.param('team_name'))));
  });
  app.get('/api/v4/teams/:team_id/members', async (c) => {
    await requireAuth(c, services);
    return c.json(services.teams.listMembers(c.req.param('team_id')).map(toMattermostTeamMember));
  });
  app.get('/api/v4/teams/:team_id/members/:user_id', async (c) => {
    await requireAuth(c, services);
    return c.json(toMattermostTeamMember(services.teams.getMember(c.req.param('team_id'), c.req.param('user_id'))));
  });
  app.post('/api/v4/teams/:team_id/members', async (c) => {
    const auth = await requireAuth(c, services);
    if (!isAdmin(auth.user)) {
      const actorMembership = services.teams.getMember(c.req.param('team_id'), auth.user.id);
      if (!actorMembership.roles.split(/\s+/u).includes('team_admin')) {
        throw forbidden('Team admin role is required');
      }
    }
    const body = await readJson(c, z.object({ user_id: z.string() }));
    return c.json(toMattermostTeamMember(await services.teams.addUserToTeam(c.req.param('team_id'), body.user_id, '')));
  });
  app.delete('/api/v4/teams/:team_id/members/:user_id', async (c) => {
    const auth = await requireAuth(c, services);
    if (!isAdmin(auth.user)) {
      const actorMembership = services.teams.getMember(c.req.param('team_id'), auth.user.id);
      if (!actorMembership.roles.split(/\s+/u).includes('team_admin')) {
        throw forbidden('Team admin role is required');
      }
    }
    await services.teams.removeUserFromTeam(c.req.param('team_id'), c.req.param('user_id'));
    return c.json(ok());
  });
  app.put('/api/v4/teams/:team_id/members/:user_id/roles', async (c) => {
    const auth = await requireAuth(c, services);
    requireAdmin(auth.user);
    const body = await readJson(c, z.object({ roles: z.string() }));
    return c.json(
      toMattermostTeamMember(
        await services.teams.updateMemberRoles(c.req.param('team_id'), c.req.param('user_id'), body.roles)
      )
    );
  });

  app.get('/api/v4/users/me/channels', async (c) => {
    const auth = await requireAuth(c, services);
    return c.json(services.channels.listForUser(auth.user.id).map(toMattermostChannel));
  });
  app.get('/api/v4/users/me/teams/:team_id/channels', async (c) => {
    const auth = await requireAuth(c, services);
    return c.json(services.channels.listForUser(auth.user.id, c.req.param('team_id')).map(toMattermostChannel));
  });
  app.get('/api/v4/users/me/teams/:team_id/channels/members', async (c) => {
    const auth = await requireAuth(c, services);
    const teamId = c.req.param('team_id');
    services.teams.getMember(teamId, auth.user.id);
    return c.json(services.channels.listForUser(auth.user.id, teamId).map((channel) => toMattermostChannelMember(services.channels.getMember(channel.id, auth.user.id))));
  });
  app.get('/api/v4/users/:user_id/teams/:team_id/channels/categories', async (c) => {
    const auth = await requireAuth(c, services);
    const requestedUserId = c.req.param('user_id') === 'me' ? auth.user.id : c.req.param('user_id');
    if (requestedUserId !== auth.user.id && !isAdmin(auth.user)) {
      throw forbidden("Cannot view another user's channel categories");
    }
    const teamId = c.req.param('team_id');
    services.teams.getMember(teamId, requestedUserId);
    const channelsCategoryId = stableCompatibilityId(`channels:${requestedUserId}:${teamId}`);
    const directMessagesCategoryId = stableCompatibilityId(`direct-messages:${requestedUserId}:${teamId}`);
    const channels = services.channels.listForUser(requestedUserId, teamId);
    const channelIds = channels.filter((channel) => channel.type !== 'D' && channel.type !== 'G').map((channel) => channel.id);
    const directMessageIds = channels.filter((channel) => channel.type === 'D' || channel.type === 'G').map((channel) => channel.id);
    return c.json({
      categories: [
        {
          id: channelsCategoryId,
          user_id: requestedUserId,
          team_id: teamId,
          sort_order: 10,
          sorting: 'alpha',
          type: 'channels',
          display_name: 'Channels',
          muted: false,
          collapsed: false,
          channel_ids: channelIds
        },
        {
          id: directMessagesCategoryId,
          user_id: requestedUserId,
          team_id: teamId,
          sort_order: 20,
          sorting: 'recent',
          type: 'direct_messages',
          display_name: 'Direct Messages',
          muted: false,
          collapsed: false,
          channel_ids: directMessageIds
        }
      ],
      order: [channelsCategoryId, directMessagesCategoryId]
    });
  });
  app.get('/api/v4/teams/:team_id/channels', async (c) => {
    const auth = await requireAuth(c, services);
    const teamId = c.req.param('team_id');
    if (!isAdmin(auth.user)) {
      services.teams.getMember(teamId, auth.user.id);
    }
    const joinedIds = new Set(services.channels.listForUser(auth.user.id, teamId).map((channel) => channel.id));
    const channels = services.channels
      .listTeamChannels(teamId)
      .filter((channel) => isAdmin(auth.user) || channel.type === 'O' || joinedIds.has(channel.id))
      .map(toMattermostChannel);
    return c.json(paginate(c, channels));
  });
  app.post('/api/v4/teams/:team_id/channels/search', async (c) => {
    const auth = await requireAuth(c, services);
    const teamId = c.req.param('team_id');
    if (!isAdmin(auth.user)) {
      services.teams.getMember(teamId, auth.user.id);
    }
    const body = await readJson(c, UserSearchSchema);
    const joinedIds = new Set(services.channels.listChannelIdsForUser(auth.user.id));
    return c.json(
      services.channels
        .searchTeamChannels(teamId, body.term, { nameOnly: true })
        .filter((channel) => isAdmin(auth.user) || channel.type === 'O' || joinedIds.has(channel.id))
        .map(toMattermostChannel)
    );
  });
  app.post('/api/v4/channels/search', async (c) => {
    const auth = await requireAuth(c, services);
    const body = await readJson(c, ChannelSearchSchema);
    const teamIds = body.team_ids.length > 0 ? body.team_ids : services.teams.listUserTeams(auth.user.id).map((team) => team.id);
    const joinedIds = new Set(services.channels.listChannelIdsForUser(auth.user.id));
    const results = teamIds.flatMap((teamId) => {
      services.teams.getMember(teamId, auth.user.id);
      return services.channels
        .searchTeamChannels(teamId, body.term)
        .filter((channel) => channel.type === 'O' || joinedIds.has(channel.id))
    });
    return c.json([...new Map(results.map((channel) => [channel.id, channel])).values()].map(toMattermostChannel));
  });
  app.get('/api/v4/teams/:team_id/channels/autocomplete', async (c) => {
    const auth = await requireAuth(c, services);
    const teamId = c.req.param('team_id');
    services.teams.getMember(teamId, auth.user.id);
    const name = c.req.query('name') ?? '';
    const joinedIds = new Set(services.channels.listChannelIdsForUser(auth.user.id));
    return c.json(
      services.channels
        .searchTeamChannels(teamId, name)
        .filter((channel) => channel.type === 'O' || joinedIds.has(channel.id))
        .slice(0, 100)
        .map(toMattermostChannel)
    );
  });
  app.get('/api/v4/teams/:team_id/channels/search_autocomplete', async (c) => {
    const auth = await requireAuth(c, services);
    const teamId = c.req.param('team_id');
    services.teams.getMember(teamId, auth.user.id);
    const name = c.req.query('name') ?? '';
    const joinedIds = new Set(services.channels.listChannelIdsForUser(auth.user.id));
    return c.json(
      services.channels
        .searchTeamChannels(teamId, name)
        .filter((channel) => channel.type === 'O' || joinedIds.has(channel.id))
        .slice(0, 100)
        .map(toMattermostChannel)
    );
  });
  app.get('/api/v4/teams/:team_id/channels/deleted', async (c) => {
    const auth = await requireAuth(c, services);
    const teamId = c.req.param('team_id');
    const joinedIds = new Set(services.channels.listForUser(auth.user.id, teamId).map((channel) => channel.id));
    const channels = services.channels
      .listTeamChannels(teamId, { includeDeleted: true })
      .filter((channel) => channel.deleteAt > 0)
      .filter((channel) => isAdmin(auth.user) || joinedIds.has(channel.id))
      .map(toMattermostChannel);
    return c.json(paginate(c, channels));
  });
  app.get('/api/v4/teams/:team_id/channels/name/:channel_name', async (c) => {
    const auth = await requireAuth(c, services);
    const teamId = c.req.param('team_id');
    if (!isAdmin(auth.user)) {
      services.teams.getMember(teamId, auth.user.id);
    }
    const channel = services.channels.getByName(teamId, c.req.param('channel_name'));
    const joinedIds = new Set(services.channels.listForUser(auth.user.id, teamId).map((item) => item.id));
    if (!isAdmin(auth.user) && channel.type !== 'O' && !joinedIds.has(channel.id)) {
      throw notFound('Channel');
    }
    return c.json(toMattermostChannel(channel));
  });
  app.post('/api/v4/channels', async (c) => {
    const auth = await requireAuth(c, services);
    const body = await readJson(c, ChannelCreateSchema);
    const channel = await services.channels.createChannel({
      creatorId: auth.user.id,
      actor: auth.user,
      teamId: body.team_id,
      type: body.type,
      name: body.name,
      displayName: body.display_name,
      header: body.header,
      purpose: body.purpose
    });
    return c.json(toMattermostChannel(channel), 201);
  });
  app.get('/api/v4/channels/:channel_id', async (c) => {
    const auth = await requireAuth(c, services);
    services.channels.assertMember(c.req.param('channel_id'), auth.user.id);
    return c.json(toMattermostChannel(services.channels.getChannel(c.req.param('channel_id'))));
  });
  app.get('/api/v4/channels/:channel_id/stats', async (c) => {
    const auth = await requireAuth(c, services);
    const channelId = c.req.param('channel_id');
    services.channels.assertMember(channelId, auth.user.id);
    return c.json({
      channel_id: channelId,
      member_count: services.channels.listMembers(channelId).length,
      guest_count: 0,
      pinnedpost_count: services.posts.listChannelPosts(channelId, auth.user).filter((post) => post.isPinned).length,
      files_count: 0
    });
  });
  app.get('/api/v4/channels/:channel_id/timezones', async (c) => {
    const auth = await requireAuth(c, services);
    const channelId = c.req.param('channel_id');
    services.channels.assertMember(channelId, auth.user.id);
    const timezones = services.channels.listMembers(channelId).flatMap((member) => {
      const user = services.users.findById(member.userId);
      if (user === null || user.deleteAt > 0) return [];
      const automatic = user.timezone.automaticTimezone;
      const manual = user.timezone.manualTimezone;
      const useAutomatic = user.timezone.useAutomaticTimezone;
      const selected = useAutomatic === 'false' ? manual : automatic;
      return typeof selected === 'string' && selected.length > 0 ? [selected] : [];
    });
    return c.json([...new Set(timezones)]);
  });
  app.get('/api/v4/channels/:channel_id/member_counts_by_group', async (c) => {
    const auth = await requireAuth(c, services);
    services.channels.assertMember(c.req.param('channel_id'), auth.user.id);
    return c.json([]);
  });
  app.get('/api/v4/channels/:channel_id/access_control/attributes', async (c) => {
    const auth = await requireAuth(c, services);
    services.channels.assertMember(c.req.param('channel_id'), auth.user.id);
    return c.json({});
  });
  app.put('/api/v4/channels/:channel_id', async (c) => patchChannelRoute(c, services));
  app.put('/api/v4/channels/:channel_id/patch', async (c) => patchChannelRoute(c, services));
  app.delete('/api/v4/channels/:channel_id', async (c) => {
    const auth = await requireAuth(c, services);
    return c.json(toMattermostChannel(await services.channels.deleteChannel(c.req.param('channel_id'), auth.user)));
  });
  app.post('/api/v4/channels/direct', async (c) => {
    const auth = await requireAuth(c, services);
    const userIds = await readJson(c, DirectSchema);
    return c.json(toMattermostChannel(await services.channels.direct(userIds, auth.user.id)));
  });
  app.post('/api/v4/channels/group', async (c) => {
    const auth = await requireAuth(c, services);
    const userIds = await readJson(c, DirectSchema);
    return c.json(toMattermostChannel(await services.channels.direct(userIds, auth.user.id)));
  });
  app.get('/api/v4/channels/:channel_id/members', async (c) => {
    const auth = await requireAuth(c, services);
    if (!isAdmin(auth.user)) {
      services.channels.assertMember(c.req.param('channel_id'), auth.user.id);
    }
    return c.json(services.channels.listMembers(c.req.param('channel_id')).map(toMattermostChannelMember));
  });
  app.get('/api/v4/channels/:channel_id/members/:user_id', async (c) => {
    const auth = await requireAuth(c, services);
    if (!isAdmin(auth.user)) {
      services.channels.assertMember(c.req.param('channel_id'), auth.user.id);
    }
    return c.json(toMattermostChannelMember(services.channels.getMember(c.req.param('channel_id'), c.req.param('user_id'))));
  });
  app.put('/api/v4/channels/:channel_id/members/:user_id/notify_props', async (c) => {
    const auth = await requireAuth(c, services);
    const userId = c.req.param('user_id') === 'me' ? auth.user.id : c.req.param('user_id');
    const body = await readJson(c, z.record(z.string(), z.unknown()));
    const notifyProps = Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'channel_id' && key !== 'user_id'));
    return c.json(toMattermostChannelMember(await services.channels.updateMemberNotifyProps(c.req.param('channel_id'), userId, asJsonRecord(notifyProps), auth.user)));
  });
  app.post('/api/v4/channels/:channel_id/members', async (c) => {
    const auth = await requireAuth(c, services);
    const body = await readJson(c, z.object({ user_id: z.string() }));
    return c.json(toMattermostChannelMember(await services.channels.addUserToChannel(c.req.param('channel_id'), body.user_id, '', auth.user)));
  });
  app.delete('/api/v4/channels/:channel_id/members/:user_id', async (c) => {
    const auth = await requireAuth(c, services);
    await services.channels.removeUserFromChannel(c.req.param('channel_id'), c.req.param('user_id'), auth.user);
    return c.json(ok());
  });
  app.post('/api/v4/channels/members/:user_id/view', async (c) => {
    const auth = await requireAuth(c, services);
    const body = await readJson(c, z.object({ channel_id: z.string() }));
    if (auth.user.id !== c.req.param('user_id') && !isAdmin(auth.user)) {
      throw forbidden();
    }
    await services.channels.viewChannel(body.channel_id, c.req.param('user_id'));
    return c.json(ok());
  });
  app.get('/api/v4/users/:user_id/channels/:channel_id/unread', async (c) => {
    const auth = await requireAuth(c, services);
    if (auth.user.id !== c.req.param('user_id') && !isAdmin(auth.user)) {
      throw forbidden();
    }
    return c.json(services.channels.unread(c.req.param('channel_id'), c.req.param('user_id')));
  });
  app.get('/api/v4/channels/:channel_id/pinned', async (c) => {
    const auth = await requireAuth(c, services);
    return c.json(toMattermostPostList(services.posts.listChannelPosts(c.req.param('channel_id'), auth.user).filter((post) => post.isPinned)));
  });
  app.put('/api/v4/channels/:channel_id/privacy', async (c) => {
    const auth = await requireAuth(c, services);
    requireAdmin(auth.user);
    return c.json(toMattermostChannel(await services.channels.patchChannel(c.req.param('channel_id'), {}, auth.user)));
  });
  app.put('/api/v4/channels/:channel_id/agent-policy', async (c) => {
    const auth = await requireAuth(c, services);
    const body = await readJson(c, z.record(z.string(), z.unknown()));
    return c.json(await services.channels.setAgentPolicy(c.req.param('channel_id'), asJsonRecord(body), auth.user));
  });
  app.get('/api/v4/channels/:channel_id/agent-policy', async (c) => {
    const auth = await requireAuth(c, services);
    if (!isAdmin(auth.user)) {
      services.channels.assertMember(c.req.param('channel_id'), auth.user.id);
    }
    return c.json(services.channels.getChannel(c.req.param('channel_id')).agentPolicy);
  });

  app.post('/api/v4/posts', async (c) => {
    const auth = await requireAuth(c, services);
    const body = await readJson(c, PostCreateSchema);
    const post = await services.posts.createPost({
      actor: auth.user,
      channelId: body.channel_id,
      message: body.message,
      rootId: body.root_id,
      fileIds: body.file_ids,
      pendingPostId: body.pending_post_id,
      props: asJsonRecord(body.props)
    });
    return c.json(toMattermostPost(post), 201);
  });
  app.get('/api/v4/posts/:post_id', async (c) => {
    const auth = await requireAuth(c, services);
    const post = services.posts.getPost(c.req.param('post_id'));
    services.channels.assertMember(post.channelId, auth.user.id);
    return c.json(toMattermostPost(post));
  });
  app.put('/api/v4/posts/:post_id', async (c) => patchPostRoute(c, services));
  app.put('/api/v4/posts/:post_id/patch', async (c) => patchPostRoute(c, services));
  app.delete('/api/v4/posts/:post_id', async (c) => {
    const auth = await requireAuth(c, services);
    return c.json(toMattermostPost(await services.posts.deletePost(c.req.param('post_id'), auth.user)));
  });
  app.get('/api/v4/channels/:channel_id/posts', async (c) => {
    const auth = await requireAuth(c, services);
    const allPosts = services.posts
      .listChannelPosts(c.req.param('channel_id'), auth.user)
      .map((post, index) => ({ post, index }))
      .sort((a, b) => b.post.createAt - a.post.createAt || b.index - a.index)
      .map(({ post }) => post);
    const perPage = Math.min(200, Math.max(1, Number.parseInt(c.req.query('per_page') ?? '60', 10) || 60));
    const page = Math.max(0, Number.parseInt(c.req.query('page') ?? '0', 10) || 0);
    const before = c.req.query('before') ?? '';
    const after = c.req.query('after') ?? '';
    const since = Math.max(0, Number.parseInt(c.req.query('since') ?? '0', 10) || 0);
    let posts = allPosts;
    if (before.length > 0) {
      const pivotIndex = allPosts.findIndex((post) => post.id === before);
      posts = pivotIndex < 0 ? [] : allPosts.slice(pivotIndex + 1);
    } else if (after.length > 0) {
      const pivotIndex = allPosts.findIndex((post) => post.id === after);
      posts = pivotIndex < 0 ? [] : allPosts.slice(0, pivotIndex).reverse();
    } else if (since > 0) {
      posts = allPosts.filter((post) => post.updateAt > since || post.createAt > since);
    } else {
      posts = posts.slice(page * perPage);
    }
    return c.json(toMattermostPostList(posts.slice(0, perPage)));
  });
  app.get('/api/v4/posts/:post_id/thread', async (c) => {
    const auth = await requireAuth(c, services);
    return c.json(toMattermostPostList(services.posts.thread(c.req.param('post_id'), auth.user)));
  });
  app.get('/api/v4/users/:user_id/posts/flagged', async (c) => {
    const auth = await requireAuth(c, services);
    const userId = c.req.param('user_id') === 'me' ? auth.user.id : c.req.param('user_id');
    if (userId !== auth.user.id && !isAdmin(auth.user)) {
      throw forbidden();
    }
    const channelId = c.req.query('channel_id') ?? '';
    const teamId = c.req.query('team_id') ?? '';
    const flagged = services.preferences
      .list(userId, auth.user)
      .filter((preference) => preference.category === 'flagged_post' && preference.value === 'true')
      .flatMap((preference) => {
        try {
          const post = services.posts.getPost(preference.name);
          services.channels.assertMember(post.channelId, auth.user.id);
          const channel = services.channels.getChannel(post.channelId);
          if (channelId.length > 0 && post.channelId !== channelId) return [];
          if (teamId.length > 0 && channel.teamId !== teamId) return [];
          return [post];
        } catch {
          return [];
        }
      });
    return c.json(toMattermostPostList(flagged));
  });
  app.post('/api/v4/posts/ids', async (c) => {
    const auth = await requireAuth(c, services);
    const ids = await readJson(c, z.array(z.string()));
    return c.json(
      toMattermostPostList(
        ids
          .map((id) => services.posts.getPost(id))
          .filter((post) => {
            services.channels.assertMember(post.channelId, auth.user.id);
            return true;
          })
      )
    );
  });
  app.post('/api/v4/posts/search', async (c) => {
    const auth = await requireAuth(c, services);
    const body = await readJson(c, PostSearchSchema);
    return c.json(toMattermostPostList(services.posts.search(null, body.terms, auth.user)));
  });
  app.post('/api/v4/teams/:team_id/posts/search', async (c) => {
    const auth = await requireAuth(c, services);
    const body = await readJson(c, PostSearchSchema);
    return c.json(toMattermostPostList(services.posts.search(c.req.param('team_id'), body.terms, auth.user)));
  });
  app.post('/api/v4/posts/:post_id/pin', async (c) => {
    const auth = await requireAuth(c, services);
    return c.json(toMattermostPost(await services.posts.setPinned(c.req.param('post_id'), true, auth.user)));
  });
  app.post('/api/v4/posts/:post_id/unpin', async (c) => {
    const auth = await requireAuth(c, services);
    return c.json(toMattermostPost(await services.posts.setPinned(c.req.param('post_id'), false, auth.user)));
  });
  app.get('/api/v4/posts/:post_id/files/info', async (c) => {
    const auth = await requireAuth(c, services);
    const postId = c.req.param('post_id');
    return c.json(services.files.fileInfosForPost(postId, auth.user, services.posts).map((file) => toMattermostFileInfo(file, postId)));
  });
  app.get('/api/v4/posts/:post_id/edit_history', async (c) => {
    const auth = await requireAuth(c, services);
    return c.json(services.posts.editHistory(c.req.param('post_id'), auth.user));
  });
  app.post('/api/v4/posts/ephemeral', async (c) => {
    const auth = await requireAuth(c, services);
    const body = await readJson(c, PostCreateSchema);
    await services.hub.broadcast('ephemeral_message', { message: body.message, user_id: auth.user.id }, { user_id: auth.user.id });
    return c.json(ok());
  });

  app.post('/api/v4/reactions', async (c) => {
    const auth = await requireAuth(c, services);
    const body = await readJson(c, ReactionSchema);
    return c.json(
      toMattermostReaction(
        await services.reactions.add({
          actor: auth.user,
          postId: body.post_id,
          emojiName: body.emoji_name
        })
      ),
      201
    );
  });
  app.get('/api/v4/posts/:post_id/reactions', async (c) => {
    const auth = await requireAuth(c, services);
    return c.json(services.reactions.list(c.req.param('post_id'), auth.user).map(toMattermostReaction));
  });
  app.delete('/api/v4/users/:user_id/posts/:post_id/reactions/:emoji_name', async (c) => {
    const auth = await requireAuth(c, services);
    await services.reactions.remove({
      actor: auth.user,
      userId: c.req.param('user_id'),
      postId: c.req.param('post_id'),
      emojiName: c.req.param('emoji_name')
    });
    return c.json(ok());
  });
  app.post('/api/v4/posts/ids/reactions', async (c) => {
    const auth = await requireAuth(c, services);
    const ids = await readJson(c, z.array(z.string()));
    return c.json(Object.fromEntries(Object.entries(services.reactions.reactionsForPosts(ids, auth.user)).map(([postId, reactions]) => [postId, reactions.map(toMattermostReaction)])));
  });
  app.get('/api/v4/emoji', async (c) => {
    await requireAuth(c, services);
    return c.json(services.customEmoji.list().map(toCustomEmojiJson));
  });
  app.post('/admin/custom-emoji', async (c) => {
    const auth = await requireAuth(c, services);
    const body = await readJson(c, CustomEmojiSchema);
    return c.json(toCustomEmojiJson(await services.customEmoji.create(auth.user, body)), 201);
  });
  app.delete('/admin/custom-emoji/:id', async (c) => {
    const auth = await requireAuth(c, services);
    return c.json(toCustomEmojiJson(await services.customEmoji.delete(auth.user, c.req.param('id'))));
  });

  app.post('/api/v4/files', async (c) => {
    const auth = await requireAuth(c, services);
    const body = await c.req.parseBody({ all: true });
    const channelId = pickFirstString(body.channel_id) ?? c.req.query('channel_id');
    if (channelId === undefined) {
      throw badRequest('channel_id is required');
    }
    const values = Array.isArray(body.files) ? body.files : [body.files].filter(Boolean);
    const infos = [];
    for (const value of values) {
      if (!(value instanceof File)) {
        continue;
      }
      infos.push(
        toMattermostFileInfo(
          await services.files.storeFile({
            userId: auth.user.id,
            channelId,
            name: value.name,
            mimeType: value.type || 'application/octet-stream',
            bytes: new Uint8Array(await value.arrayBuffer())
          })
        )
      );
    }
    return c.json({ file_infos: infos, client_ids: [] }, 201);
  });
  app.get('/api/v4/files/:file_id', async (c) => fileResponse(c, services, 'attachment'));
  app.on('HEAD', '/api/v4/files/:file_id', async (c) => {
    const auth = await requireAuth(c, services);
    const file = services.files.getFile(c.req.param('file_id'), auth.user);
    return new Response(null, {
      headers: {
        'Content-Type': safeDownloadContentType(file.mimeType),
        'Content-Length': String(file.size),
        'Content-Disposition': contentDisposition('attachment', file.name),
        'X-Content-Type-Options': 'nosniff'
      }
    });
  });
  app.get('/api/v4/files/:file_id/info', async (c) => {
    const auth = await requireAuth(c, services);
    const fileId = c.req.param('file_id');
    const file = services.files.getFile(fileId, auth.user);
    const postId = store.read((state) => state.posts.find((post) => post.deleteAt === 0 && post.fileIds.includes(fileId))?.id ?? '');
    return c.json(toMattermostFileInfo(file, postId));
  });
  app.get('/api/v4/files/:file_id/thumbnail', async (c) => fileResponse(c, services, 'inline-preview'));
  app.get('/api/v4/files/:file_id/preview', async (c) => fileResponse(c, services, 'inline-preview'));
  app.get('/api/v4/files/:file_id/link', async (c) => {
    const auth = await requireAuth(c, services);
    return c.json(services.files.publicLink(services.files.getFile(c.req.param('file_id'), auth.user)));
  });
  app.get('/files/:file_id/public', (c) => c.text('Public file links require signed storage in production.', 403));

  app.get('/api/v4/users/:user_id/preferences', async (c) => {
    const auth = await requireAuth(c, services);
    const userId = c.req.param('user_id') === 'me' ? auth.user.id : c.req.param('user_id');
    const preferences = services.preferences.list(userId, auth.user).map(toMattermostPreference);
    if (!preferences.some((preference) => preference.category === 'theme')) {
      preferences.push({ user_id: userId, category: 'theme', name: '', value: NativeDarkTheme });
    }
    return c.json(preferences);
  });
  app.put('/api/v4/users/:user_id/preferences', async (c) => {
    const auth = await requireAuth(c, services);
    const body = await readJson(c, PreferenceSchema);
    return c.json((await services.preferences.set(c.req.param('user_id'), body, auth.user)).map(toMattermostPreference));
  });
  app.post('/api/v4/users/:user_id/preferences/delete', async (c) => {
    const auth = await requireAuth(c, services);
    const body = await readJson(c, DeletePreferenceSchema);
    await services.preferences.delete(c.req.param('user_id'), body, auth.user);
    return c.json(ok());
  });
  app.get('/api/v4/users/:user_id/status', async (c) => {
    await requireAuth(c, services);
    return c.json(services.statuses.get(c.req.param('user_id')));
  });
  app.put('/api/v4/users/:user_id/status', async (c) => {
    const auth = await requireAuth(c, services);
    if (auth.user.id !== c.req.param('user_id') && !isAdmin(auth.user)) {
      throw forbidden();
    }
    const body = await readJson(c, StatusSchema);
    return c.json(await services.statuses.set(c.req.param('user_id'), body.status, body.manual));
  });
  app.post('/api/v4/users/status/ids', async (c) => {
    await requireAuth(c, services);
    const ids = await readJson(c, z.array(z.string()));
    return c.json(services.statuses.byIds(ids));
  });
  app.post('/api/v4/users/:user_id/typing', async (c) => {
    const auth = await requireAuth(c, services);
    const body = await readJson(c, z.object({ channel_id: z.string(), parent_id: z.string().optional().default('') }));
    const typingUserId = c.req.param('user_id');
    if (typingUserId !== auth.user.id) {
      throw forbidden();
    }
    services.channels.assertMember(body.channel_id, auth.user.id);
    const typingUser = auth.user;
    await services.hub.broadcast(
      'typing',
      {
        user_id: typingUserId,
        channel_id: body.channel_id,
        parent_id: body.parent_id,
        sender_name: typingUser?.username ?? '',
        is_bot: typingUser?.isBot ?? false
      },
      { channel_id: body.channel_id, omit_users: [auth.user.id] }
    );
    return c.json(ok());
  });

  app.get('/api/v4/config', async (c) => {
    requireAdmin((await requireAuth(c, services)).user);
    return c.json(services.config.fullConfig());
  });
  app.put('/api/v4/config', async (c) => {
    const auth = await requireAuth(c, services);
    requireAdmin(auth.user);
    const body = await readJson(c, ConfigPatchSchema);
    return c.json(await services.config.patchConfig(asJsonRecord(body), auth.user.id));
  });
  app.put('/api/v4/config/patch', async (c) => {
    const auth = await requireAuth(c, services);
    requireAdmin(auth.user);
    const body = await readJson(c, ConfigPatchSchema);
    if (typeof body.PrivacySettings === 'object' && body.PrivacySettings !== null && !Array.isArray(body.PrivacySettings)) {
      await services.privacy.update(mapPrivacyPatch(body.PrivacySettings as Record<string, unknown>), auth.user.id);
    }
    return c.json(await services.config.patchConfig(asJsonRecord(body), auth.user.id));
  });
  app.post('/api/v4/config/reload', async (c) => {
    requireAdmin((await requireAuth(c, services)).user);
    return c.json(ok());
  });
  app.get('/api/v4/metrics', async (c) => {
    requireAdmin((await requireAuth(c, services)).user);
    return c.json({
      ...store.read((state) => state.metrics),
      abuse_control: await abuseControl.telemetry()
    });
  });
  app.get('/api/v4/ha/status', async (c) => {
    requireAdmin((await requireAuth(c, services)).user);
    return c.json({
      websocket_fanout_mode: websocketFanout.mode,
      redis_fanout_enabled: websocketFanout.redisImplemented,
      redis_url_configured: env.REDIS_URL.length > 0,
      distributed_rate_limit_enabled: env.ENABLE_DISTRIBUTED_RATE_LIMIT,
      sticky_session_free_websockets: websocketFanout.stickySessionFree,
      multi_process_websocket_safe: websocketFanout.multiProcessSafe,
      local_connection_count: services.hub.connectionCount()
    });
  });
  app.get('/api/v4/push/status', async (c) => {
    await requireAuth(c, services);
    return c.json({
      enabled: false,
      mobile_compatible_ack: true,
      transport: 'disabled'
    });
  });
  app.post('/api/v4/push/notify', async (c) => {
    const auth = await requireAuth(c, services);
    requireAdmin(auth.user);
    const body = await readJson(c, PushNotifySchema);
    await services.hub.broadcast(
      'push_notification',
      {
        user_id: body.user_id ?? '',
        channel_id: body.channel_id ?? '',
        post_id: body.post_id ?? '',
        message: body.message
      },
      {
        ...(body.user_id === undefined ? {} : { user_id: body.user_id }),
        ...(body.channel_id === undefined ? {} : { channel_id: body.channel_id })
      }
    );
    await services.auditLog.record({
      actorUserId: auth.user.id,
      action: 'push.notification_queued',
      targetId: body.post_id ?? body.channel_id ?? body.user_id ?? null
    });
    return c.json({ status: 'OK', queued: false, reason: 'push transport disabled' });
  });
  app.post('/api/v4/notifications/ack', async (c) => {
    await requireAuth(c, services);
    return c.json(ok());
  });
  app.post('/api/v4/import/mattermost', async (c) => {
    const auth = await requireAuth(c, services);
    requireAdmin(auth.user);
    const body = await readJson(c, MattermostImportSchema);
    const defaultTeamId = services.teams.listVisibleTeams(auth.user).at(0)?.id ?? '';
    const defaultChannelId = services.channels.listForUser(auth.user.id).at(0)?.id ?? '';
    const channelIdByName = new Map<string, string>();
    let importedChannels = 0;
    let importedPosts = 0;

    if (!body.dry_run) {
      for (const channelInput of body.channels) {
        const channel = await services.channels.createChannel({
          creatorId: auth.user.id,
          teamId: channelInput.team_id ?? defaultTeamId,
          type: channelInput.type,
          name: channelInput.name,
          displayName: channelInput.display_name,
          header: channelInput.header,
          purpose: channelInput.purpose
        });
        if (channelInput.retention_days !== undefined) {
          await services.channels.patchChannel(channel.id, { retentionDays: channelInput.retention_days }, auth.user);
        }
        channelIdByName.set(channel.name, channel.id);
        importedChannels += 1;
      }

      for (const postInput of body.posts) {
        const channelId = postInput.channel_id.length > 0 ? (channelIdByName.get(postInput.channel_id) ?? postInput.channel_id) : defaultChannelId;
        if (channelId.length === 0) {
          throw badRequest('Import post requires a channel_id when no default channel exists');
        }
        await services.posts.createPost({
          actor: auth.user,
          channelId,
          message: postInput.message,
          rootId: postInput.root_id,
          props: asJsonRecord(postInput.props)
        });
        importedPosts += 1;
      }
      await services.auditLog.record({
        actorUserId: auth.user.id,
        action: 'import.mattermost_archive',
        metadata: { channels: importedChannels, posts: importedPosts }
      });
    }

    return c.json({
      status: 'OK',
      dry_run: body.dry_run,
      planned_channels: body.channels.length,
      planned_posts: body.posts.length,
      imported_channels: importedChannels,
      imported_posts: importedPosts
    });
  });

  app.get('/api/v4/commands', async (c) => {
    await requireAuth(c, services);
    const teamId = c.req.query('team_id') ?? services.teams.defaultTeamIds()[0] ?? '';
    const customOnly = c.req.query('custom_only') === 'true';
    return c.json(services.slashCommands.list(teamId, { customOnly }).map(toMattermostCommand));
  });
  app.post('/api/v4/commands', async (c) => {
    const auth = await requireAuth(c, services);
    const body = await readJson(
      c,
      z.object({
        team_id: z.string(),
        trigger: z.string(),
        url: z.string().default(''),
        method: z.enum(['GET', 'POST']).default('POST'),
        description: z.string().default('')
      })
    );
    return c.json(
      toMattermostCommand(await services.slashCommands.create(auth.user, {
        teamId: body.team_id,
        trigger: body.trigger,
        url: body.url,
        method: body.method,
        description: body.description
      }))
    );
  });
  app.post('/api/v4/commands/execute', async (c) => {
    const auth = await requireAuth(c, services);
    const body = await readJson(c, z.object({ command: z.string(), channel_id: z.string(), root_id: z.string().optional() }));
    return c.json(await services.slashCommands.execute(body.command, body.channel_id, auth.user, body.root_id));
  });
  app.get('/api/v4/teams/:team_id/commands/autocomplete', async (c) => {
    await requireAuth(c, services);
    return c.json(services.slashCommands.list(c.req.param('team_id')).map(toMattermostCommand));
  });
  app.get('/api/v4/teams/:team_id/commands/autocomplete_suggestions', async (c) => {
    await requireAuth(c, services);
    return c.json(services.slashCommands.autocompleteSuggestions(c.req.param('team_id'), c.req.query('user_input') ?? ''));
  });

  app.get('/admin/browser-capabilities', async (c) => {
    c.header('Cache-Control', 'no-store');
    requireAdmin((await requireAuth(c, services)).user);
    return c.json({ schema: 1, bot_operation_ids: 'caller-bound-v1' });
  });
  app.get('/admin/users', async (c) => {
    const auth = await requireAuth(c, services);
    requireAdmin(auth.user);
    return c.json(services.users.listAll(auth.user).map((user) => toMattermostUser(user, { includeEmail: true })));
  });
  app.post('/admin/users', async (c) => {
    const auth = await requireAuth(c, services);
    requireAdmin(auth.user);
    const body = await readJson(c, AdminUserCreateSchema);
    const user = await services.users.createUser({
      username: body.username,
      email: body.email,
      password: body.password,
      role: body.role.includes('system_user') ? body.role : body.role + ' system_user',
      actorUserId: auth.user.id
    });
    const team = await services.teams.ensureDefaultTeam(auth.user.id);
    await services.teams.addUserToTeam(team.id, user.id, '');
    for (const channel of services.channels.listTeamChannels(team.id).filter((item) => item.type === 'O')) {
      await services.channels.addUserToChannel(channel.id, user.id, '');
    }
    const patch: Parameters<ServiceBundle['users']['patchUser']>[1] = {};
    if (body.first_name) patch.firstName = body.first_name;
    if (body.last_name) patch.lastName = body.last_name;
    if (body.nickname) patch.nickname = body.nickname;
    if (body.position) patch.position = body.position;
    const updated = Object.keys(patch).length > 0 ? await services.users.patchUser(user.id, patch, auth.user) : user;
    return c.json(toMattermostUser(updated, { includeEmail: true }), 201);
  });
  app.post('/admin/users/:id/deactivate', async (c) => {
    const auth = await requireAuth(c, services);
    return c.json(
      toMattermostUser(await services.users.setDisabled(c.req.param('id'), true, auth.user), {
        includeEmail: true
      })
    );
  });
  app.post('/admin/users/:id/reactivate', async (c) => {
    const auth = await requireAuth(c, services);
    return c.json(
      toMattermostUser(await services.users.setDisabled(c.req.param('id'), false, auth.user), {
        includeEmail: true
      })
    );
  });
  app.post('/admin/users/:id/reset-password', async (c) => {
    const auth = await requireAuth(c, services);
    const body = await readJson(c, PasswordSchema);
    await services.users.changePassword(c.req.param('id'), body.new_password, auth.user, undefined, auth.sessionId);
    return c.json(ok());
  });
  app.post('/admin/users/:id/revoke-sessions', async (c) => {
    const auth = await requireAuth(c, services);
    await services.sessions.revokeUserSessions(c.req.param('id'), auth.user);
    return c.json(ok());
  });
  app.post('/admin/invites', async (c) => {
    const auth = await requireAuth(c, services);
    const body = await readJson(c, InviteSchema);
    const inviteInput: Parameters<ServiceBundle['invites']['createInvite']>[0] = {
      actor: auth.user,
      maxUses: body.max_uses,
      expiresInHours: body.expires_in_hours
    };
    if (body.role !== undefined) {
      inviteInput.role = body.role;
    }
    const result = await services.invites.createInvite(inviteInput);
    return c.json({ invite: sanitizeInvite(result.invite), code: result.code }, 201);
  });
  app.get('/admin/invites', async (c) => {
    const auth = await requireAuth(c, services);
    return c.json(services.invites.listActive(auth.user).map(sanitizeInvite));
  });
  app.delete('/admin/invites/:id', async (c) => {
    const auth = await requireAuth(c, services);
    return c.json(sanitizeInvite(await services.invites.revokeInvite(c.req.param('id'), auth.user)));
  });
  app.get('/admin/bots', async (c) => {
    const auth = await requireAuth(c, services);
    requireAdmin(auth.user);
    return c.json(
      services.bots.list(auth.user).map((bot) => ({
        id: bot.id,
        user_id: bot.userId,
        username: services.users.getById(bot.userId).username,
        display_name: bot.displayName,
        description: bot.description,
        create_at: bot.createAt,
        update_at: bot.updateAt,
        token_configured: true
      }))
    );
  });
  app.post('/admin/bots', async (c) => {
    c.header('Cache-Control', 'no-store');
    const auth = await requireAuth(c, services);
    const body = await readJson(c, AdminBotCreateSchema);
    const result = await services.bots.provision(auth.user, body.username, body.display_name, body.operation_id, body.create_only);
    c.header('X-Operation-ID', result.operationId);
    return c.json(
      {
        operation_id: result.operationId,
        token: result.token,
        user: toMattermostUser(result.user, { includeEmail: false }),
        bot: {
          id: result.bot.id,
          user_id: result.bot.userId,
          display_name: result.bot.displayName,
          update_at: result.bot.updateAt
        }
      },
      201
    );
  });
  app.put('/admin/bots/:user_id', async (c) => {
    const auth = await requireAuth(c, services);
    const body = await readJson(c, AdminBotUpdateSchema);
    const result = await services.bots.updateIdentity(
      auth.user,
      c.req.param('user_id'),
      body.username,
      body.display_name,
      body.operation_id
    );
    c.header('X-Operation-ID', result.operationId);
    return c.json({
      operation_id: result.operationId,
      user: toMattermostUser(result.user, { includeEmail: false }),
      bot: {
        id: result.bot.id,
        user_id: result.bot.userId,
        display_name: result.bot.displayName,
        update_at: result.bot.updateAt
      }
    });
  });
  app.post('/admin/bots/:user_id/regenerate-token', async (c) => {
    c.header('Cache-Control', 'no-store');
    const auth = await requireAuth(c, services);
    const operationId = c.req.header('X-Bot-Operation-ID');
    if (operationId && !/^[a-z0-9]{26}$/u.test(operationId)) throw badRequest('A 26-character operation ID is required');
    const result = await services.bots.regenerateToken(auth.user, c.req.param('user_id'), operationId);
    c.header('X-Operation-ID', result.operationId);
    return c.json({
      operation_id: result.operationId,
      token: result.token,
      bot: {
        id: result.bot.id,
        user_id: result.bot.userId,
        display_name: result.bot.displayName,
        update_at: result.bot.updateAt
      }
    });
  });
  app.get('/admin/bot-operations/:operation_id', async (c) => {
    const auth = await requireAuth(c, services);
    const operation = services.bots.operation(auth.user, c.req.param('operation_id'));
    return c.json({
      operation_id: operation.operationId,
      status: operation.publishedAt === 0 ? 'accepted' : 'published',
      action: operation.action,
      target_id: operation.targetId,
      create_at: operation.createAt,
      published_at: operation.publishedAt
    });
  });
  app.get('/admin/hermes/health', async (c) => {
    const auth = await requireAuth(c, services);
    requireAdmin(auth.user);
    const bots = services.bots.list(auth.user);
    const botUserIds = new Set(bots.map((bot) => bot.userId));
    const body = store.read((state) => {
      const botUsers = state.users
        .filter((user) => botUserIds.has(user.id))
        .map((user) => ({
          id: user.id,
          username: user.username,
          display_name: user.botDescription || user.username,
          delete_at: user.deleteAt
        }));
      const lastBotPost = [...state.posts].filter((post) => botUserIds.has(post.userId)).sort((a, b) => b.createAt - a.createAt)[0];
      const recentEvents = state.supervisionEvents
        .filter((event) => event.agentUserId !== null || event.action.includes('agent'))
        .slice(0, 8)
        .map((event) => ({
          id: event.id,
          create_at: event.createAt,
          action: event.action,
          state: event.state,
          channel_id: event.channelId,
          post_id: event.postId
        }));
      return {
        token_configured: bots.length > 0,
        bot_count: bots.length,
        bot_users: botUsers,
        last_bot_post_at: lastBotPost?.createAt ?? 0,
        websocket_connections: services.hub.connectionCount(),
        recent_agent_events: recentEvents
      };
    });
    return c.json(body);
  });
  app.post('/admin/test-artifacts/cleanup', async (c) => {
    const auth = await requireAuth(c, services);
    requireAdmin(auth.user);
    const body = await readJson(c, TestCleanupSchema);
    return c.json(await cleanupTestArtifacts(store, auth.user.id, body));
  });
  app.get('/admin/supervision/events', async (c) => c.json(services.supervision.events((await requireAuth(c, services)).user)));
  app.get('/admin/supervision/policy', async (c) => {
    requireAdmin((await requireAuth(c, services)).user);
    return c.json(services.supervision.getPolicy());
  });
  app.put('/admin/supervision/policy', async (c) => {
    const auth = await requireAuth(c, services);
    const body = await readJson(c, SupervisionPatchSchema);
    const patch: Parameters<ServiceBundle['supervision']['updatePolicy']>[0] = {};
    if (body.mode !== undefined) {
      patch.mode = body.mode;
    }
    if (body.blockedTerms !== undefined) {
      patch.blockedTerms = body.blockedTerms;
    }
    return c.json(await services.supervision.updatePolicy(patch, auth.user));
  });
  app.post('/admin/supervision/posts/:post_id/:decision', async (c) => {
    const auth = await requireAuth(c, services);
    const decision = c.req.param('decision');
    if (decision !== 'approved' && decision !== 'rejected') {
      throw badRequest('Decision must be approved or rejected');
    }
    return c.json(toMattermostPost(await services.supervision.moderate(c.req.param('post_id'), decision, auth.user)));
  });

  app.get('/api/v4/agents/status', async (c) => {
    await requireAuth(c, services);
    const available = services.agents.publicList().length > 0;
    return c.json(available ? { available: true } : { available: false, reason: 'No verified agents are configured' });
  });
  app.get('/api/v4/agents', async (c) => {
    const auth = await requireAuth(c, services);
    if (!isAdmin(auth.user)) return c.json(services.agents.publicList());
    const publicById = new Map(services.agents.publicList().map((agent) => [agent.id, agent]));
    return c.json(
      services.agents.list(auth.user).map((agent) => ({
        ...agent,
        displayName: agent.name,
        service_type: publicById.get(agent.id)?.service_type ?? 'chattermost',
        service_id: agent.id
      }))
    );
  });
  app.post('/api/v4/agents', async (c) => {
    const auth = await requireAuth(c, services);
    const body = await readJson(c, AgentSchema);
    const agentInput: Parameters<ServiceBundle['agents']['createOrUpdate']>[1] = {
      name: body.name,
      username: body.username
    };
    if (body.id !== undefined) {
      agentInput.id = body.id;
    }
    if (body.permissions !== undefined) {
      agentInput.permissions = asJsonRecord(body.permissions);
    }
    if (body.channelRouting !== undefined) {
      agentInput.channelRouting = asJsonRecord(body.channelRouting);
    }
    if (body.userAllowlists !== undefined) {
      agentInput.userAllowlists = asJsonRecord(body.userAllowlists);
    }
    if (body.memoryPolicy !== undefined) {
      agentInput.memoryPolicy = asJsonRecord(body.memoryPolicy);
    }
    if (body.verified !== undefined) {
      agentInput.verified = body.verified;
    }
    return c.json(await services.agents.createOrUpdate(auth.user, agentInput));
  });
  app.post('/api/v4/agents/bindings', async (c) => {
    const auth = await requireAuth(c, services);
    requireAdmin(auth.user);
    const body = await readJson(
      c,
      z.object({
        agentUserId: z.string(),
        channelId: z.string(),
        threadRootId: z.string().default(''),
        humanUserId: z.string(),
        sessionKey: z.string(),
        policy: z.record(z.string(), z.unknown()).default({})
      })
    );
    return c.json(await services.agents.bindConversation({ ...body, policy: asJsonRecord(body.policy) }));
  });
  app.post('/api/v4/admin/policy-simulator', async (c) => {
    const auth = await requireAuth(c, services);
    const body = await readJson(c, z.record(z.string(), z.unknown()));
    return c.json(services.agents.policySimulation(auth.user, asJsonRecord(body)));
  });
  app.post('/api/v4/webhooks/incoming', async (c) => {
    const auth = await requireAuth(c, services);
    const body = await readJson(c, z.object({ channel_id: z.string(), label: z.string().default('External agent') }));
    const { record, secret } = await createIncomingWebhook(store, env, auth.user, body.channel_id, body.label);
    return c.json(
      {
        id: record.id,
        create_at: record.createAt,
        channel_id: record.channelId,
        label: record.label,
        enabled: record.enabled,
        url: `${env.SERVER_URL}/api/v4/webhooks/incoming/${record.id}/${secret}`,
        secret
      },
      201
    );
  });
  app.post('/api/v4/webhooks/incoming/:id/:secret', async (c) => {
    const webhook = store.read((state) => state.incomingWebhooks.find((item) => item.id === c.req.param('id')) ?? null);
    // A single not-found response for missing, disabled, or wrong-secret
    // webhooks avoids confirming which id values exist. The secret is compared
    // against its stored hash with a length-safe timing-independent check.
    if (webhook === null || !webhook.enabled || !safeEqualText(hashToken(c.req.param('secret'), env), webhook.secretHash)) {
      throw notFound('Webhook');
    }
    const body = await readJson(c, z.object({ text: z.string().default(''), username: z.string().default('') }));
    // The webhook posts as its creator (an admin at creation time), never as a
    // caller-selected account. Display overrides cannot match administrator,
    // bot, or reserved system identities and immutable origin metadata lets
    // every client distinguish the webhook from an authenticated user.
    const poster = (webhook.creatorId !== undefined ? services.users.findById(webhook.creatorId) : null) ?? services.users.findByUsername(env.ADMIN_USERNAME);
    if (poster === null || poster.disabledAt > 0 || poster.deleteAt > 0) {
      throw notFound('Webhook user');
    }
    const overrideUsername = body.username.trim();
    if (overrideUsername.length > 0 && isProtectedWebhookDisplayName(overrideUsername, services)) {
      throw badRequest('Webhook display name is reserved');
    }
    const props: JsonRecord = {
      from_webhook: 'true',
      webhook_id: webhook.id,
      webhook_label: webhook.label,
      webhook_owner_id: poster.id,
      webhook_owner_username: poster.username,
      ...(overrideUsername.length > 0 ? { override_username: overrideUsername } : {})
    };
    return c.json(
      toMattermostPost(
        await services.posts.createPost({
          actor: poster,
          channelId: webhook.channelId,
          message: body.text,
          props
        })
      )
    );
  });

  app.get('/api/v4/websocket', (c) =>
    c.json(
      {
        id: 'api.websocket.upgrade_required',
        message: 'WebSocket upgrade required',
        detailed_error: '',
        request_id: c.get('requestId'),
        status_code: 426
      },
      426
    )
  );

  return { app, services, store, abuseControl };
}

function isProtectedWebhookDisplayName(displayName: string, services: ServiceBundle): boolean {
  const normalized = normalizeWebhookIdentity(displayName);
  // Webhook display overrides are untrusted identity labels rather than user
  // prose. Restrict them to printable ASCII after NFKC so Cyrillic, Greek, and
  // other Unicode homoglyphs cannot impersonate protected accounts.
  if (!/^[\x20-\x7e]+$/u.test(normalized)) {
    return true;
  }
  const requestedKey = webhookIdentityKey(normalized);
  const protectedNames = [
    'system',
    'system_admin',
    'chattermost',
    ...services.users.protectedDisplayNames()
  ];
  return protectedNames.some((name) => webhookIdentityKey(normalizeWebhookIdentity(name)) === requestedKey);
}

function normalizeWebhookIdentity(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/gu, ' ');
}

function webhookIdentityKey(value: string): string {
  return value.replace(/[^a-z0-9]/gu, '');
}

async function patchUserRoute(c: Context<AppHonoEnv>, services: ServiceBundle): Promise<Response> {
  const auth = await requireAuth(c, services);
  const body = await readJson(c, PatchUserSchema);
  const patch: Parameters<ServiceBundle['users']['patchUser']>[1] = {};
  if (body.nickname !== undefined) {
    patch.nickname = body.nickname;
  }
  if (body.first_name !== undefined) {
    patch.firstName = body.first_name;
  }
  if (body.last_name !== undefined) {
    patch.lastName = body.last_name;
  }
  if (body.position !== undefined) {
    patch.position = body.position;
  }
  if (body.locale !== undefined) {
    patch.locale = body.locale;
  }
  const user = await services.users.patchUser(requiredParam(c, 'user_id') === 'me' ? auth.user.id : requiredParam(c, 'user_id'), patch, auth.user);
  return c.json(toMattermostUser(user, { includeEmail: true }));
}

async function patchChannelRoute(c: Context<AppHonoEnv>, services: ServiceBundle): Promise<Response> {
  const auth = await requireAuth(c, services);
  const body = await readJson(c, ChannelPatchSchema);
  const patch: Parameters<ServiceBundle['channels']['patchChannel']>[1] = {};
  if (body.display_name !== undefined) {
    patch.displayName = body.display_name;
  }
  if (body.header !== undefined) {
    patch.header = body.header;
  }
  if (body.purpose !== undefined) {
    patch.purpose = body.purpose;
  }
  if (body.retention_days !== undefined) {
    patch.retentionDays = body.retention_days;
  }
  const channel = await services.channels.patchChannel(requiredParam(c, 'channel_id'), patch, auth.user);
  return c.json(toMattermostChannel(channel));
}

async function patchPostRoute(c: Context<AppHonoEnv>, services: ServiceBundle): Promise<Response> {
  const auth = await requireAuth(c, services);
  const body = await readJson(c, PostPatchSchema);
  return c.json(toMattermostPost(await services.posts.patchPost(requiredParam(c, 'post_id'), buildPostPatch(body), auth.user)));
}

function buildPostPatch(body: z.infer<typeof PostPatchSchema>): Parameters<ServiceBundle['posts']['patchPost']>[1] {
  const patch: Parameters<ServiceBundle['posts']['patchPost']>[1] = {};
  if (body.message !== undefined) {
    patch.message = body.message;
  }
  if (body.is_pinned !== undefined) {
    patch.isPinned = body.is_pinned;
  }
  if (body.file_ids !== undefined) {
    patch.fileIds = body.file_ids;
  }
  return patch;
}

async function fileResponse(c: Context<AppHonoEnv>, services: ServiceBundle, disposition: 'attachment' | 'inline-preview'): Promise<Response> {
  const auth = await requireAuth(c, services);
  const file = services.files.getFile(requiredParam(c, 'file_id'), auth.user);
  const bytes = await services.files.readFile(file);
  const inlinePreview = disposition === 'inline-preview' && isSafeInlinePreviewType(file.mimeType);
  return new Response(Buffer.from(bytes), {
    headers: {
      'Content-Type': inlinePreview ? file.mimeType : safeDownloadContentType(file.mimeType),
      'Content-Length': String(file.size),
      'Content-Disposition': contentDisposition(inlinePreview ? 'inline' : 'attachment', file.name),
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

function isSafeInlinePreviewType(mimeType: string): boolean {
  return ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mimeType);
}

function safeDownloadContentType(mimeType: string): string {
  return isSafeInlinePreviewType(mimeType) || mimeType === 'text/plain' ? mimeType : 'application/octet-stream';
}

function contentDisposition(disposition: 'inline' | 'attachment', filename: string): string {
  return `${disposition}; filename="${filename.replaceAll('"', '')}"`;
}

function requestContext(store: StateStore, env: AppEnv): MiddlewareHandler<AppHonoEnv> {
  return async (c, next) => {
    const requestId = randomUUID();
    c.set('requestId', requestId);
    c.set('env', env);
    c.header('X-Request-Id', requestId);
    store.incrementMetric('httpRequests');
    await next();
  };
}

// CSRF protection for cookie-authenticated Web UI writes. Bearer-token API
// clients (Hermes, mobile, mmctl) are exempt because tokens are not sent
// automatically by browsers. Cookie-authenticated unsafe methods must carry a
// same-origin Origin or Referer header.
function csrfProtection(env: AppEnv): MiddlewareHandler<AppHonoEnv> {
  const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
  const allowedOrigins = configuredBrowserOrigins(env);
  return async (c, next) => {
    if (safeMethods.has(c.req.method)) {
      await next();
      return;
    }
    const authorization = c.req.header('authorization');
    if (authorization !== undefined && /^Bearer\s+/iu.test(authorization)) {
      await next();
      return;
    }
    const cookieHeader = c.req.header('cookie');
    if (cookieHeader === undefined) {
      await next();
      return;
    }
    const cookies = parseCookie(cookieHeader);
    const hasSessionCookie = cookies[env.SESSION_COOKIE_NAME] !== undefined || cookies.MMSID !== undefined;
    if (!hasSessionCookie) {
      await next();
      return;
    }
    const origin = c.req.header('origin');
    if (origin !== undefined) {
      if (!allowedOrigins.includes(origin)) {
        throw forbidden('Cross-origin request rejected by CSRF protection');
      }
      await next();
      return;
    }
    const referer = c.req.header('referer');
    if (referer !== undefined) {
      if (!allowedOrigins.includes(originOf(referer)??'')) {
        throw forbidden('Cross-origin request rejected by CSRF protection');
      }
      await next();
      return;
    }
    throw forbidden('Missing Origin or Referer header for cookie-authenticated request');
  };
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function secureHeaders(env: AppEnv): MiddlewareHandler {
  return async (c, next) => {
    await next();
    const serverVersion = env.ALLOW_VERSION_ADVERTISEMENT ? env.COMPATIBILITY_SERVER_VERSION : '0.0.0-compatible';
    c.header('X-Version-Id', serverVersion);
    c.header('X-Mattermost-Version', serverVersion);
    c.header('Mattermost-Server-Version', serverVersion);
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    c.header('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:; frame-ancestors 'none'");
  };
}

function requestBodyLimit(): MiddlewareHandler {
  const jsonLimit = honoBodyLimit({
    maxSize: 1024 * 1024,
    onError: () => {
      throw new HttpAppError('api.context.request_body_too_large.app_error', 'Request body is too large', 413);
    }
  });
  const uploadLimit = honoBodyLimit({
    maxSize: 30 * 1024 * 1024,
    onError: () => {
      throw new HttpAppError('api.context.request_body_too_large.app_error', 'Request body is too large', 413);
    }
  });
  return async (c, next) => {
    const contentType = c.req.header('content-type')?.toLowerCase() ?? '';
    const isMultipartUpload =
      contentType.startsWith('multipart/form-data') &&
      ((c.req.method === 'POST' && c.req.path === '/api/v4/files') ||
        (c.req.method === 'POST' && /^\/api\/v4\/users\/[^/]+\/image$/u.test(c.req.path)));
    return (isMultipartUpload ? uploadLimit : jsonLimit)(c, next);
  };
}

function paginate<T>(c: Context<AppHonoEnv>, items: T[]): T[] {
  const page = queryInteger(c.req.query('page'), 0, 0, Number.MAX_SAFE_INTEGER);
  const perPage = queryInteger(c.req.query('per_page'), 60, 1, 200);
  return items.slice(page * perPage, page * perPage + perPage);
}

function queryInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || !/^\d+$/u.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

async function readJson<T extends z.ZodType>(c: Context<AppHonoEnv>, schema: T): Promise<z.output<T>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest('Invalid JSON request body');
  }
  const parsed = schema.parse(body) as z.output<T>;
  return parsed;
}

function requiredParam(c: Context<AppHonoEnv>, name: string): string {
  const value = c.req.param(name);
  if (value === undefined) {
    throw badRequest(`Missing route parameter ${name}`);
  }
  return value;
}

async function requireAuth(c: Context<AppHonoEnv>, services: ServiceBundle): Promise<AuthContext> {
  const auth = await authenticateRequest(c, services);
  if (auth === null) {
    throw unauthorized();
  }
  return auth;
}

async function authenticateRequest(c: Context<AppHonoEnv>, services: ServiceBundle): Promise<AuthContext | null> {
  const authorization = c.req.header('authorization');
  if (authorization !== undefined) {
    const bearer = /^Bearer\s+(.+)$/iu.exec(authorization)?.[1];
    if (bearer === undefined) return null;
    const auth = await services.sessions.authenticateWebSession(bearer);
    if (auth !== null) {
      return { ...auth, authMethod: auth.authMethod === 'bot' ? 'bot' : 'bearer' };
    }
    // An explicit credential must fail closed instead of falling back to an
    // ambient browser cookie under a different authentication context.
    return null;
  }
  const cookieHeader = c.req.header('cookie');
  if (cookieHeader !== undefined) {
    const cookies = parseCookie(cookieHeader);
    const token = cookies[c.get('env').SESSION_COOKIE_NAME] ?? cookies.MMSID;
    if (token !== undefined) {
      return services.sessions.authenticateWebSession(token);
    }
  }
  return null;
}

function canSeeEmail(viewer: Parameters<typeof isAdmin>[0], target: { id: string }, services: ServiceBundle): boolean {
  return viewer.id === target.id || isAdmin(viewer) || services.privacy.get().showEmailAddress;
}

function canSearchEmail(viewer: Parameters<typeof isAdmin>[0], services: ServiceBundle): boolean {
  return isAdmin(viewer) || services.privacy.get().showEmailAddress;
}

function svgResponse(svg: string): Response {
  return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'private, max-age=60' } });
}

function pickFirstString(value: FormDataEntryValue | FormDataEntryValue[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    const found = value.find((entry) => typeof entry === 'string');
    return typeof found === 'string' ? found : undefined;
  }
  return typeof value === 'string' ? value : undefined;
}

function sanitizeInvite(invite: { id: string; rawCodePreview: string; maxUses: number; uses: number; expiresAt: number; role: string; teamIds: string[]; channelIds: string[]; disabledAt: number }): JsonRecord {
  return {
    id: invite.id,
    code_preview: invite.rawCodePreview,
    max_uses: invite.maxUses,
    uses: invite.uses,
    expires_at: invite.expiresAt,
    role: invite.role,
    team_ids: invite.teamIds,
    channel_ids: invite.channelIds,
    disabled_at: invite.disabledAt
  };
}

function toCustomEmojiJson(emoji: { id: string; name: string; emoji: string; creatorUserId: string; createAt: number; updateAt: number; deleteAt: number }): JsonRecord {
  return {
    id: emoji.id,
    name: emoji.name,
    emoji: emoji.emoji,
    creator_id: emoji.creatorUserId,
    create_at: emoji.createAt,
    update_at: emoji.updateAt,
    delete_at: emoji.deleteAt
  };
}

async function cleanupTestArtifacts(store: StateStore, actorUserId: string, input: z.output<typeof TestCleanupSchema>): Promise<JsonRecord> {
  const cutoff = input.older_than_hours > 0 ? Date.now() - input.older_than_hours * 60 * 60 * 1000 : Number.POSITIVE_INFINITY;
  const preview = store.read((state) => {
    const users = state.users
      .filter((user) => user.deleteAt === 0)
      .filter((user) => user.createAt <= cutoff)
      .filter((user) => user.username.startsWith(input.username_prefix))
      .filter((user) => !user.roles.includes('system_admin') && !user.isBot)
      .map((user) => ({ id: user.id, username: user.username, create_at: user.createAt }));
    const channels = state.channels
      .filter((channel) => channel.deleteAt === 0)
      .filter((channel) => channel.type === 'O' || channel.type === 'P')
      .filter((channel) => channel.createAt <= cutoff)
      .filter((channel) => channel.name.startsWith(input.channel_name_prefix.toLowerCase()) || channel.displayName.startsWith(input.channel_name_prefix))
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        display_name: channel.displayName,
        type: channel.type,
        create_at: channel.createAt
      }));
    return { users, channels };
  });

  if (input.dry_run) {
    return {
      dry_run: true,
      filters: {
        username_prefix: input.username_prefix,
        channel_name_prefix: input.channel_name_prefix,
        older_than_hours: input.older_than_hours
      },
      matched_user_count: preview.users.length,
      matched_channel_count: preview.channels.length,
      users: preview.users,
      channels: preview.channels
    };
  }

  if (input.confirm !== 'cleanup test artifacts') {
    throw badRequest('Set confirm to "cleanup test artifacts" to apply cleanup.');
  }

  const userIds = new Set(preview.users.map((user) => user.id));
  const channelIds = new Set(preview.channels.map((channel) => channel.id));
  const now = Date.now();
  await store.write((state) => {
    for (const user of state.users) {
      if (userIds.has(user.id)) {
        user.disabledAt = now;
        user.deleteAt = now;
        user.updateAt = now;
      }
    }
    for (const session of state.sessions) {
      if (userIds.has(session.userId) && session.revokedAt === 0) {
        session.revokedAt = now;
      }
    }
    for (const channel of state.channels) {
      if (channelIds.has(channel.id)) {
        channel.deleteAt = now;
        channel.deleteBy = actorUserId;
        channel.updateAt = now;
      }
    }
    state.auditSequence += 1;
    state.auditLogs.unshift({
      id: randomUUID(),
      exportSequence: state.auditSequence,
      createAt: now,
      actorUserId,
      action: 'admin.test_artifacts.cleanup',
      targetId: null,
      ip: null,
      metadata: {
        username_prefix: input.username_prefix,
        channel_name_prefix: input.channel_name_prefix,
        users: preview.users.length,
        channels: preview.channels.length
      }
    });
  });

  return {
    dry_run: false,
    cleaned_user_count: preview.users.length,
    cleaned_channel_count: preview.channels.length,
    users: preview.users,
    channels: preview.channels
  };
}

function mapPrivacyPatch(input: Record<string, unknown>): Partial<ReturnType<ServiceBundle['privacy']['get']>> {
  const mapping: Record<string, string> = {
    ShowEmailAddress: 'showEmailAddress',
    ShowFullName: 'showFullName',
    TeammateNameDisplay: 'teammateNameDisplay',
    EnableDiagnostics: 'enableDiagnostics',
    EnableTelemetry: 'enableTelemetry',
    EnableSecurityAlerts: 'enableSecurityAlerts',
    EnableAdminNotices: 'enableAdminNotices',
    EnableUserNotices: 'enableUserNotices',
    EnablePublicFileLinks: 'enablePublicFileLinks',
    EnableFileAttachments: 'enableFileAttachments',
    EnableCustomEmoji: 'enableCustomEmoji',
    EnableEmojiPicker: 'enableEmojiPicker',
    EnableBotAccountCreation: 'enableBotAccountCreation',
    EnableUserAccessTokens: 'enableUserAccessTokens',
    EnablePostSearch: 'enablePostSearch',
    EnableFileSearch: 'enableFileSearch'
  };
  const result: Record<string, unknown> = {};
  for (const [external, internal] of Object.entries(mapping)) {
    if (external in input) {
      result[internal] = input[external];
    }
  }
  return result as Partial<ReturnType<ServiceBundle['privacy']['get']>>;
}

function stableCompatibilityId(value: string): string {
  return createHash('sha256').update(`chattermost:${value}`).digest('hex').slice(0, 26);
}

function toMattermostBuiltInRole(name: string): JsonRecord {
  const commonPermissions = ['read_channel', 'read_public_channel', 'create_post', 'create_post_public', 'edit_post', 'delete_post', 'add_reaction', 'remove_reaction', 'upload_file', 'view_members', 'use_channel_mentions', 'use_group_mentions'];
  const adminPermissions = ['manage_team', 'manage_channel_roles', 'manage_public_channel_members', 'manage_private_channel_members', 'delete_public_channel', 'delete_private_channel', 'edit_others_posts', 'delete_others_posts', 'manage_bots', 'manage_emojis'];
  const isAdminRole = name === 'system_admin' || name === 'team_admin' || name === 'channel_admin';
  return {
    id: stableCompatibilityId(`role:${name}`),
    name,
    display_name: name,
    description: `ChatterMost built-in ${name} role`,
    create_at: 0,
    update_at: 0,
    delete_at: 0,
    permissions: isAdminRole ? [...commonPermissions, ...adminPermissions] : commonPermissions,
    scheme_managed: true,
    built_in: true,
    scheme_id: null
  };
}
