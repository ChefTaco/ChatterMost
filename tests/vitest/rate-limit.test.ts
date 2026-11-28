import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRedisRateLimitStore, WEBSOCKET_UPGRADE_SOURCE_LIMIT, type RedisEval } from '../../src/server/rate-limit.js';
import { createTestServer } from './helpers.js';

afterEach(() => { vi.useRealTimers(); });

describe('abuse control on HiveCommon rate limiting', () => {
  it('budgets WebSocket handshakes per address and counts checks, throttles and evictions', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const server = await createTestServer({ RATE_LIMIT_MAX_KEYS: '100' });
    const abuse = server.abuseControl;
    const before = await abuse.telemetry();
    for (let index = 0; index < WEBSOCKET_UPGRADE_SOURCE_LIMIT; index += 1) {
      expect(await abuse.allow('source', 'UPGRADE:/api/v4/websocket:198.51.100.7', WEBSOCKET_UPGRADE_SOURCE_LIMIT)).toBe(true);
    }
    expect(await abuse.allow('source', 'UPGRADE:/api/v4/websocket:198.51.100.7', WEBSOCKET_UPGRADE_SOURCE_LIMIT)).toBe(false);
    expect(await abuse.allow('source', 'UPGRADE:/api/v4/websocket:198.51.100.8', WEBSOCKET_UPGRADE_SOURCE_LIMIT)).toBe(true);
    // Past capacity, each new key displaces the least recently used one.
    for (let index = 0; index < 100; index += 1) {
      await abuse.allow('source', `UPGRADE:/api/v4/websocket:203.0.113.${index}`, WEBSOCKET_UPGRADE_SOURCE_LIMIT);
    }
    const after = await abuse.telemetry();
    expect(after.source_checks - before.source_checks).toBe(WEBSOCKET_UPGRADE_SOURCE_LIMIT + 2 + 100);
    expect(after.source_throttles - before.source_throttles).toBe(1);
    expect(after.local_evictions - before.local_evictions).toBe(2);
    // A held key whose bucket has refilled displaces nothing, even at capacity.
    vi.setSystemTime(Date.now() + 120_000);
    await abuse.allow('source', 'UPGRADE:/api/v4/websocket:203.0.113.99', WEBSOCKET_UPGRADE_SOURCE_LIMIT);
    expect((await abuse.telemetry()).local_evictions - before.local_evictions).toBe(2);
    await server.store.close(); await abuse.close();
  });

  it('spends per-account budgets and refuses with the HiveCommon rate_limited error', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const server = await createTestServer();
    await server.abuseControl.enforce('account', 'upload\u0000user-a', 2);
    await server.abuseControl.enforce('account', 'upload\u0000user-a', 2);
    await expect(server.abuseControl.enforce('account', 'upload\u0000user-a', 2)).rejects.toMatchObject({
      code: 'rate_limited',
      status: 429,
      headers: { 'retry-after': '30' }
    });
    await server.abuseControl.enforce('account', 'upload\u0000user-b', 2);
    await server.store.close(); await server.abuseControl.close();
  });
});

describe('Redis rate-limit store', () => {
  it('counts a fixed window under a digest key and reports the wait from its TTL', async () => {
    const calls: { keys: string[]; arguments: string[] }[] = [];
    let count = 0;
    const client = {
      eval: vi.fn((_script: string, options: { keys: string[]; arguments: string[] }) => {
        calls.push(options);
        count += 1;
        return Promise.resolve([count, 42_500]);
      })
    } as unknown as RedisEval;
    const store = createRedisRateLimitStore({ client, kind: 'source', limit: 2 });
    expect(await store.consume('POST:/api/v4/users/login:198.51.100.7')).toMatchObject({ allowed: true, remaining: 1, retryAfterMs: 0 });
    expect(await store.consume('POST:/api/v4/users/login:198.51.100.7')).toMatchObject({ allowed: true, remaining: 0 });
    expect(await store.consume('POST:/api/v4/users/login:198.51.100.7')).toMatchObject({ allowed: false, remaining: 0, retryAfterMs: 42_500 });
    const digest = createHash('sha256').update('POST:/api/v4/users/login:198.51.100.7').digest('hex');
    expect(calls[0]).toEqual({ keys: [`chattermost:rate-limit:source:${digest}`], arguments: ['60000'] });
  });

  it('throws on an unexpected reply so the caller falls back to the local limiter', async () => {
    const client = { eval: vi.fn(() => Promise.resolve('OK')) } as unknown as RedisEval;
    await expect(createRedisRateLimitStore({ client, kind: 'account', limit: 5 }).consume('key')).rejects.toThrow(/rate-limit script/u);
  });
});
