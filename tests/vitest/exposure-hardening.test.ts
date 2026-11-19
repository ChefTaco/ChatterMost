import { describe, expect, it } from 'vitest';

import { resolveClientIdentity, TrustedProxySet } from '../../src/server/rate-limit.js';
import { PasswordWorkGate } from '../../src/server/security.js';
import { SocketAdmission, SocketMessageBudget } from '../../src/server/socket-limits.js';
import { webClient } from '../../src/web/assets.js';
import { bearer, createTestServer, firstChannelId, login, type TestServer } from './helpers.js';

async function post(server: TestServer, token: string, path: string, body: unknown, method = 'POST'): Promise<Response> {
  return server.app.request(path, { method, headers: bearer(token), body: JSON.stringify(body) });
}

async function createPost(server: TestServer, token: string, channelId: string, message: string): Promise<{ id: string }> {
  const response = await post(server, token, '/api/v4/posts', { channel_id: channelId, message });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string };
}

async function inviteMember(server: TestServer, adminToken: string, username: string): Promise<string> {
  const invite = (await (await post(server, adminToken, '/admin/invites', {})).json()) as { code: string };
  const password = `${username}Password123!`;
  const signup = await server.app.request('/api/v4/users', {
    method: 'POST',
    headers: server.baseHeaders,
    body: JSON.stringify({ invite_code: invite.code, username, email: `${username}@example.test`, password })
  });
  expect(signup.status).toBe(201);
  const signedIn = await server.app.request('/api/v4/users/login', {
    method: 'POST',
    headers: server.baseHeaders,
    body: JSON.stringify({ login_id: username, password })
  });
  return signedIn.headers.get('Token') ?? '';
}

