import { runOathweaveConformance, loadOathweaveVectors } from '@hivemagnus/hive-common/oathweave/conformance';
import { describe, expect, it } from 'vitest';

import { createChatVerifier } from '../../src/server/oathweave.js';
import { createTestServer } from './helpers.js';

describe('Oathweave conformance', () => {
  const verifierFor = (context: Parameters<Parameters<typeof runOathweaveConformance>[0]>[1]) =>
    createChatVerifier({
      issuer: context.issuer,
      audience: context.audience,
      jwksUrl: context.jwksUrl,
      userinfoUrl: context.userinfoUrl,
      fetch: context.fetch,
      now: () => context.nowMs
    });

  it('meets the shared vectors for user principals', async () => {
    const vectors = await loadOathweaveVectors();
    const userVectors = vectors.vectors.filter((vector) => vector.principal === 'user').map((vector) => vector.name);
    const report = await runOathweaveConformance((token, context) => verifierFor(context)(token), {
      only: userVectors,
      strictReasons: true
    });
    expect(report.failed).toBe(0);
    expect(report.passed).toBe(userVectors.length);
  });

  it('refuses service principals, since chat sessions belong to people', async () => {
    const report = await runOathweaveConformance((token, context) => verifierFor(context)(token), {
      only: ['valid-service'],
      throwOnFailure: false
    });
    expect(report.results).toEqual([expect.objectContaining({ name: 'valid-service', actual: 'reject' })]);
  });
});

describe('Suite health and request context', () => {
  it('serves /health/live and /health/ready beside the unchanged Mattermost ping', async () => {
    const server = await createTestServer();
    const live = await server.app.request('/health/live');
    expect(live.status).toBe(200);
    expect(await live.json()).toMatchObject({ status: 'live', service: 'chattermost' });
    const ready = await server.app.request('/health/ready');
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({ status: 'ready', service: 'chattermost', checks: {} });
    const ping = await server.app.request('/api/v4/system/ping');
    expect(ping.status).toBe(200);
    expect(Object.keys((await ping.json()) as Record<string, unknown>)).toEqual([
      'status',
      'version',
      'build_number',
      'build_hash',
      'build_hash_enterprise',
      'build_date',
      'release_id',
      'database_status',
      'filestore_status',
      'websocket_status',
      'compatibility_profile'
    ]);
    await server.abuseControl.close();
    await server.store.close();
  });

  it('ignores inbound request IDs and keeps the Mattermost error shape', async () => {
    const server = await createTestServer();
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
    const response = await server.app.request('/api/v4/users/me', {
      headers: {
        'x-request-id': 'caller-chosen-id',
        'x-hive-request-id': 'caller-chosen-hive-id',
        'x-correlation-id': 'caller-chosen-correlation-id',
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'
      }
    });
    expect(response.status).toBe(401);
    const requestId = response.headers.get('x-request-id');
    expect(requestId).toMatch(uuid);
    expect(requestId).not.toContain('caller-chosen');
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['detailed_error', 'id', 'message', 'request_id', 'status_code']);
    expect(body.request_id).toBe(requestId);

    const first = await server.app.request('/api/v4/system/ping', { headers: { 'x-request-id': 'caller-chosen-id' } });
    const second = await server.app.request('/api/v4/system/ping', { headers: { 'x-request-id': 'caller-chosen-id' } });
    expect(first.headers.get('x-request-id')).toMatch(uuid);
    expect(second.headers.get('x-request-id')).toMatch(uuid);
    expect(first.headers.get('x-request-id')).not.toBe(second.headers.get('x-request-id'));
    await server.abuseControl.close();
    await server.store.close();
  });
});
