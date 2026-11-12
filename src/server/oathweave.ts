import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  OathweaveError,
  createOathweaveVerifier,
  requireIdentityLink,
  requirePermissions,
  type OathweaveUserPrincipal,
  type OathweaveVerifierOptions
} from '@hivemagnus/hive-common/oathweave';
import type { AppEnv } from './env.js';

const linksSchema = z
  .array(
    z
      .object({
        issuer: z.url(),
        subject: z.string().min(1).max(256),
        localUserId: z.string().min(1).max(256)
      })
      .strict()
  )
  .max(10000);

export const CHAT_AUDIENCE = 'chattermost';
export const CHAT_SESSION_PERMISSION = 'chattermost:session';

export type ChatVerifierOptions = Pick<
  OathweaveVerifierOptions,
  'issuer' | 'jwksUrl' | 'userinfoUrl' | 'fetch' | 'now'
> & { audience?: string };

/**
 * The shared Oathweave verifier with ChatterMost's established rules: user principals only,
 * no clock tolerance, a required `roles` array and an online session check on every call,
 * so a signed-out session stops working immediately rather than after a cache window.
 */
export function createChatVerifier(options: ChatVerifierOptions) {
  const verifier = createOathweaveVerifier({
    ...options,
    audience: options.audience ?? CHAT_AUDIENCE,
    accept: 'user',
    clockToleranceSec: 0,
    sessionCacheTtlMs: 0
  });
  return async (token: string): Promise<OathweaveUserPrincipal> => {
    const principal = await verifier.verifyUser(token);
    if (!Array.isArray(principal.claims.roles)) throw new OathweaveError('invalid_claims');
    return principal;
  };
}

export function createChatIdentity(env: AppEnv) {
  if (!env.OATHWEAVE_ISSUER && !env.OATHWEAVE_JWKS_URL && !env.OATHWEAVE_USERINFO_URL)
    return undefined;
  if (!env.OATHWEAVE_ISSUER || !env.OATHWEAVE_JWKS_URL || !env.OATHWEAVE_USERINFO_URL)
    throw new Error('Oathweave configuration is incomplete');
  const links = linksSchema.parse(JSON.parse(env.OATHWEAVE_CHAT_IDENTITIES_JSON));
  const seen = new Set<string>();
  for (const link of links) {
    const id = JSON.stringify([link.issuer, link.subject]);
    if (seen.has(id)) throw new Error('Duplicate identity account link');
    seen.add(id);
  }
  const verify = createChatVerifier({
    issuer: env.OATHWEAVE_ISSUER,
    jwksUrl: env.OATHWEAVE_JWKS_URL,
    userinfoUrl: env.OATHWEAVE_USERINFO_URL
  });
  const key = createHash('sha256')
    .update('chattermost:oathweave:session:v1\0')
    .update(env.COOKIE_SECRET)
    .digest();
  async function authenticate(token: string) {
    const principal = await verify(token);
    requirePermissions(principal, [CHAT_SESSION_PERMISSION], { wildcards: false });
    const link = requireIdentityLink(links, principal);
    return { localUserId: link.localUserId, expiresAt: principal.expiresAt * 1000 };
  }
  function seal(token: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const value = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return [nonce, cipher.getAuthTag(), value]
      .map((bytes) => bytes.toString('base64url'))
      .join('.');
  }
  function open(value: string): string {
    const parts = value.split('.');
    if (parts.length !== 3) throw new Error('Invalid identity context');
    const [nonce, tag, ciphertext] = parts.map((part) => Buffer.from(part, 'base64url'));
    if (!nonce || nonce.length !== 12 || !tag || tag.length !== 16 || !ciphertext)
      throw new Error('Invalid identity context');
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
  return { authenticate, seal, open };
}

/** Exact opt-in console origins preserve the native Mattermost public URL. */
export function configuredBrowserOrigins(env: AppEnv): readonly string[] {
  const origins = z
    .array(
      z.string().refine((value) => {
        try {
          const url = new URL(value);
          return url.protocol === 'https:' && !url.hostname.includes('*') && url.origin === value;
        } catch {
          return false;
        }
      })
    )
    .max(20)
    .parse(JSON.parse(env.OATHWEAVE_BROWSER_ORIGINS_JSON));
  if (origins.length && !env.OATHWEAVE_ISSUER)
    throw new Error('Browser origins require configured Oathweave identity');
  return [...new Set([new URL(env.SERVER_URL).origin, ...origins])];
}
