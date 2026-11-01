import { createHash } from 'node:crypto';
import { BlockList, isIP } from 'node:net';

import type { Context, MiddlewareHandler } from 'hono';
import { routePath } from 'hono/route';
import { createClient } from 'redis';

import { HttpAppError } from '../shared/mattermost.js';
import type { AppHonoEnv } from './app.js';
import type { AppEnv } from './env.js';

type Bucket = { count: number; resetAt: number; evicted: boolean };
type CounterKind = 'account' | 'source';
type ProxyDecision = 'direct_untrusted' | 'trusted_forwarded' | 'trusted_without_forwarding' | 'trusted_invalid_forwarding';
type RedisClient = ReturnType<typeof createClient>;

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
const MAX_FORWARDED_HOPS = 32;
const REDIS_INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`;

export class AbuseControl {
  private readonly localStore: BoundedRateLimitStore;
  private readonly localTelemetry: AbuseControlTelemetry = emptyTelemetry('local');
  private redis: RedisClient | null = null;

  public constructor(private readonly env: AppEnv) {
    this.localStore = new BoundedRateLimitStore(env.RATE_LIMIT_MAX_KEYS);
  }

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

  public async enforce(c: Context, kind: CounterKind, key: string, limit: number, now: number): Promise<void> {
    this.incrementTelemetry(`${kind}_checks`);
    const bucket = await this.increment(kind, key, now);
    if (bucket.evicted) this.incrementTelemetry('local_evictions');
    if (bucket.count <= limit) return;
    this.incrementTelemetry(`${kind}_throttles`);
    c.header('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
    throw new HttpAppError('api.context.rate_limit.app_error', 'Too many requests', 429);
  }

  public recordProxyDecision(decision: ProxyDecision): void {
    this.localTelemetry.trusted_proxy_decisions[decision] += 1;
    if (this.redis !== null) void this.redis.hIncrBy('chattermost:abuse:telemetry', `proxy:${decision}`, 1).catch(() => { this.localTelemetry.redis_errors += 1; });
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

  private async increment(kind: CounterKind, key: string, now: number): Promise<Bucket> {
    if (this.redis !== null) {
      try {
        const digest = createHash('sha256').update(key).digest('hex');
        const result = await this.redis.eval(REDIS_INCREMENT_SCRIPT, { keys: [`chattermost:rate-limit:${kind}:${digest}`], arguments: [String(WINDOW_MS)] });
        if (Array.isArray(result)) {
          const count = Number(result[0]);
          const ttl = Math.max(1, Number(result[1]));
          return { count, resetAt: now + ttl, evicted: false };
        }
      } catch {
        this.localTelemetry.redis_errors += 1;
        this.localTelemetry.cross_instance_consistent = false;
      }
    }
    return this.localStore.increment(kind, key, now);
  }

  private incrementTelemetry(name: 'account_checks' | 'account_throttles' | 'local_evictions' | 'source_checks' | 'source_throttles'): void {
    this.localTelemetry[name] += 1;
    if (this.redis !== null && name !== 'local_evictions') void this.redis.hIncrBy('chattermost:abuse:telemetry', name, 1).catch(() => { this.localTelemetry.redis_errors += 1; });
  }
}

export function rateLimit(env: AppEnv, abuseControl: AbuseControl): MiddlewareHandler<AppHonoEnv> {
  const trustedProxies = new TrustedProxySet(env.TRUSTED_PROXIES);
  return async (c, next) => {
    const now = Date.now();
    const scope = routePath(c, -1) || '*';
    const loginRequest = c.req.method === 'POST' && scope === '/api/v4/users/login';
    const identity = resolveClientIdentity(c, trustedProxies);
    abuseControl.recordProxyDecision(identity.decision);
    await abuseControl.enforce(c, 'source', `${c.req.method}:${scope}:${identity.address}`, loginRequest ? env.RATE_LIMIT_LOGIN_SOURCE_MAX : GENERAL_SOURCE_LIMIT, now);
    c.set('rateLimitAccount', async (account) => abuseControl.enforce(c, 'account', normalizeAccount(account), env.RATE_LIMIT_LOGIN_ACCOUNT_MAX, Date.now()));
    await next();
  };
}

export function resolveClientAddress(c: Context<AppHonoEnv>, trustedProxies: TrustedProxySet): string {
  return resolveClientIdentity(c, trustedProxies).address;
}

function resolveClientIdentity(c: Context<AppHonoEnv>, trustedProxies: TrustedProxySet): { address: string; decision: ProxyDecision } {
  const peerAddress = normalizeAddress(c.env?.incoming?.socket.remoteAddress) ?? 'local';
  if (!trustedProxies.has(peerAddress)) return { address: peerAddress, decision: 'direct_untrusted' };
  const forwardedHeader = c.req.header('x-forwarded-for');
  if (forwardedHeader === undefined) return { address: peerAddress, decision: 'trusted_without_forwarding' };
  const forwarded = forwardedHeader.split(',').map((value) => normalizeAddress(value.trim()));
  if (forwarded.length === 0 || forwarded.length > MAX_FORWARDED_HOPS || forwarded.some((value) => value === null)) return { address: peerAddress, decision: 'trusted_invalid_forwarding' };
  const chain = [...(forwarded as string[]), peerAddress];
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const hop = chain[index];
    if (hop !== undefined && !trustedProxies.has(hop)) return { address: hop, decision: 'trusted_forwarded' };
  }
  return { address: chain[0] ?? peerAddress, decision: 'trusted_forwarded' };
}

export class TrustedProxySet {
  private readonly blockList = new BlockList();
  public constructor(configuration: string) {
    for (const entry of configuration.split(',').map((value) => value.trim()).filter(Boolean)) {
      const [addressValue, prefixValue, ...extra] = entry.split('/');
      const address = normalizeAddress(addressValue ?? '');
      if (address === null || extra.length > 0) throw new Error(`Invalid TRUSTED_PROXIES entry: ${entry}`);
      const family = isIP(address);
      const maximumPrefix = family === 4 ? 32 : 128;
      const prefix = prefixValue === undefined ? maximumPrefix : Number(prefixValue);
      if (!Number.isInteger(prefix) || prefix < 0 || prefix > maximumPrefix) throw new Error(`Invalid TRUSTED_PROXIES prefix: ${entry}`);
      this.blockList.addSubnet(address, prefix, family === 4 ? 'ipv4' : 'ipv6');
    }
  }
  public has(address: string): boolean {
    const normalized = normalizeAddress(address);
    return normalized !== null && this.blockList.check(normalized, isIP(normalized) === 4 ? 'ipv4' : 'ipv6');
  }
}

export class BoundedRateLimitStore {
  private readonly buckets = new Map<string, Omit<Bucket, 'evicted'>>();
  public constructor(private readonly maximumKeys: number) {}
  public increment(kind: CounterKind, key: string, now: number): Bucket {
    const compoundKey = `${kind}:${key}`;
    const existing = this.buckets.get(compoundKey);
    if (existing !== undefined && existing.resetAt > now) {
      existing.count += 1; this.buckets.delete(compoundKey); this.buckets.set(compoundKey, existing);
      return { ...existing, evicted: false };
    }
    if (existing !== undefined) this.buckets.delete(compoundKey);
    let evicted = false;
    while (this.buckets.size >= this.maximumKeys) {
      const oldest = this.buckets.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.buckets.delete(oldest); evicted = true;
    }
    const created = { count: 1, resetAt: now + WINDOW_MS };
    this.buckets.set(compoundKey, created);
    return { ...created, evicted };
  }
}

function emptyTelemetry(backend: 'local' | 'redis'): AbuseControlTelemetry {
  return { backend, cross_instance_consistent: backend === 'redis', source_checks: 0, account_checks: 0, source_throttles: 0, account_throttles: 0, local_evictions: 0, trusted_proxy_decisions: { direct_untrusted: 0, trusted_forwarded: 0, trusted_without_forwarding: 0, trusted_invalid_forwarding: 0 }, redis_errors: 0 };
}
function normalizeAddress(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.length === 0) return null;
  const unwrapped = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  const normalized = unwrapped.toLowerCase().startsWith('::ffff:') && isIP(unwrapped.slice(7)) === 4 ? unwrapped.slice(7) : unwrapped;
  return isIP(normalized) === 0 ? null : normalized;
}
function normalizeAccount(value: string): string { return value.trim().toLowerCase().slice(0, 320); }
