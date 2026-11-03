import { describe, expect, it } from 'vitest';

import { TrustedProxySet } from '../../src/server/rate-limit.js';
import { hashSessionToken, hashToken, isSameWebSocketOrigin } from '../../src/server/security.js';

describe('trusted proxy configuration', () => {
  it('supports IPv4 and IPv6 CIDRs', () => {
    const proxies = new TrustedProxySet('127.0.0.0/8,::1/128');
    expect(proxies.has('127.0.0.1')).toBe(true);
    expect(proxies.has('::ffff:127.0.0.1')).toBe(true);
    expect(proxies.has('::1')).toBe(true);
    expect(proxies.has('198.51.100.7')).toBe(false);
  });

  it('fails startup-oriented parsing for malformed entries', () => {
    expect(() => new TrustedProxySet('127.0.0.1/99')).toThrow(/TRUSTED_PROXIES/u);
    expect(() => new TrustedProxySet('not-an-address')).toThrow(/TRUSTED_PROXIES/u);
  });
});

describe('token key separation', () => {
  it('invalidates sessions during cookie rotation without changing API token hashes', () => {
    const before = { COOKIE_SECRET: 'old-cookie-secret-with-enough-entropy', TOKEN_HASH_SECRET: 'stable-token-secret-with-enough-entropy' };
    const after = { ...before, COOKIE_SECRET: 'new-cookie-secret-with-enough-entropy' };
    expect(hashSessionToken('session-token', after)).not.toBe(hashSessionToken('session-token', before));
    expect(hashToken('bot-token', after)).toBe(hashToken('bot-token', before));
  });
});

describe('isSameWebSocketOrigin (CSWSH guard)', () => {
  const serverUrl = 'https://chat.example.com:9443';

  it('accepts a matching origin', () => {
    expect(isSameWebSocketOrigin('https://chat.example.com:9443', serverUrl)).toBe(true);
  });

  it('rejects a cross-origin host', () => {
    expect(isSameWebSocketOrigin('https://evil.example', serverUrl)).toBe(false);
  });

  it('rejects an origin with a mismatched port', () => {
    expect(isSameWebSocketOrigin('https://chat.example.com:8443', serverUrl)).toBe(false);
  });

  it('rejects an origin with a mismatched scheme', () => {
    expect(isSameWebSocketOrigin('http://chat.example.com:9443', serverUrl)).toBe(false);
  });

  it('rejects a missing origin for cookie-authenticated clients', () => {
    expect(isSameWebSocketOrigin(undefined, serverUrl)).toBe(false);
    expect(isSameWebSocketOrigin('', serverUrl)).toBe(false);
  });

  it('rejects a malformed origin', () => {
    expect(isSameWebSocketOrigin('not-a-url', serverUrl)).toBe(false);
  });
});
