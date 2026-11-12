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

  it('echoes a safe inbound request ID and keeps the Mattermost error shape', async () => {
    const server = await createTestServer();
    const response = await server.app.request('/api/v4/users/me', {
      headers: { 'x-request-id': 'probe-1234', traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01' }
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('x-request-id')).toBe('probe-1234');
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['detailed_error', 'id', 'message', 'request_id', 'status_code']);
    expect(body.request_id).toBe('probe-1234');

    const unsafe = await server.app.request('/api/v4/system/ping', { headers: { 'x-request-id': 'bad id with spaces' } });
    expect(unsafe.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/u);
    const generated = await server.app.request('/api/v4/system/ping');
    expect(generated.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/u);
    await server.abuseControl.close();
    await server.store.close();
  });
});
