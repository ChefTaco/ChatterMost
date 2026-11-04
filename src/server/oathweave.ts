import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { decodeJwt } from 'jose';
import { createOathweaveVerifier } from './oathweave-verifier.js';
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
  const verify = createOathweaveVerifier({
    issuer: env.OATHWEAVE_ISSUER,
    jwksUrl: env.OATHWEAVE_JWKS_URL,
    userinfoUrl: env.OATHWEAVE_USERINFO_URL,
    audience: 'chattermost'
  });
  const key = createHash('sha256')
    .update('chattermost:oathweave:session:v1\0')
    .update(env.COOKIE_SECRET)
    .digest();
  async function authenticate(token: string) {
    const identity = await verify(token);
    if (!identity.permissions.includes('chattermost:session'))
      throw new Error('Chat sign-in permission required');
    const link = links.find(
      (value) => value.issuer === identity.issuer && value.subject === identity.subject
    );
    if (!link) throw new Error('Explicit chat account link required');
    const claims = decodeJwt(token);
    if (typeof claims.exp !== 'number') throw new Error('Identity expiry required');
    return { localUserId: link.localUserId, expiresAt: claims.exp * 1000 };
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
