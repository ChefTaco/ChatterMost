import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createTestServer } from './helpers.js';

describe('Security Fusion audit export', () => {
  it('requires the dedicated hashed service credential and excludes arbitrary metadata', async () => {
    const token = 'security-fusion-test-credential';
    const server = await createTestServer({
      SECURITY_FUSION_SERVICE_TOKEN_HASH: createHash('sha256').update(token).digest('hex'),
    });
    await server.services.auditLog.record({
      actorUserId: 'user-1',
      action: 'login.failed',
      targetId: 'session-1',
      metadata: { outcome: 'failure', password: 'never-export', token: 'never-export' },
    });

    const denied = await server.app.request('/api/v4/security/events');
    expect(denied.status).toBe(401);

    const response = await server.app.request('/api/v4/security/events?limit=10', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { events: { metadata: Record<string, unknown> }[] };
    expect(body.events.at(-1)?.metadata).toEqual({ outcome: 'failure' });
  });

  it('paginates with an opaque cursor', async () => {
    const token = 'security-fusion-test-credential';
    const server = await createTestServer({
      SECURITY_FUSION_SERVICE_TOKEN_HASH: createHash('sha256').update(token).digest('hex'),
    });
    await server.services.auditLog.record({ action: 'login.failed' });
    await server.services.auditLog.record({ action: 'authorization.denied' });
    const headers = { authorization: `Bearer ${token}` };
    const first = await server.app.request('/api/v4/security/events?limit=1', { headers });
    const firstBody = await first.json() as { nextCursor: string; events: { id: string; sequence: number }[] };
    const second = await server.app.request(`/api/v4/security/events?limit=1&cursor=${firstBody.nextCursor}`, { headers });
    const secondBody = await second.json() as { nextCursor: string; events: { id: string; sequence: number }[] };
    expect(secondBody.events[0]?.id).not.toBe(firstBody.events[0]?.id);
    expect(secondBody.events[0]?.sequence).toBeGreaterThan(firstBody.events[0]?.sequence ?? 0);
    expect(Number(secondBody.nextCursor)).toBe(secondBody.events[0]?.sequence);
  });

  it('returns a typed retention-gap response instead of replaying for an expired cursor', async () => {
    // This retention boundary performs 2,001 durable writes on hosted runners.
    const token = 'security-fusion-test-credential';
    const server = await createTestServer({
      SECURITY_FUSION_SERVICE_TOKEN_HASH: createHash('sha256').update(token).digest('hex'),
    });
    const expired = await server.services.auditLog.record({ action: 'login.failed' });
    for (let index = 0; index < 2000; index += 1) {
      await server.services.auditLog.record({ action: 'authorization.denied' });
    }
    const response = await server.app.request(`/api/v4/security/events?cursor=${expired.id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(410);
    const body = await response.json() as {
      id: string;
      code: string;
      status_code: number;
      earliest_available_cursor: string;
      earliest_available_sequence: number;
    };
    expect(body).toMatchObject({
      id: 'api.security_fusion.cursor_expired',
      code: 'CURSOR_EXPIRED',
      status_code: 410,
    });
    expect(body.earliest_available_sequence).toBeGreaterThan(expired.exportSequence);
    expect(Number(body.earliest_available_cursor)).toBe(body.earliest_available_sequence - 1);
  }, 20_000);
});
