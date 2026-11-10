import { isIP } from 'node:net';
import { checkServerIdentity, type ConnectionOptions } from 'node:tls';

/** Verify the configured product identity while connecting to its local listener. */
export function probeTls(ca: Buffer, identity: string): ConnectionOptions {
  if (isIP(identity) !== 0) {
    // SNI permits DNS names only. Keep CA validation and explicitly verify the
    // configured IP SAN instead of the loopback address used by the probe.
    return { ca, servername: '', checkServerIdentity: (_hostname, certificate) => checkServerIdentity(identity, certificate) };
  }
  return { ca, servername: identity };
}
