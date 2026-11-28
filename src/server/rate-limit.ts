import { createHash } from 'node:crypto';

import { rateLimit as hiveRateLimit } from '@hivemagnus/hive-common/hono';
import {
  createRateLimiter,
  enforceRateLimit,
  trustedProxies,
  type ClientAddress,
  type ClientAddressDecision,
  type RateLimiter,
  type RateLimitResult,
  type RateLimitStore,
  type TrustedProxies
} from '@hivemagnus/hive-common/rate-limit';
import type { Context, MiddlewareHandler } from 'hono';
import { routePath } from 'hono/route';
import { createClient } from 'redis';

import type { AppHonoEnv } from './app.js';
import type { AppEnv } from './env.js';

type CounterKind = 'account' | 'source';
type ProxyDecision = 'direct_untrusted' | 'trusted_forwarded' | 'trusted_without_forwarding' | 'trusted_invalid_forwarding';
type RedisClient = ReturnType<typeof createClient>;
/** The part of a Redis client the shared counter needs. */
export type RedisEval = Pick<RedisClient, 'eval'>;

export type AbuseControlTelemetry = {
  backend: 'local' | 'redis';
  cross_instance_consistent: boolean;
  source_checks: number;
  account_checks: number;
  source_throttles: number;
  account_throttles: number;
  local_evictions: number;
  trusted_proxy_decisions: Record<ProxyDecision, number>;
  redis_errors: number;
};

const WINDOW_MS = 60_000;
const GENERAL_SOURCE_LIMIT = 240;
// Routes that spend password-hashing work or test a secret share the stricter login budget.
const CREDENTIAL_ROUTES = new Set([
  'POST /api/v4/users/login',
  'POST /api/v4/users',
  'PUT /api/v4/users/:user_id/password',
  'POST /admin/users/:id/reset-password'
]);
/** New WebSocket handshakes one address may start per minute. */
export const WEBSOCKET_UPGRADE_SOURCE_LIMIT = 120;
const REDIS_INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`;
// HiveCommon reports how it attributed a request; the telemetry keeps ChatterMost's names.
const PROXY_DECISIONS: Record<ClientAddressDecision, ProxyDecision> = {
  direct: 'direct_untrusted',
  unknown_peer: 'direct_untrusted',
  forwarded: 'trusted_forwarded',
  proxy_without_forwarding: 'trusted_without_forwarding',
  invalid_forwarding: 'trusted_invalid_forwarding'
};

/**
 * `TRUSTED_PROXIES` as HiveCommon's trusted-proxy set: addresses, CIDR ranges and the presets
 * `loopback`, `private` and `linklocal`. Empty trusts no proxy. A bad entry fails startup.
 */
export function parseTrustedProxies(configuration: string): TrustedProxies {
  try {
    return trustedProxies(configuration);
  } catch (error) {
    throw new Error(`Invalid TRUSTED_PROXIES entry: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

/**
 * A fixed-window counter shared through Redis, as a HiveCommon `RateLimitStore`: `limit` events
 * per key per window, counted by one atomic script. Keys hold a digest, never the raw key.
 * Throws when Redis does; the caller decides the fallback.
 */
export function createRedisRateLimitStore(options: { client: RedisEval; kind: CounterKind; limit: number; windowMs?: number }): RateLimitStore {
  const windowMs = options.windowMs ?? WINDOW_MS;
  return {
    async consume(key: string): Promise<RateLimitResult> {
      const digest = createHash('sha256').update(key).digest('hex');
      const reply = await options.client.eval(REDIS_INCREMENT_SCRIPT, { keys: [`chattermost:rate-limit:${options.kind}:${digest}`], arguments: [String(windowMs)] });
      if (!Array.isArray(reply)) throw new Error('Unexpected rate-limit script reply');
      const count = Number(reply[0]);
      const ttl = Math.max(1, Number(reply[1]));
      const allowed = count <= options.limit;
      return { allowed, limit: options.limit, remaining: Math.max(0, options.limit - count), retryAfterMs: allowed ? 0 : ttl, resetMs: ttl };
    }
  };
}

