import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AuditLogService } from '../../src/server/services.js';
import { JsonStore } from '../../src/server/store.js';
import type { StoreState } from '../../src/server/domain.js';
import { HiveAdminAccounts, validatedHiveAdminAccountReceipts } from '../../src/server/hive-admin-accounts.js';
import { bearer, createTestServer, firstChannelId, login, type TestServer } from './helpers.js';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof fsPromises>();
  return { ...actual, open: vi.fn(actual.open) };
});

const secret = 'a'.repeat(64);
const operation = '00000000-0000-4000-8000-000000000001';
const otherOperation = '00000000-0000-4000-8000-000000000002';
const endpoint = '/internal/hive/admin-accounts/';
const authority = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };
const input = { version: 1 as const, issuer: 'https://identity.example.test', subject: 'synthetic-subject',
  user_id: 'p'.repeat(26), username: 'provisioned_admin', email: 'provisioned@example.test' };
const servers: TestServer[] = [];
async function server(overrides: Record<string, string | undefined> = {}) {
  const value = await createTestServer({ HIVE_ADMIN_PROVISIONING_SECRET: secret,
    OATHWEAVE_ISSUER: input.issuer, OATHWEAVE_JWKS_URL: input.issuer + '/jwks', OATHWEAVE_USERINFO_URL: input.issuer + '/userinfo',
    OATHWEAVE_CHAT_IDENTITIES_JSON: '[]', TLS_CERT_PATH: '/opt/fixture/tls.crt', TLS_KEY_PATH: '/opt/fixture/tls.key', ...overrides });
  servers.push(value); return value;
}
function request(app: TestServer['app'], body: unknown = input, id = operation, headers: Record<string, string> = {}, address = '127.0.0.1') {
  return app.request(endpoint + id, { method: 'POST', headers: { 'content-type': 'application/json',
    'x-hive-admin-provisioning-secret': secret, ...headers }, body: JSON.stringify(body) }, { incoming: { socket: { remoteAddress: address } } });
}
afterEach(async () => { await Promise.all(servers.splice(0).map(value => value.store.close())); });

