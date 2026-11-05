import { lstatSync, readFileSync } from 'node:fs';
import type { ServerOptions } from 'node:https';

export type TlsReferences = {
  TLS_CERT_PATH?: string | undefined;
  TLS_KEY_PATH?: string | undefined;
};

/** Optional native TLS; standalone installations can retain their existing edge. */
export function listenerTls(value: TlsReferences): ServerOptions | undefined {
  if (value.TLS_CERT_PATH === undefined && value.TLS_KEY_PATH === undefined) return undefined;
  if (!value.TLS_CERT_PATH || !value.TLS_KEY_PATH)
    throw new Error('TLS certificate and private key must be configured together');
  for (const path of [value.TLS_CERT_PATH, value.TLS_KEY_PATH]) {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('TLS references must be regular files without symlinks');
  }
  const keyStat = lstatSync(value.TLS_KEY_PATH);
  if ((keyStat.mode & 0o077) !== 0) throw new Error('TLS private key must be owner-only');
  return {
    cert: readFileSync(value.TLS_CERT_PATH),
    key: readFileSync(value.TLS_KEY_PATH),
    minVersion: 'TLSv1.2'
  };
}
