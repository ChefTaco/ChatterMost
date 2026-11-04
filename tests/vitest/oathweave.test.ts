import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStore } from '../../src/server/store.js';
import { configuredBrowserOrigins } from '../../src/server/oathweave.js';
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createTestServer, login } from './helpers.js';
import { SessionService } from '../../src/server/services.js';
import { loadEnv } from '../../src/server/env.js';
import { guardedSocketSender, authenticateSocketUpgrade } from '../../src/server/bound-socket.js';

describe('Oathweave chat sessions', () => {
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  beforeAll(async () => {
    keys = await generateKeyPair('RS256');
  });
  afterEach(() => vi.unstubAllGlobals());
  it('exchanges only explicit account links, encrypts credentials and revalidates cookie sessions', async () => {
    const server = await createTestServer({
      SERVER_URL: 'https://chat.example.test',
      OATHWEAVE_ISSUER: 'https://identity.example.test',
      OATHWEAVE_JWKS_URL: 'https://identity.example.test/jwks',
      OATHWEAVE_USERINFO_URL: 'https://identity.example.test/userinfo',
      OATHWEAVE_BROWSER_ORIGINS_JSON: '["https://console.example.test"]'
    });
    const nativeToken = await login(server);
    const user = await server.services.users.createUser({
      username: 'alice',
      email: 'alice@example.test',
      password: 'SyntheticPassword123!',
      role: 'system_user',
      actorUserId: null
    });
    let active = true;
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockImplementation(async (input) =>
          (input instanceof Request ? input.url : input.toString()).endsWith('/jwks')
            ? Response.json({ keys: [{ ...(await exportJWK(keys.publicKey)), kid: 'test' }] })
            : active
              ? Response.json({ sub: 'fake-subject' })
              : new Response('', { status: 401 })
        )
    );
    const env = loadEnv({
      enforceFileMode: false,
      overrides: {
        NODE_ENV: 'test',
        ENABLE_DEV_DEFAULTS: 'true',
        SERVER_URL: 'https://chat.example.test',
        OATHWEAVE_BROWSER_ORIGINS_JSON: '["https://console.example.test"]',
        COOKIE_SECRET: 'test-cookie-secret-with-enough-entropy',
        OATHWEAVE_ISSUER: 'https://identity.example.test',
        OATHWEAVE_JWKS_URL: 'https://identity.example.test/jwks',
        OATHWEAVE_USERINFO_URL: 'https://identity.example.test/userinfo',
        OATHWEAVE_CHAT_IDENTITIES_JSON: JSON.stringify([
          { issuer: 'https://identity.example.test', subject: 'fake-subject', localUserId: user.id }
        ])
      }
    });
    server.services.sessions = new SessionService(server.store, env, server.services.auditLog);
    const token = async (audience = 'chattermost', subject = 'fake-subject') =>
      new SignJWT({
        actorType: 'USER',
        sessionId: 'fake-session',
        clientId: 'hivexui-chattermost',
        roles: ['SUPER_ADMIN'],
        permissions: ['chattermost:session']
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'test' })
        .setSubject(subject)
        .setIssuer('https://identity.example.test')
        .setAudience(audience)
        .setJti('fake-jti')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(keys.privateKey);
    const resourceToken = await token();
    const exchange = (bearer = resourceToken, origin = 'https://console.example.test') =>
      server.app.request('/api/v4/auth/oathweave/session', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + bearer, Origin: origin }
      });
    expect((await exchange(resourceToken, 'https://untrusted.example.test')).status).toBe(403);
    expect((await exchange(await token('emberpath'))).status).toBe(401);
    expect((await exchange(await token('chattermost', 'unlinked-subject'))).status).toBe(401);
    const response = await exchange();
    expect(response.status).toBe(200);
    const result = (await response.json()) as { user: { id: string; roles: string } };
    expect(result.user).toMatchObject({ id: user.id, roles: 'system_user' });
    expect(response.headers.get('Token')).toBeNull();
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    if (!cookie) throw new Error('Expected a native session cookie');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('Secure');
    const saved = server.store.read((state) =>
      state.sessions.find((session) => session.userId === user.id)
    );
    if (!saved) throw new Error('Expected a saved bound session');
    expect(saved.oathweaveContext).toBeDefined();
    expect(saved.oathweaveContext).not.toContain(resourceToken);
    expect(saved.expiresAt).toBeLessThanOrEqual(Date.now() + 15 * 60 * 1000);
    const opaque = cookie.slice(cookie.indexOf('=') + 1);
    expect(server.services.sessions.authenticateToken(opaque)).toBeNull();
    expect(
      (await server.app.request('/api/v4/users/me', { headers: { Cookie: cookie } })).status
    ).toBe(200);
    const temporary = await mkdtemp(join(tmpdir(), 'chat-bound-session-restart-'));
    const stateFile = join(temporary, 'state.json');
    const persisted = new JsonStore(stateFile);
    await persisted.initialize();
    await persisted.write((state) =>
      Object.assign(
        state,
        server.store.read((value) => structuredClone(value))
      )
    );
    await persisted.close();
    const restored = new JsonStore(stateFile);
    await restored.initialize();
    const restartedSessions = new SessionService(restored, env, server.services.auditLog);
    expect(await restartedSessions.authenticateWebSession(opaque)).not.toBeNull();
    const mutation = (origin: string) =>
      server.app.request(`/api/v4/users/${user.id}/status`, {
        method: 'PUT',
        headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'online' })
      });
    expect((await mutation('https://untrusted.example.test')).status).toBe(403);
    expect((await mutation('https://console.example.test')).status).toBe(200);
    active = false;
    expect(await restartedSessions.authenticateWebSession(opaque)).toBeNull();
    await restored.close();
    await rm(temporary, { recursive: true, force: true });
    expect(
      (await server.app.request('/api/v4/users/me', { headers: { Cookie: cookie } })).status
    ).toBe(401);
    expect(server.services.sessions.authenticateToken(nativeToken)).not.toBeNull();
    await server.abuseControl.close();
    await server.store.close();
  });
  it('guards outgoing frames, coalesces a burst and closes on revocation', async () => {
    const socket = { send: vi.fn(), close: vi.fn() };
    let resolve!: (allowed: boolean) => void;
    const validate = vi.fn(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        })
    );
    const send = guardedSocketSender(socket, validate);
    send('first');
    send('second');
    expect(validate).toHaveBeenCalledOnce();
    expect(socket.send).not.toHaveBeenCalled();
    resolve(true);
    await new Promise((done) => setTimeout(done, 0));
    expect(socket.send.mock.calls).toEqual([['first'], ['second']]);
    send('revoked');
    resolve(false);
    await new Promise((done) => setTimeout(done, 0));
    expect(socket.send).toHaveBeenCalledTimes(2);
    expect(socket.close).toHaveBeenCalledWith(1008, 'Session expired');
  });
  it('bounds pending identity checks and never sends after overload', async () => {
    const socket = { send: vi.fn(), close: vi.fn() };
    const send = guardedSocketSender(socket, () => new Promise(() => undefined), 1);
    send('pending');
    send('overload');
    expect(socket.close).toHaveBeenCalledWith(1013, 'Session validation overloaded');
    expect(socket.send).not.toHaveBeenCalled();
  });
  it('rejects cross-origin cookie upgrades and never falls back from an explicit invalid credential', async () => {
    const authenticate = vi.fn(async () => ({ user: 'fake-user' }));
    const expected = 'https://console.example.test';
    expect(
      await authenticateSocketUpgrade(
        { cookie: 'MMSID=obviously-fake-cookie', origin: 'https://untrusted.example.test' },
        expected,
        'MMSID',
        authenticate
      )
    ).toBeNull();
    expect(
      await authenticateSocketUpgrade(
        { cookie: 'MMSID=obviously-fake-cookie', origin: expected, authorization: 'invalid' },
        expected,
        'MMSID',
        authenticate
      )
    ).toBeNull();
    expect(authenticate).not.toHaveBeenCalled();
    expect(
      await authenticateSocketUpgrade(
        { cookie: 'MMSID=obviously-fake-cookie', origin: expected },
        expected,
        'MMSID',
        authenticate
      )
    ).toEqual({ user: 'fake-user' });
    expect(
      await authenticateSocketUpgrade(
        { cookie: 'MMSID=obviously-fake-cookie', origin: expected },
        'https://chat.example.test',
        'MMSID',
        authenticate,
        [expected]
      )
    ).toEqual({ user: 'fake-user' });
  });
  it('requires exact configured HTTPS console origins while preserving the native URL', () => {
    const env = loadEnv({
      enforceFileMode: false,
      overrides: {
        NODE_ENV: 'test',
        ENABLE_DEV_DEFAULTS: 'true',
        SERVER_URL: 'https://chat.example.test',
        OATHWEAVE_ISSUER: 'https://identity.example.test',
        OATHWEAVE_BROWSER_ORIGINS_JSON: '["https://console.example.test"]'
      }
    });
    expect(configuredBrowserOrigins(env)).toEqual([
      'https://chat.example.test',
      'https://console.example.test'
    ]);
    for (const value of [
      'http://console.example.test',
      'https://console.example.test/path',
      'https://console.example.test/',
      'https://*.example.test'
    ])
      expect(() =>
        configuredBrowserOrigins({
          ...env,
          OATHWEAVE_BROWSER_ORIGINS_JSON: JSON.stringify([value])
        })
      ).toThrow();
  });
});