describe('Internet exposure hardening', () => {
  it('refuses reaction names that could redirect a client request, and keeps real ones', async () => {
    const server = await createTestServer();
    const token = await login(server);
    const channelId = await firstChannelId(server.app, token);
    const target = await createPost(server, token, channelId, 'react to me');
    for (const name of ['../../../../../posts/abc', 'a/b', 'a?b', 'a#b', 'a%2fb', 'a b', 'a\\b', 'x'.repeat(65)]) {
      const response = await post(server, token, '/api/v4/reactions', { post_id: target.id, emoji_name: name });
      expect(response.status, name).toBe(400);
    }
    for (const name of ['+1', 'white_check_mark', '👍', '🧑‍💻']) {
      const response = await post(server, token, '/api/v4/reactions', { post_id: target.id, emoji_name: name });
      expect(response.status, name).toBe(201);
    }
    expect(webClient).toContain("'/reactions/' + encodeURIComponent(emoji)");
    expect(webClient).not.toMatch(/target: '_blank'(?!, rel: 'noopener noreferrer')/u);
  });

  it('bounds every member-writable field that is persisted', async () => {
    const server = await createTestServer();
    const token = await login(server);
    const channelId = await firstChannelId(server.app, token);
    const me = (await (await server.app.request('/api/v4/users/me', { headers: bearer(token) })).json()) as { id: string };
    const rejected: [string, string, unknown][] = [
      ['PUT', `/api/v4/users/${me.id}/patch`, { nickname: 'n'.repeat(65) }],
      ['PUT', `/api/v4/channels/${channelId}/patch`, { header: 'h'.repeat(1025) }],
      ['PUT', `/api/v4/channels/${channelId}/patch`, { purpose: 'p'.repeat(251) }],
      ['PUT', `/api/v4/users/${me.id}/preferences`, [{ category: 'c', name: 'n', value: 'v'.repeat(20_001) }]],
      ['PUT', `/api/v4/users/${me.id}/preferences`, Array.from({ length: 201 }, (_, index) => ({ category: 'c', name: String(index), value: '' }))],
      ['POST', '/api/v4/posts', { channel_id: channelId, message: 'big props', props: { blob: 'x'.repeat(70_000) } }],
      ['POST', '/api/v4/posts/ids', Array.from({ length: 1001 }, () => 'a')],
      ['POST', '/api/v4/users/status/ids', Array.from({ length: 1001 }, () => 'a')],
      ['POST', '/api/v4/channels/direct', Array.from({ length: 9 }, (_, index) => `user${index}`)],
      ['POST', '/api/v4/posts/search', { terms: 't'.repeat(513) }],
      ['PUT', '/api/v4/users/sessions/device', { device_id: 'd'.repeat(513) }],
      ['POST', '/admin/invites', { role: 'system_admin made_up_role' }],
      ['POST', '/admin/invites', { max_uses: 10_001 }]
    ];
    for (const [method, path, body] of rejected) {
      const response = await post(server, token, path, body, method);
      expect(response.status, `${method} ${path}`).toBe(400);
    }
    const accepted = await post(server, token, `/api/v4/users/${me.id}/preferences`, [{ category: 'theme', name: '', value: 'v'.repeat(5000) }], 'PUT');
    expect(accepted.status).toBe(200);
  });

  it('caps how many preferences one account may store', async () => {
    const server = await createTestServer();
    const token = await login(server);
    const me = (await (await server.app.request('/api/v4/users/me', { headers: bearer(token) })).json()) as { id: string };
    for (let batch = 0; batch < 10; batch += 1) {
      const response = await post(server, token, `/api/v4/users/${me.id}/preferences`, Array.from({ length: 200 }, (_, index) => ({ category: 'c', name: `${batch}-${index}`, value: '' })), 'PUT');
      expect(response.status).toBe(200);
    }
    const overflow = await post(server, token, `/api/v4/users/${me.id}/preferences`, [{ category: 'c', name: 'one-too-many', value: '' }], 'PUT');
    expect(overflow.status).toBe(400);
    const update = await post(server, token, `/api/v4/users/${me.id}/preferences`, [{ category: 'c', name: '0-0', value: 'changed' }], 'PUT');
    expect(update.status).toBe(200);
  });

  it('rejects an unusable invite without creating an account', async () => {
    const server = await createTestServer();
    const response = await server.app.request('/api/v4/users', {
      method: 'POST',
      headers: server.baseHeaders,
      body: JSON.stringify({ invite_code: 'not-a-real-invite', username: 'intruder', email: 'intruder@example.test', password: 'IntruderPassword123!' })
    });
    expect(response.status).toBe(400);
    expect(server.services.users.findByUsername('intruder')).toBeNull();
  });

  it('applies the sign-in budget to sign-up attempts', async () => {
    const server = await createTestServer({ RATE_LIMIT_LOGIN_SOURCE_MAX: '3' });
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await server.app.request('/api/v4/users', {
        method: 'POST',
        headers: server.baseHeaders,
        body: JSON.stringify({ invite_code: `guess-${attempt}`, username: 'intruder', email: 'intruder@example.test', password: 'IntruderPassword123!' })
      });
      statuses.push(response.status);
    }
    expect(statuses).toEqual([400, 400, 400, 429, 429]);
  });

  it('screens an edit like a new post so approved text cannot become held text', async () => {
    const server = await createTestServer();
    const adminToken = await login(server);
    const memberToken = await inviteMember(server, adminToken, 'editor');
    const readerToken = await inviteMember(server, adminToken, 'reader');
    const channelId = await firstChannelId(server.app, memberToken);
    const policy = await post(server, adminToken, '/admin/supervision/policy', { mode: 'pre_moderation', blockedTerms: ['forbiddenword'] }, 'PUT');
    expect(policy.status).toBe(200);
    const created = await createPost(server, memberToken, channelId, 'a harmless message');
    expect((await server.app.request(`/api/v4/posts/${created.id}`, { headers: bearer(readerToken) })).status).toBe(200);
    const edited = await post(server, memberToken, `/api/v4/posts/${created.id}/patch`, { message: 'now with forbiddenword' }, 'PUT');
    expect(edited.status).toBe(200);
    expect((await server.app.request(`/api/v4/posts/${created.id}`, { headers: bearer(readerToken) })).status).toBe(404);
    expect((await server.app.request(`/api/v4/posts/${created.id}`, { headers: bearer(memberToken) })).status).toBe(200);
    expect((await server.app.request(`/api/v4/posts/${created.id}`, { headers: bearer(adminToken) })).status).toBe(200);
  });

  it('sends a policy that allows no inline code and only this server as a connection target', async () => {
    const server = await createTestServer({ SERVER_URL: 'https://chat.example.test:9443', NODE_ENV: 'test' });
    const policy = (await server.app.request('/')).headers.get('content-security-policy') ?? '';
    expect(policy).toContain("connect-src 'self' wss://chat.example.test:9443;");
    expect(policy).not.toContain('unsafe-inline');
    expect(policy).not.toMatch(/\bwss?:(?!\/\/)/u);
    for (const directive of ["object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"]) {
      expect(policy).toContain(directive);
    }
  });
});

