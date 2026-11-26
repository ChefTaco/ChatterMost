import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { bearer, createTestServer, firstChannelId, login } from './helpers.js';

const METRICS_TOKEN = 'synthetic-metrics-scrape-token';

describe('Prometheus metrics', () => {
  it('serves text metrics to admins and to the metrics token only', async () => {
    const server = await createTestServer({ METRICS_TOKEN_SHA256: createHash('sha256').update(METRICS_TOKEN).digest('hex') });
    try {
      const token = await login(server);
      const channelId = await firstChannelId(server.app, token);
      await server.app.request('/api/v4/posts', { method: 'POST', headers: bearer(token), body: JSON.stringify({ channel_id: channelId, message: 'counted' }) });
      await server.services.users.createUser({ username: 'metricsmember', email: 'metricsmember@example.test', password: 'SyntheticPassword123!', role: 'system_user', actorUserId: null });
      const member = await server.app.request('/api/v4/users/login', { method: 'POST', headers: server.baseHeaders, body: JSON.stringify({ login_id: 'metricsmember', password: 'SyntheticPassword123!' }) });

      expect((await server.app.request('/api/v4/metrics/prometheus')).status).toBe(401);
      expect((await server.app.request('/api/v4/metrics/prometheus', { headers: { Authorization: 'Bearer wrong-token' } })).status).toBe(401);
      expect((await server.app.request('/api/v4/metrics/prometheus', { headers: bearer(member.headers.get('Token') ?? '') })).status).toBe(403);

      for (const headers of [bearer(token), { Authorization: `Bearer ${METRICS_TOKEN}` }]) {
        const response = await server.app.request('/api/v4/metrics/prometheus', { headers });
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/plain; version=0.0.4');
        const text = await response.text();
        expect(text).toContain('# TYPE chattermost_messages_posted_total counter');
        expect(text).toMatch(/^chattermost_messages_posted_total [1-9]\d*$/mu);
        expect(text).toMatch(/^chattermost_users\{state="active"\} [1-9]\d*$/mu);
        expect(text).toMatch(/^chattermost_channels\{type="O"\} \d+$/mu);
        expect(text).toMatch(/^chattermost_build_info\{version="[^"]+",compatibility_profile="[^"]+"\} 1$/mu);
        for (const line of text.trimEnd().split('\n')) expect(line, line).toMatch(/^(# (HELP|TYPE) [a-z_]+ .+|[a-z_]+(\{[a-z_]+="[^"]*"(,[a-z_]+="[^"]*")*\})? -?\d+(\.\d+)?)$/u);
        expect(text).not.toContain('metricsmember');
      }
    } finally {
      await server.store.close();
    }
  });
});

describe('health and readiness', () => {
  it('reports readiness from the store and keeps liveness independent of it', async () => {
    const server = await createTestServer();
    try {
      const ready = await server.app.request('/health/ready');
      expect(ready.status).toBe(200);
      expect(await ready.json()).toMatchObject({ status: 'ready', checks: { store: { status: 'up' } } });

      (server.store as unknown as { persistenceHeld: boolean }).persistenceHeld = true;
      const held = await server.app.request('/health/ready');
      expect(held.status).toBe(503);
      expect(await held.json()).toMatchObject({ status: 'not_ready', checks: { store: { status: 'down' } } });
      expect((await server.app.request('/health/live')).status).toBe(200);
      (server.store as unknown as { persistenceHeld: boolean }).persistenceHeld = false;
    } finally {
      await server.store.close();
    }
  });
});
