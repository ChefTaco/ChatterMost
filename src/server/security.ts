import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import bcrypt from 'bcryptjs';

import type { AppEnv } from './env.js';

const BCRYPT_COST = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
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

export function safeEqualText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.byteLength !== rightBuffer.byteLength) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
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

export function passwordCostDescription(): string {
  return `bcrypt cost ${BCRYPT_COST}`;
}

function hashWithSecret(token: string, secret: string): string {
  return createHash('sha256').update(secret).update(':').update(token).digest('hex');
}