describe('Password work gate', () => {
  it('runs a bounded number at once, queues a few, and refuses the rest immediately', async () => {
    const gate = new PasswordWorkGate(1, 2);
    const releases: (() => void)[] = [];
    let running = 0;
    let peak = 0;
    const work = () =>
      gate.run(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise<void>((resolve) => releases.push(resolve));
        running -= 1;
        return 'done';
      });
    const accepted = [work(), work(), work()];
    await expect(work()).rejects.toMatchObject({ statusCode: 429 });
    for (let index = 0; index < 3; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      releases[index]?.();
    }
    await expect(Promise.all(accepted)).resolves.toEqual(['done', 'done', 'done']);
    expect(peak).toBe(1);
  });

  it('frees its slot when the work fails', async () => {
    const gate = new PasswordWorkGate(1, 0);
    await expect(gate.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(gate.run(() => Promise.resolve('next'))).resolves.toBe('next');
  });
});

describe('WebSocket ceilings', () => {
  it('limits open sockets overall, per address, and before sign-in', () => {
    const admission = new SocketAdmission({ maximum: 5, maximumPerSource: 3, maximumPending: 3, maximumPendingPerSource: 2 });
    const first = admission.admit('198.51.100.1', false);
    const second = admission.admit('198.51.100.1', false);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(admission.admit('198.51.100.1', false)).toBeNull();
    // A socket that signs in stops counting as pending but still counts for its address.
    if (first !== null) first.signedIn = () => true;
    expect(admission.admit('198.51.100.1', false)).not.toBeNull();
    expect(admission.admit('198.51.100.1', true)).toBeNull();
    expect(admission.admit('198.51.100.2', false)).not.toBeNull();
    expect(admission.admit('198.51.100.3', false)).toBeNull();
    expect(admission.admit('198.51.100.3', true)).not.toBeNull();
    expect(admission.admit('198.51.100.4', true)).toBeNull();
    second?.release();
    second?.release();
    expect(admission.size).toBe(4);
    expect(admission.admit('198.51.100.4', true)).not.toBeNull();
  });

  it('closes a socket that floods, and one that never signs in', () => {
    const signedIn = new SocketMessageBudget(3, 1000, 2);
    expect([1, 2, 3, 4].map(() => signedIn.accept(true, 0))).toEqual([true, true, true, false]);
    expect(signedIn.accept(true, 1000)).toBe(true);
    const anonymous = new SocketMessageBudget(100, 1000, 2);
    expect([1, 2, 3].map(() => anonymous.accept(false, 0))).toEqual([true, true, false]);
  });

  it('attributes a connection to the forwarded address only behind a trusted proxy', () => {
    const trusted = new TrustedProxySet('127.0.0.1/32');
    expect(resolveClientIdentity('203.0.113.9', '198.51.100.7', trusted).address).toBe('203.0.113.9');
    expect(resolveClientIdentity('127.0.0.1', '198.51.100.7', trusted).address).toBe('198.51.100.7');
    expect(resolveClientIdentity('::ffff:127.0.0.1', '10.0.0.1, 198.51.100.7', trusted).address).toBe('198.51.100.7');
    expect(resolveClientIdentity('127.0.0.1', 'not-an-address', trusted).address).toBe('127.0.0.1');
  });
});
