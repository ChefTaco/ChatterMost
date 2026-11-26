import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { timingSafeEqualString } from '@hivemagnus/hive-common/secrets';

import bcrypt from 'bcryptjs';

import { HttpAppError } from '../shared/mattermost.js';
import type { AppEnv } from './env.js';

/**
 * New password hashes use scrypt by default (PASSWORD_HASHING=scrypt), which runs on libuv's
 * threadpool instead of the event loop, and bcrypt hashes are replaced at the next successful
 * sign-in. Hashes are self-describing (`$scrypt$ln=15,r=8,p=1$<salt>$<key>`, base64url) so the
 * parameters can be raised later. Both formats always verify, so no existing password stops
 * working. PASSWORD_HASHING=bcrypt keeps writing bcrypt and never rehashes. Releases before
 * 0.9.0 cannot verify scrypt hashes, which is why later releases only roll back to 0.9.x.
 */
const BCRYPT_COST = 12;
const SCRYPT_PREFIX = '$scrypt$';
let hashing: 'bcrypt' | 'scrypt' = 'scrypt';

/** Selects the format for new hashes (PASSWORD_HASHING); set once at startup. */
export function configurePasswordHashing(algorithm: 'bcrypt' | 'scrypt'): void {
  hashing = algorithm;
}
const SCRYPT_PARAMS = { ln: 15, r: 8, p: 1 } as const;
const SCRYPT_KEY_BYTES = 32;
const SCRYPT_SALT_BYTES = 16;
const BCRYPT_PATTERN = /^\$2[aby]\$\d{2}\$/u;
const SCRYPT_PATTERN = /^\$scrypt\$ln=(\d{1,2}),r=(\d{1,2}),p=(\d{1,2})\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/u;

function scryptKey(password: string, salt: Buffer, params: { ln: number; r: number; p: number }): Promise<Buffer> {
  const options: ScryptOptions = { N: 2 ** params.ln, r: params.r, p: params.p, maxmem: 256 * 2 ** params.ln * params.r };
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, SCRYPT_KEY_BYTES, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

function parseScryptHash(hash: string): { ln: number; r: number; p: number; salt: Buffer; key: Buffer } | null {
  const match = SCRYPT_PATTERN.exec(hash);
  if (match === null) return null;
  const [ln, r, p] = [Number(match[1]), Number(match[2]), Number(match[3])];
  // Refuse parameters outside what this server writes, so a stored value cannot demand unbounded work.
  if (ln < 10 || ln > 20 || r < 1 || r > 16 || p < 1 || p > 4) return null;
  return { ln, r, p, salt: Buffer.from(match[4] ?? '', 'base64url'), key: Buffer.from(match[5] ?? '', 'base64url') };
}

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
  return passwordWork.run(async () => {
    if (hashing === 'bcrypt') return bcrypt.hash(password, BCRYPT_COST);
    const salt = randomBytes(SCRYPT_SALT_BYTES);
    const key = await scryptKey(password, salt, SCRYPT_PARAMS);
    return `${SCRYPT_PREFIX}ln=${SCRYPT_PARAMS.ln},r=${SCRYPT_PARAMS.r},p=${SCRYPT_PARAMS.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
  });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return passwordWork.run(async () => {
    if (hash.startsWith(SCRYPT_PREFIX)) {
      const parsed = parseScryptHash(hash);
      if (parsed === null || parsed.key.length !== SCRYPT_KEY_BYTES) return false;
      const key = await scryptKey(password, parsed.salt, parsed);
      return timingSafeEqual(key, parsed.key);
    }
    if (BCRYPT_PATTERN.test(hash)) return bcrypt.compare(password, hash);
    return false;
  });
}

const dummyHashes = new Map<string, Promise<string>>();

/**
 * A hash of a random secret in the current format. Sign-in for unknown or disabled accounts
 * verifies against it, so their timing matches real accounts.
 */
export function dummyPasswordHash(): Promise<string> {
  let dummy = dummyHashes.get(hashing);
  if (dummy === undefined) {
    dummy = hashPassword(createSecretToken());
    dummyHashes.set(hashing, dummy);
  }
  return dummy;
}

/** With scrypt selected: true for a bcrypt hash or one with older scrypt parameters. */
export function passwordNeedsRehash(hash: string): boolean {
  if (hashing === 'bcrypt') return false;
  const parsed = hash.startsWith(SCRYPT_PREFIX) ? parseScryptHash(hash) : null;
  return parsed === null || parsed.ln !== SCRYPT_PARAMS.ln || parsed.r !== SCRYPT_PARAMS.r || parsed.p !== SCRYPT_PARAMS.p;
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