describe('Hive installation admin provisioning', () => {
  it('is absent by default and refuses browser/native credentials, remote peers and untrusted transport', async () => {
    const disabled = await server({ HIVE_ADMIN_PROVISIONING_SECRET: undefined });
    expect((await request(disabled.app)).status).toBe(404);
    const app = (await server()).app;
    for (const headers of [{ 'x-hive-admin-provisioning-secret': '' }, { 'x-hive-admin-provisioning-secret': 'b'.repeat(64) },
      { origin: 'https://chat.example.test' }, { referer: 'https://chat.example.test/' },
      { forwarded: 'for=127.0.0.1' }, { 'x-forwarded-for': '127.0.0.1' }, { 'x-real-ip': '127.0.0.1' }, { cookie: 'MMSID=synthetic' }, { authorization: 'Bearer synthetic' }]) {
      expect((await request(app, input, operation, headers)).status).toBe(403);
    }
    for (const address of ['192.0.2.5', '::ffff:192.0.2.5', '']) expect((await request(app, input, operation, {}, address)).status).toBe(403);
    expect((await app.request(endpoint + operation, { method: 'POST', headers: { 'x-hive-admin-provisioning-secret': secret }, body: JSON.stringify(input) })).status).toBe(403);
    const plaintext = await server({ TLS_CERT_PATH: undefined, TLS_KEY_PATH: undefined });
    expect((await request(plaintext.app)).status).toBe(403);
    expect(plaintext.store.read(state => state.hiveAdminAccountReceipts)).toEqual([]);
  });

  it('commits one exact active native admin with its receipt, safely repeats, and retains prior users/sessions/posts', async () => {
    const current = await server();
    const token = await login(current), channel = await firstChannelId(current.app, token);
    const beforeUsers = structuredClone(current.store.read(state => state.users));
    const beforeSessions = structuredClone(current.store.read(state => state.sessions));
    const [created, post] = await Promise.all([request(current.app), current.app.request('/api/v4/posts', {
      method: 'POST', headers: bearer(token), body: JSON.stringify({ channel_id: channel, message: 'A concurrent synthetic message' }) })]);
    expect(created.status).toBe(200); expect(post.status).toBe(201);
    const receipt = await created.json() as Record<string, unknown>;
    expect(receipt).toMatchObject({ schema: 1, operation_id: operation, user_id: input.user_id, issuer: input.issuer,
      subject: input.subject, status: 'committed', role: 'system_admin system_user' });
    expect(created.headers.get('cache-control')).toBe('no-store');
    const repeat = await request(current.app); expect(repeat.status).toBe(200); expect(await repeat.json()).toEqual(receipt);
    const read = await current.app.request(endpoint + operation, { headers: { 'x-hive-admin-provisioning-secret': secret } }, authority);
    expect(read.status).toBe(200); expect(await read.json()).toEqual(receipt);
    expect(JSON.stringify(receipt)).not.toMatch(/password|cookie|token|secret/iu);
    const state = current.store.read(value => value);
    expect(state.users.filter(user => user.id !== input.user_id)).toEqual(beforeUsers);
    expect(state.sessions).toEqual(beforeSessions);
    expect(state.hiveAdminAccountReceipts).toHaveLength(1);
    expect(state.posts.some(value => value.message === 'A concurrent synthetic message')).toBe(true);
    const user = state.users.find(value => value.id === input.user_id);
    expect(user).toMatchObject({ isBot: false, disabledAt: 0, deleteAt: 0, roles: 'system_admin system_user' });
    expect(user?.passwordHash).toMatch(/^\$scrypt\$/u);
    expect(state.teamMembers.some(value => value.userId === input.user_id)).toBe(true);
    expect(state.channelMembers.some(value => value.userId === input.user_id)).toBe(true);
    expect((await current.app.request('/api/v4/users/login', { method: 'POST', headers: current.baseHeaders,
      body: JSON.stringify({ login_id: input.username, password: 'ObviouslyFakePassword123!' }) })).status).toBe(400);
  });

  it('preserves authoritative leading underscore/hyphen usernames and refuses receipts after issuer drift', async () => {
    const current = await server();
    for (const [index, username] of ['_native_admin', '-native-admin'].entries()) {
      const id = index === 0 ? operation : otherOperation;
      const body = { ...input, subject: 'subject-' + String(index), user_id: (index === 0 ? 'x' : 'y').repeat(26),
        username, email: 'admin' + String(index) + '@example.test' };
      const reply = await request(current.app, body, id);
      expect(reply.status).toBe(200);
      expect(await reply.json()).toMatchObject({ username, user_id: body.user_id, subject: body.subject });
      expect(current.store.read(state => state.users.find(user => user.id === body.user_id)?.username)).toBe(username);
      const drifted = new HiveAdminAccounts(current.store,
        { OATHWEAVE_ISSUER: 'https://other-identity.example.test', OATHWEAVE_CHAT_IDENTITIES_JSON: '[]' }, current.services.auditLog);
      expect(() => drifted.read(id)).toThrow('different configured issuer');
    }
  });

  it('binds operation/identity/native ID without adopting collisions or changing established accounts', async () => {
    const current = await server(); expect((await request(current.app)).status).toBe(200);
    const before = structuredClone(current.store.read(state => ({ users: state.users, receipts: state.hiveAdminAccountReceipts })));
    for (const body of [{ ...input, subject: 'other-subject' }, { ...input, user_id: 'q'.repeat(26) },
      { ...input, email: 'other@example.test' }, { ...input, username: 'other_admin' }]) expect((await request(current.app, body)).status).toBe(409);
    for (const body of [input, { ...input, user_id: 'q'.repeat(26), username: 'another_admin', email: 'another@example.test' },
      { ...input, subject: 'different-subject', username: 'another_admin', email: 'another@example.test' }]) {
      expect((await request(current.app, body, otherOperation)).status).toBe(409);
    }
    expect(current.store.read(state => ({ users: state.users, receipts: state.hiveAdminAccountReceipts }))).toEqual(before);
    const admin = current.services.users.findByUsername('admin'); if (!admin) throw Error('Missing fixture admin');
    expect((await request(current.app, { ...input, subject: 'unlinked-subject', user_id: 'r'.repeat(26), username: admin.username, email: 'unique@example.test' }, otherOperation)).status).toBe(409);
    expect((await request(current.app, { ...input, subject: 'unlinked-subject', user_id: 'r'.repeat(26), username: 'unique_admin', email: admin.email }, otherOperation)).status).toBe(409);
    expect((await request(current.app, { ...input, subject: 'unlinked-subject', user_id: admin.id, username: 'unique_admin', email: 'unique@example.test' }, otherOperation)).status).toBe(409);
    expect(current.store.read(state => state.users.find(user => user.id === admin.id))).toEqual(admin);
  });

  it('refuses malformed authority and account drift, and cannot reset/deactivate/re-enable existing users', async () => {
    const current = await server();
    for (const body of [{ ...input, version: 2 }, { ...input, issuer: 'https://different.example.test' },
      { ...input, issuer: 'http://identity.example.test' }, { ...input, subject: '*' }, { ...input, user_id: 'short' },
      { ...input, role: 'system_user' }, { ...input, password: 'NeverAcceptedPassword123!' }, { ...input, email: 'invalid' }]) {
      expect([400, 403, 409]).toContain((await request(current.app, body)).status);
    }
    expect((await request(current.app, input, 'invalid')).status).toBe(400);
    expect((await request(current.app)).status).toBe(200);
    await current.store.write(state => { const user = state.users.find(value => value.id === input.user_id); if (user) user.disabledAt = Date.now(); });
    const before = structuredClone(current.store.read(state => state.users));
    expect((await request(current.app)).status).toBe(409);
    expect((await current.app.request(endpoint + operation, { headers: { 'x-hive-admin-provisioning-secret': secret } }, authority)).status).toBe(409);
    expect(current.store.read(state => state.users)).toEqual(before);
  });

  it('serializes duplicate creates and rolls back every account/receipt change if membership cannot be created', async () => {
    const current = await server();
    const results = await Promise.all([request(current.app), request(current.app)]);
    expect(results.map(result => result.status)).toEqual([200, 200]);
    expect(await results[0]?.json()).toEqual(await results[1]?.json());
    expect(current.store.read(state => state.users.filter(user => user.id === input.user_id))).toHaveLength(1);
    const failed = await server();
    await failed.store.write(state => { state.teams = []; });
    const before = structuredClone(failed.store.read(state => ({ users: state.users, statuses: state.statuses, receipts: state.hiveAdminAccountReceipts, outbox: state.auditOutbox })));
    expect((await request(failed.app)).status).toBe(409);
    expect(failed.store.read(state => ({ users: state.users, statuses: state.statuses, receipts: state.hiveAdminAccountReceipts, outbox: state.auditOutbox }))).toEqual(before);
  });

  it('loads legacy stores without receipts, rejects corrupted/rebound authority, and enforces a separate secret', async () => {
    const current = await server();
    const legacy: Partial<StoreState> = structuredClone(current.store.read(state => state));
    delete legacy.hiveAdminAccountReceipts;
    const directory = await mkdtemp(join(tmpdir(), 'chat-hive-legacy-'));
    try {
      const file = join(directory, 'state.json'); await writeFile(file, JSON.stringify(legacy));
      const restored = new JsonStore(file); await restored.initialize();
      expect(restored.read(state => state.hiveAdminAccountReceipts)).toEqual([]); await restored.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
    expect((await request(current.app)).status).toBe(200);
    const receipts = structuredClone(current.store.read(state => state.hiveAdminAccountReceipts));
    expect(() => validatedHiveAdminAccountReceipts([...receipts, ...receipts])).toThrow();
    expect(() => validatedHiveAdminAccountReceipts(receipts.map(receipt => ({ ...receipt, subject: 'rebound-subject' })))).toThrow();
    await expect(server({ COOKIE_SECRET: secret })).rejects.toThrow('separate purpose-specific secret');
  });

  it('acks only with a persisted native receipt and published audit, preserving exact ownership after audit failure', async () => {
    const current = await server();
    const flush = vi.spyOn(current.services.auditLog, 'publishPending').mockRejectedValueOnce(new Error('Synthetic audit flush unavailable'));
    expect((await request(current.app)).status).toBe(500);
    const committed = structuredClone(current.store.read(state => ({ users: state.users, receipts: state.hiveAdminAccountReceipts,
      posts: state.posts, sessions: state.sessions, bots: state.bots, teams: state.teams, memberships: state.channelMembers })));
    expect(committed.receipts).toHaveLength(1);
    flush.mockRestore();
    expect((await request(current.app)).status).toBe(200);
    expect(current.store.read(state => ({ users: state.users, receipts: state.hiveAdminAccountReceipts,
      posts: state.posts, sessions: state.sessions, bots: state.bots, teams: state.teams, memberships: state.channelMembers }))).toEqual(committed);
    expect(current.store.read(state => state.auditLogs.filter(event => event.action === 'user.hive_provisioned'))).toHaveLength(1);
    const directory = await mkdtemp(join(tmpdir(), 'chat-hive-durable-'));
    try {
      const file = join(directory, 'state.json');
      const persisted = new JsonStore(file); await persisted.initialize();
      await persisted.write(state => { Object.assign(state, structuredClone(current.store.read(value => value))); });
      const accounts = new HiveAdminAccounts(persisted, { OATHWEAVE_ISSUER: input.issuer, OATHWEAVE_CHAT_IDENTITIES_JSON: '[]' }, new AuditLogService(persisted));
      const secondInput = { ...input, subject: 'second-subject', user_id: 's'.repeat(26), username: 'second_admin', email: 'second@example.test' };
      const result = await accounts.provision(otherOperation, secondInput);
      const onDisk: unknown = JSON.parse(await readFile(file, 'utf8'));
      const disk = z.object({ hiveAdminAccountReceipts: z.array(z.object({ operationId: z.string(), userId: z.string() })),
        auditLogs: z.array(z.object({ action: z.string(), targetId: z.string().nullable() })) }).parse(onDisk);
      expect(disk.hiveAdminAccountReceipts.some(item => item.operationId === otherOperation && item.userId === secondInput.user_id)).toBe(true);
      expect(disk.auditLogs.some(item => item.action === 'user.hive_provisioned' && item.targetId === secondInput.user_id)).toBe(true);
      // Reopen read-only before closing/flushing the writer: the ACK already made both durable.
      const restored = new JsonStore(file, true); await restored.initialize();
      expect(new HiveAdminAccounts(restored, { OATHWEAVE_ISSUER: input.issuer, OATHWEAVE_CHAT_IDENTITIES_JSON: '[]' }, new AuditLogService(restored)).read(otherOperation)).toEqual(result);
      await restored.close(); await persisted.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('holds after an uncertain post-rename flush and never overwrites the retained account with stale state', async () => {
    const current = await server();
    const directory = await mkdtemp(join(tmpdir(), 'chat-hive-sync-'));
    const file = join(directory, 'state.json');
    const persisted = new JsonStore(file); await persisted.initialize();
    await persisted.write(state => { Object.assign(state, structuredClone(current.store.read(value => value))); });
    const open = (await vi.importActual<typeof fsPromises>('node:fs/promises')).open;
    const spy = vi.mocked(fsPromises.open).mockImplementation(async (path, flags, mode) => {
      const handle = await open(path, flags, mode);
      if (path === directory) vi.spyOn(handle, 'sync').mockRejectedValueOnce(new Error('Synthetic directory sync failure'));
      return handle;
    });
    try {
      const accounts = new HiveAdminAccounts(persisted, { OATHWEAVE_ISSUER: input.issuer, OATHWEAVE_CHAT_IDENTITIES_JSON: '[]' }, new AuditLogService(persisted));
      await expect(accounts.provision(operation, input)).rejects.toThrow('Synthetic directory sync failure');
      spy.mockImplementation(open);
      const retained = await readFile(file, 'utf8');
      await expect(persisted.write(state => { state.users = []; })).rejects.toThrow('persistence is uncertain');
      expect(() => accounts.read(operation)).toThrow('persistence is uncertain');
      await persisted.close(); expect(await readFile(file, 'utf8')).toBe(retained);
      const restored = new JsonStore(file, true); await restored.initialize();
      expect(new HiveAdminAccounts(restored, { OATHWEAVE_ISSUER: input.issuer, OATHWEAVE_CHAT_IDENTITIES_JSON: '[]' }, new AuditLogService(restored)).read(operation)).toMatchObject({ user_id: input.user_id });
      await restored.close();
    } finally { spy.mockImplementation(open); await rm(directory, { recursive: true, force: true }); }
  });

  it('retains receipt authority across a persisted-state restore and refuses silently adopting pre-linked people', async () => {
    const current = await server(); expect((await request(current.app)).status).toBe(200);
    const directory = await mkdtemp(join(tmpdir(), 'chat-hive-admin-'));
    try {
      const saved = new JsonStore(join(directory, 'state.json')); await saved.initialize();
      await saved.write(state => { Object.assign(state, structuredClone(current.store.read(value => value))); }); await saved.close();
      const restored = new JsonStore(join(directory, 'state.json')); await restored.initialize();
      const accounts = new HiveAdminAccounts(restored, { OATHWEAVE_ISSUER: input.issuer, OATHWEAVE_CHAT_IDENTITIES_JSON: '[]' }, current.services.auditLog);
      expect(accounts.read(operation)).toMatchObject({ user_id: input.user_id, status: 'committed' });
      await restored.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
    const linked = await server({ OATHWEAVE_CHAT_IDENTITIES_JSON: JSON.stringify([{ issuer: input.issuer, subject: input.subject, localUserId: 'z'.repeat(26) }]) });
    expect((await request(linked.app)).status).toBe(409);
    expect(linked.store.read(state => state.hiveAdminAccountReceipts)).toEqual([]);
  });
});
