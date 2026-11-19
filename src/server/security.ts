import { createHash, randomBytes } from 'node:crypto';
import { timingSafeEqualString } from '@hivemagnus/hive-common/secrets';

import bcrypt from 'bcryptjs';

import { HttpAppError } from '../shared/mattermost.js';
import type { AppEnv } from './env.js';

const BCRYPT_COST = 12;

/**
 * Password hashing is deliberately slow and runs on the server's one thread. Without a bound, a
 * burst of sign-in attempts would queue seconds of hashing in front of every other request.
 * A few run at a time, a short line may wait, and anything beyond that is refused at once.
 */
export class PasswordWorkGate {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  public constructor(
    private readonly maximumActive = 2,
    private readonly maximumWaiting = 24
  ) {}

  public async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.maximumActive) {
      if (this.waiting.length >= this.maximumWaiting) {
        throw new HttpAppError('api.context.rate_limit.app_error', 'Too many requests', 429);
      }
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active += 1;
    }
    try {
      return await work();
    } finally {
      // Hand the slot straight to the next waiter, so the active count never overshoots.
      const next = this.waiting.shift();
      if (next === undefined) this.active -= 1;
      else next();
    }
  }
}

const passwordWork = new PasswordWorkGate();

export async function hashPassword(password: string): Promise<string> {
  return passwordWork.run(() => bcrypt.hash(password, BCRYPT_COST));
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return passwordWork.run(() => bcrypt.compare(password, hash));
}

export function createSecretToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string, env: Pick<AppEnv, 'TOKEN_HASH_SECRET'>): string {
  return hashWithSecret(token, env.TOKEN_HASH_SECRET);
}

export function hashSessionToken(token: string, env: Pick<AppEnv, 'COOKIE_SECRET'>): string {
  return hashWithSecret(token, env.COOKIE_SECRET);
}

/** Constant-time string equality (the suite's shared helper); different byte lengths are unequal. */
export function safeEqualText(left: string, right: string): boolean {
  return timingSafeEqualString(left, right);
}

export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/u).at(-1) ?? 'upload.bin';
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/gu, '_');
  return cleaned.length > 0 ? cleaned : 'upload.bin';
}

// CSWSH (Cross-Site WebSocket Hijacking) guard for cookie-authenticated
// upgrades. Browsers always attach an Origin header on WebSocket handshakes and
// automatically send cookies, so a cross-origin Origin that does not match the
// server URL must be rejected. Non-browser clients without an Origin must use
// bearer authentication instead of an ambient session cookie.
export function isSameWebSocketOrigin(origin: string | undefined, serverUrl: string): boolean {
  if (origin === undefined || origin.length === 0) {
    return false;
  }
  try {
    return new URL(origin).origin === new URL(serverUrl).origin;
  } catch {
    return false;
  }
}

function hashWithSecret(token: string, secret: string): string {
  return createHash('sha256').update(secret).update(':').update(token).digest('hex');
}
