import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { chatAdminCapabilitiesSchema, chatAdminUserSchema, chatAgentSchema, chatBotSchema, chatConfigurationSchema, chatCustomEmojiSchema, chatHermesHealthSchema, chatInviteCreatedSchema, chatInviteSchema, chatSimulationSchema, chatSupervisionPolicySchema, chatSupervisionEventSchema, chatCleanupSchema } from '../../src/shared/browser-admin.js';
import { bearer, createTestServer, login } from './helpers.js';

describe('owned browser administration contracts', () => {
  it('validates actual product responses without persistence secrets', async () => {
    const server = await createTestServer(), token = await login(server);
    try {
      const reads: [string, z.ZodType][] = [
        ['/admin/browser-capabilities', chatAdminCapabilitiesSchema], ['/admin/users', z.array(chatAdminUserSchema)],
        ['/admin/bots', z.array(chatBotSchema)], ['/admin/hermes/health', chatHermesHealthSchema],
        ['/api/v4/config', chatConfigurationSchema], ['/api/v4/emoji', z.array(chatCustomEmojiSchema)],
        ['/admin/supervision/policy', chatSupervisionPolicySchema], ['/admin/supervision/events', z.array(chatSupervisionEventSchema)],
        ['/api/v4/agents', z.array(chatAgentSchema)], ['/admin/invites', z.array(chatInviteSchema)]
      ];
      for (const [path, schema] of reads) {
        const response = await server.app.request(path, { headers: bearer(token) }); expect(response.status, path).toBe(200);
        expect(schema.safeParse(await response.json()).success, path).toBe(true);
      }
      const mutations: [string, object, z.ZodType][] = [
        ['/admin/invites', { max_uses: 1, expires_in_hours: 2, role: 'system_user' }, chatInviteCreatedSchema],
        ['/api/v4/agents', { name: 'Synthetic Agent', username: 'syntheticagent', permissions: { post: true }, verified: false }, chatAgentSchema],
        ['/api/v4/admin/policy-simulator', { agent_id: 'synthetic' }, chatSimulationSchema],
        ['/admin/test-artifacts/cleanup', { dry_run: true }, chatCleanupSchema]
      ];
      for (const [path, body, schema] of mutations) {
        const response = await server.app.request(path, { method: 'POST', headers: bearer(token), body: JSON.stringify(body) }); expect(response.ok, path).toBe(true);
        expect(schema.safeParse(await response.json()).success, path).toBe(true);
      }
      const people = await (await server.app.request('/admin/users', { headers: bearer(token) })).json() as object[];
      const stripped = chatAdminUserSchema.parse({ ...people[0], passwordHash: 'obviously-fake-hash' });
      expect(stripped).not.toHaveProperty('passwordHash');
    } finally { await server.store.close(); }
  });
});
