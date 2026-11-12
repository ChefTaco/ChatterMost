import { describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/server/env.js';
import { HIVEXUI_STUB_PATHS, renderHiveXuiStub } from '../../src/server/hivexui-stub.js';
import { bearer, createTestServer, login } from './helpers.js';

const stubCsp =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function envWith(value: string) {
  return loadEnv({
    enforceFileMode: false,
    overrides: { NODE_ENV: 'test', ENABLE_DEV_DEFAULTS: 'true', HIVEXUI_URL: value }
  });
}

describe('retired web UI paths', () => {
  it('serve the static HiveXUI notice when HIVEXUI_URL is unset', async () => {
    const server = await createTestServer({ HIVEXUI_URL: '' });
    for (const path of HIVEXUI_STUB_PATHS) {
      for (const method of ['GET', 'HEAD']) {
        const response = await server.app.request(path, { method });
        expect(response.status, `${method} ${path}`).toBe(200);
        expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('content-security-policy')).toBe(stubCsp);
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(response.headers.get('location')).toBeNull();
        if (method === 'HEAD') continue;
        const html = await response.text();
        expect(html).toContain('<html lang="en">');
        expect(html).toContain('<title>ChatterMost is managed in HiveXUI</title>');
        expect(html).toContain('<h1>ChatterMost is managed in HiveXUI</h1>');
        expect(html).toContain(
          '<p>Open HiveXUI to manage ChatterMost. Operators can set HIVEXUI_URL so this address redirects there.</p>'
        );
        expect(html).not.toContain('<script');
        expect(html).not.toContain('<a ');
      }
    }
  });

  it('redirect to HIVEXUI_URL without appending the request path', async () => {
    const server = await createTestServer({
      HIVEXUI_URL: 'https://hivexui.example.test/chat?view=1&x=2'
    });
    for (const path of HIVEXUI_STUB_PATHS) {
      for (const method of ['GET', 'HEAD']) {
        const response = await server.app.request(`${path}?invite=abc`, {
          method,
          redirect: 'manual'
        });
        expect(response.status, `${method} ${path}`).toBe(302);
        expect(response.headers.get('location')).toBe(
          'https://hivexui.example.test/chat?view=1&x=2'
        );
        expect(response.headers.get('cache-control')).toBe('no-store');
        if (method === 'HEAD') continue;
        expect(await response.text()).toContain(
          '<p><a href="https://hivexui.example.test/chat?view=1&amp;x=2">Open HiveXUI</a> to manage ChatterMost.</p>'
        );
      }
    }
  });

  it('no longer serves the retired UI assets', async () => {
    const server = await createTestServer();
    for (const path of ['/assets/styles.css', '/assets/app.js', '/favicon.svg']) {
      expect((await server.app.request(path)).status, path).toBe(404);
    }
  });

  it('escapes the configured URL in the link', () => {
    expect(renderHiveXuiStub('ChatterMost', 'https://example.com/?a="b"&c=<d>\'')).toContain(
      'href="https://example.com/?a=&quot;b&quot;&amp;c=&lt;d&gt;&#39;"'
    );
  });
});

describe('HIVEXUI_URL configuration', () => {
  it('accepts absolute http(s) URLs and stores the normalized form', () => {
    expect(envWith('https://example.com').HIVEXUI_URL).toBe('https://example.com/');
    expect(envWith('http://hivexui.example.test:8443/ui').HIVEXUI_URL).toBe(
      'http://hivexui.example.test:8443/ui'
    );
    expect(envWith('').HIVEXUI_URL).toBeUndefined();
  });

  it.each([
    'ftp://x',
    'not a url',
    '/relative',
    'https://user:pw@example.com/',
    'https://example.com/#frag',
    'javascript:alert(1)'
  ])('rejects %s at startup without echoing it', (value) => {
    let message = '';
    try {
      envWith(value);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('HIVEXUI_URL must be an absolute http(s) URL');
    expect(message).toContain('HIVEXUI_URL');
    expect(message).not.toContain(value);
  });
});

describe('API routes are unaffected by HIVEXUI_URL', () => {
  it.each([
    ['unset', ''],
    ['set', 'https://hivexui.example.test/']
  ])('answers ping and login when HIVEXUI_URL is %s', async (_label, value) => {
    const server = await createTestServer({ HIVEXUI_URL: value });
    const ping = await server.app.request('/api/v4/system/ping');
    expect(ping.status).toBe(200);
    expect(ping.headers.get('content-type')).toContain('application/json');
    expect((await ping.json()) as Record<string, unknown>).toMatchObject({ status: 'OK' });
    const token = await login(server);
    const me = await server.app.request('/api/v4/users/me', { headers: bearer(token) });
    expect(me.status).toBe(200);
    expect((await me.json()) as { username: string }).toMatchObject({ username: 'admin' });
    const missing = await server.app.request('/api/v4/users/me');
    expect(missing.status).toBe(401);
  });
});