export class AbuseControl {
  private readonly localTelemetry: AbuseControlTelemetry = emptyTelemetry('local');
  private readonly localLimiters = new Map<string, RateLimiter>();
  private readonly stores = new Map<string, RateLimitStore>();
  private redis: RedisClient | null = null;

  public constructor(private readonly env: AppEnv) {}

  public async initialize(): Promise<void> {
    if (!this.env.ENABLE_DISTRIBUTED_RATE_LIMIT) return;
    const client = createClient({ url: this.env.REDIS_URL });
    client.on('error', () => { this.localTelemetry.redis_errors += 1; });
    try {
      await client.connect();
      this.redis = client;
      this.localTelemetry.backend = 'redis';
      this.localTelemetry.cross_instance_consistent = true;
    } catch {
      this.localTelemetry.redis_errors += 1;
      if (client.isOpen) await client.disconnect();
    }
  }

  /**
   * The budget of `limit` events per minute for one kind of counter: Redis when it is connected,
   * otherwise (or when a Redis call fails) this process's HiveCommon token bucket.
   */
  public store(kind: CounterKind, limit: number): RateLimitStore {
    const name = `${kind}:${limit}`;
    let store = this.stores.get(name);
    if (store === undefined) {
      store = { consume: async (key: string) => this.consume(kind, key, limit) };
      this.stores.set(name, store);
    }
    return store;
  }

  /** Spends one event and throws HiveCommon's 429 `rate_limited` error once the budget is spent. */
  public async enforce(kind: CounterKind, key: string, limit: number): Promise<void> {
    await enforceRateLimit(this.store(kind, limit), key);
  }

  /** Counts one event against a budget without an HTTP context; false once it is spent. */
  public async allow(kind: CounterKind, key: string, limit: number): Promise<boolean> {
    return (await this.consume(kind, key, limit)).allowed;
  }

  public recordProxyDecision(decision: ClientAddressDecision): void {
    const name = PROXY_DECISIONS[decision];
    this.localTelemetry.trusted_proxy_decisions[name] += 1;
    if (this.redis !== null) void this.redis.hIncrBy('chattermost:abuse:telemetry', `proxy:${name}`, 1).catch(() => { this.localTelemetry.redis_errors += 1; });
  }

  public async telemetry(): Promise<AbuseControlTelemetry> {
    if (this.redis === null) return structuredClone(this.localTelemetry);
    try {
      const values = await this.redis.hGetAll('chattermost:abuse:telemetry');
      return {
        ...this.localTelemetry,
        source_checks: Number(values.source_checks ?? 0),
        account_checks: Number(values.account_checks ?? 0),
        source_throttles: Number(values.source_throttles ?? 0),
        account_throttles: Number(values.account_throttles ?? 0),
        local_evictions: this.localTelemetry.local_evictions,
        trusted_proxy_decisions: {
          direct_untrusted: Number(values['proxy:direct_untrusted'] ?? 0),
          trusted_forwarded: Number(values['proxy:trusted_forwarded'] ?? 0),
          trusted_without_forwarding: Number(values['proxy:trusted_without_forwarding'] ?? 0),
          trusted_invalid_forwarding: Number(values['proxy:trusted_invalid_forwarding'] ?? 0)
        }
      };
    } catch {
      this.localTelemetry.redis_errors += 1;
      return structuredClone(this.localTelemetry);
    }
  }

  public async close(): Promise<void> {
    if (this.redis !== null && this.redis.isOpen) await this.redis.quit();
  }

  private async consume(kind: CounterKind, key: string, limit: number): Promise<RateLimitResult> {
    this.incrementTelemetry(`${kind}_checks`);
    const result = await this.spend(kind, key, limit);
    if (!result.allowed) this.incrementTelemetry(`${kind}_throttles`);
    return result;
  }

