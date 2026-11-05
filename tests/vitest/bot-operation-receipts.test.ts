import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStore } from '../../src/server/store.js';
import { assertNewBotOperation, botOperationDigest } from '../../src/server/bot-operations.js';
import { describe, expect, it } from 'vitest';
import { bearer, createTestServer, login } from './helpers.js';
import { chatBotOperationSchema } from '../../src/shared/browser-admin.js';

describe('caller-bound bot credential operations', () => {
  it('reconciles a committed provisioning request and never rotates on duplicate, drift or after outbox compaction', async () => {
    const server = await createTestServer(), token = await login(server), operation = 'a'.repeat(26);
    const input = { username: 'receiptbot', display_name: 'Receipt Bot', operation_id: operation };
    const first = await server.app.request('/admin/bots', { method: 'POST', headers: bearer(token), body: JSON.stringify(input) });
    expect(first.status).toBe(201);
    const result = await first.json() as { token: string; bot: { user_id: string } };
    const hash = server.store.read(state => state.bots.find(bot => bot.userId === result.bot.user_id)?.tokenHash);
    for (const body of [input, { ...input, display_name: 'Changed' }]) {
      expect((await server.app.request('/admin/bots', { method: 'POST', headers: bearer(token), body: JSON.stringify(body) })).status).toBe(409);
    }
    expect((await server.app.request('/admin/bots', { method: 'POST', headers: bearer(token), body: JSON.stringify({ ...input, operation_id: 'c'.repeat(26), create_only: true }) })).status).toBe(409);
    await server.store.write(state => { state.auditOutbox = []; });
    const receipt = await server.app.request('/admin/bot-operations/' + operation, { headers: bearer(token) });
    expect(receipt.status).toBe(200); expect(chatBotOperationSchema.parse(await receipt.json()).target_id).toBe(result.bot.user_id);
    expect((await server.app.request('/admin/bots', { method: 'POST', headers: bearer(token), body: JSON.stringify(input) })).status).toBe(409);
    expect(server.store.read(state => state.bots.find(bot => bot.userId === result.bot.user_id)?.tokenHash)).toBe(hash);
    expect(JSON.stringify(server.store.read(state => state.botOperationReceipts))).not.toContain(result.token);
    const directory = await mkdtemp(join(tmpdir(), 'chat-bot-receipts-')), file = join(directory, 'state.json');
    try {
      const persisted = new JsonStore(file); await persisted.initialize();
      await persisted.write(state => { Object.assign(state, structuredClone(server.store.read(value => value))); }); await persisted.close();
      const restored = new JsonStore(file); await restored.initialize();
      const snapshot = restored.read(state => state);
      expect(snapshot.botOperationReceipts).toHaveLength(1);
      const receiptOwner = snapshot.botOperationReceipts[0]?.actorUserId; if (!receiptOwner) throw Error('missing restored receipt owner');
      expect(() => assertNewBotOperation(snapshot, operation, receiptOwner, 'bot.provisioned', botOperationDigest('bot.provisioned', ['receiptbot', 'Receipt Bot', 'false']))).toThrow('already committed');
      expect(JSON.stringify(snapshot.botOperationReceipts)).not.toContain(result.token);
      await restored.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
    await server.store.close();
  });
  it('claims rotation atomically, rejects cross-action/owner reuse and preserves native empty-body clients', async () => {
    const server = await createTestServer(), token = await login(server);
    const provisioned = await server.app.request('/admin/bots', { method: 'POST', headers: bearer(token), body: JSON.stringify({ username: 'rotatebot', display_name: 'Rotate Bot' }) });
    const bot = await provisioned.json() as { bot: { user_id: string } }, operation = 'b'.repeat(26), path = '/admin/bots/' + bot.bot.user_id + '/regenerate-token';
    const headers = { Authorization: 'Bearer ' + token, 'X-Bot-Operation-ID': operation };
    const outcomes = await Promise.all([server.app.request(path, { method: 'POST', headers }), server.app.request(path, { method: 'POST', headers })]);
    expect(outcomes.map(response => response.status).sort()).toEqual([200, 409]);
    const hash = server.store.read(state => state.bots.find(value => value.userId === bot.bot.user_id)?.tokenHash);
    expect((await server.app.request('/admin/bots', { method: 'POST', headers: bearer(token), body: JSON.stringify({ username: 'rotatebot', display_name: 'Rotate Bot', operation_id: operation }) })).status).toBe(409);
    const other = await server.services.users.createUser({ username: 'otheradmin', email: 'other@example.test', password: 'ObviouslyFakePassword123!', role: 'system_admin system_user', actorUserId: null });
    await expect(server.services.bots.regenerateToken(other, bot.bot.user_id, operation)).rejects.toThrow('another administrator');
    expect(server.store.read(state => state.bots.find(value => value.userId === bot.bot.user_id)?.tokenHash)).toBe(hash);
    expect((await server.app.request(path, { method: 'POST', headers: bearer(token) })).status).toBe(200);
    expect((await server.app.request('/admin/browser-capabilities', { headers: bearer('invalid') })).status).toBe(401);
    const member = await server.services.users.createUser({ username: 'receiptmember', email: 'member@example.test', password: 'ObviouslyFakePassword123!', role: 'system_user', actorUserId: null });
    await expect(server.services.bots.regenerateToken(member, bot.bot.user_id, 'd'.repeat(26))).rejects.toThrow();
    await expect(Promise.resolve().then(() => server.services.bots.operation(other, operation))).rejects.toThrow('another administrator');
    await server.store.close();
  });
});
