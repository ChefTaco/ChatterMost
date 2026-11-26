import { encodeExecutionHeader, rootExecution } from '@hivemagnus/hive-common/execution';
import { describe, expect, it } from 'vitest';

import { retryingReadFetch } from '../../src/server/oathweave.js';
import { createTestServer, firstChannelId, login } from './helpers.js';

describe('execution attribution on agent posts', () => {
  it('records a valid x-hive-execution context on bot posts only, and never a client-supplied one', async () => {
    const server = await createTestServer();
    try {
      const adminToken = await login(server);
      const channelId = await firstChannelId(server.app, adminToken);
      const hermes = server.services.users.findByUsername('hermes');
      if (hermes === null) throw new Error('missing hermes');
      await server.services.channels.addUserToChannel(channelId, hermes.id, '');
      const execution = rootExecution('hx1:ardent:lab.default:task:task-1', { requestId: 'req-1' });
      const header = encodeExecutionHeader(execution) ?? '';
      const post = async (token: string, headers: Record<string, string>, props: Record<string, unknown> = {}) => {
        const response = await server.app.request('/api/v4/posts', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({ channel_id: channelId, message: 'agent reply', props })
        });
        expect(response.status).toBe(201);
        return ((await response.json()) as { props: Record<string, unknown> }).props;
      };

      expect((await post('test-hermes-token', { 'x-hive-execution': header })).hive_execution).toMatchObject({ v: 1, root: 'hx1:ardent:lab.default:task:task-1', request_id: 'req-1' });
      expect(await post('test-hermes-token', { 'x-hive-execution': 'not-a-context' })).not.toHaveProperty('hive_execution');
      expect(await post(adminToken, { 'x-hive-execution': header })).not.toHaveProperty('hive_execution');
      expect(await post(adminToken, {}, { hive_execution: { v: 1, root: 'forged' } })).not.toHaveProperty('hive_execution');
    } finally {
      await server.store.close();
    }
  });
});

describe('Oathweave read retries', () => {
  const fast = { maxAttempts: 3, baseMs: 1, maxMs: 2 };

  it('retries transient statuses and network failures on GET, then returns the last response', async () => {
    const statuses = [503, 502, 200];
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response('{}', { status: statuses[calls - 1] ?? 200 });
    }) as typeof fetch;
    expect((await retryingReadFetch(fetchImpl, fast)('https://identity.example.test/userinfo')).status).toBe(200);
    expect(calls).toBe(3);

    calls = 0;
    const alwaysDown = (async () => {
      calls += 1;
      return new Response('{}', { status: 503 });
    }) as typeof fetch;
    expect((await retryingReadFetch(alwaysDown, fast)('https://identity.example.test/userinfo')).status).toBe(503);
    expect(calls).toBe(3);

    calls = 0;
    const flaky = (async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('fetch failed');
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    expect((await retryingReadFetch(flaky, fast)('https://identity.example.test/jwks')).status).toBe(200);
    expect(calls).toBe(2);
  });

  it('does not retry permanent statuses or non-GET requests', async () => {
    let calls = 0;
    const unauthorized = (async () => {
      calls += 1;
      return new Response('{}', { status: 401 });
    }) as typeof fetch;
    expect((await retryingReadFetch(unauthorized, fast)('https://identity.example.test/userinfo')).status).toBe(401);
    expect(calls).toBe(1);

    calls = 0;
    const down = (async () => {
      calls += 1;
      return new Response('{}', { status: 503 });
    }) as typeof fetch;
    expect((await retryingReadFetch(down, fast)('https://identity.example.test/token', { method: 'POST' })).status).toBe(503);
    expect(calls).toBe(1);
  });
});