  private async spend(kind: CounterKind, key: string, limit: number): Promise<RateLimitResult> {
    if (this.redis !== null) {
      try {
        return await createRedisRateLimitStore({ client: this.redis, kind, limit }).consume(key);
      } catch {
        this.localTelemetry.redis_errors += 1;
        this.localTelemetry.cross_instance_consistent = false;
      }
    }
    const limiter = this.localLimiter(kind, limit);
    // At capacity, a key the limiter does not hold displaces the least recently used one.
    const displaces = limiter.size >= this.env.RATE_LIMIT_MAX_KEYS && limiter.peek(key).resetMs === 0;
    const result = limiter.consume(key);
    if (displaces && result.allowed) this.incrementTelemetry('local_evictions');
    return result;
  }

  private localLimiter(kind: CounterKind, limit: number): RateLimiter {
    const name = `${kind}:${limit}`;
    let limiter = this.localLimiters.get(name);
    if (limiter === undefined) {
      limiter = createRateLimiter({ limit, windowMs: WINDOW_MS, maxKeys: this.env.RATE_LIMIT_MAX_KEYS });
      this.localLimiters.set(name, limiter);
    }
    return limiter;
  }

  private incrementTelemetry(name: 'account_checks' | 'account_throttles' | 'local_evictions' | 'source_checks' | 'source_throttles'): void {
    this.localTelemetry[name] += 1;
    if (this.redis !== null && name !== 'local_evictions') void this.redis.hIncrBy('chattermost:abuse:telemetry', name, 1).catch(() => { this.localTelemetry.redis_errors += 1; });
  }
}

/**
 * The per-request budgets: one per method, route and client address (the stricter sign-in budget
 * on credential routes, 240 a minute elsewhere), then the per-account helpers routes call.
 * A refusal throws HiveCommon's `rate_limited` error, which the app answers in Mattermost's shape.
 */
export function rateLimit(env: AppEnv, abuseControl: AbuseControl): MiddlewareHandler<AppHonoEnv>[] {
  const proxies = parseTrustedProxies(env.TRUSTED_PROXIES);
  const scopeOf = (c: Context): string => routePath(c, -1) || '*';
  const sourceKey = (credential: boolean) => (c: Context, client: ClientAddress): string | undefined => {
    const scope = scopeOf(c);
    if (CREDENTIAL_ROUTES.has(`${c.req.method} ${scope}`) !== credential) return undefined;
    abuseControl.recordProxyDecision(client.decision);
    return `${c.req.method}:${scope}:${client.address}`;
  };
  return [
    hiveRateLimit({ limiter: abuseControl.store('source', env.RATE_LIMIT_LOGIN_SOURCE_MAX), trustedProxies: proxies, key: sourceKey(true) }),
    hiveRateLimit({ limiter: abuseControl.store('source', GENERAL_SOURCE_LIMIT), trustedProxies: proxies, key: sourceKey(false) }),
    async (c, next) => {
      c.set('rateLimitAccount', async (account) => abuseControl.enforce('account', normalizeAccount(account), env.RATE_LIMIT_LOGIN_ACCOUNT_MAX));
      c.set('rateLimitActor', async (action, actorId, limit) => abuseControl.enforce('account', `${action}\u0000${actorId}`, limit));
      await next();
    }
  ];
}

function emptyTelemetry(backend: 'local' | 'redis'): AbuseControlTelemetry {
  return { backend, cross_instance_consistent: backend === 'redis', source_checks: 0, account_checks: 0, source_throttles: 0, account_throttles: 0, local_evictions: 0, trusted_proxy_decisions: { direct_untrusted: 0, trusted_forwarded: 0, trusted_without_forwarding: 0, trusted_invalid_forwarding: 0 }, redis_errors: 0 };
}
function normalizeAccount(value: string): string { return value.trim().toLowerCase().slice(0, 320); }
