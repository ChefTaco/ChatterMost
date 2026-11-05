import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createServerApp } from '../../src/server/app.js';
import { loadEnv } from '../../src/server/env.js';
import { rehearsalSocketActionAllowed } from '../../src/server/rehearsal.js';

function configuration(root: string) {
  return loadEnv({ enforceFileMode: false, envFile: path.join(root, 'absent.env'), overrides: {
    NODE_ENV: 'test', ENABLE_DEV_DEFAULTS: 'true', STORE_BACKEND: 'json',
    STORE_PATH: path.join(root, 'store.json'), FILE_STORAGE_PATH: path.join(root, 'files'),
    PROFILE_IMAGE_STORAGE_PATH: path.join(root, 'profiles'), ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'SyntheticRehearsalPassword123!', ADMIN_EMAIL: 'admin@example.test',
    COOKIE_SECRET: 'synthetic-rehearsal-cookie-secret-12345678',
    TOKEN_HASH_SECRET: 'synthetic-rehearsal-token-secret-123456789',
    SERVER_URL: 'http://localhost:8065'
  } });
}

describe('isolated authenticated restore', () => {
  it('requires explicit outer isolation and keeps existing preflight health-only', () => {
    expect(() => loadEnv({ enforceFileMode: false, overrides: { ENABLE_DEV_DEFAULTS: 'true', AUTHENTICATED_REHEARSAL: 'true', HIVE_REHEARSAL: 'false' } })).toThrow('requires HIVE_REHEARSAL');
  });

  it('reads preserved accounts/files/posts using volatile authenticated sessions without durable changes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'chat-auth-rehearsal-'));
    const env = configuration(root);
    const original = await createServerApp(env);
    const user = original.services.users.findByUsername('admin');
    if (!user) throw new Error('missing synthetic admin');
    const channel = original.services.channels.listForUser(user.id)[0];
    if (!channel) throw new Error('missing synthetic channel');
    const post = await original.services.posts.createPost({ actor: user, channelId: channel.id, message: 'preserved restore fixture' });
    const originalSession = await original.services.auth.login('admin', env.ADMIN_PASSWORD);
    await original.store.close(); await original.abuseControl.close();
    const before = await readFile(env.STORE_PATH, 'utf8');
    const server = await createServerApp({ ...env, HIVE_REHEARSAL: true, AUTHENTICATED_REHEARSAL: true, PREFLIGHT_MODE: true });
    const stale = await server.app.request('/api/v4/users/me', { headers: { Authorization: `Bearer ${originalSession.token}` } });
    expect(stale.status).toBe(401);
    const failed = await server.app.request('/api/v4/users/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login_id: 'admin', password: 'incorrect-password' }) });
    expect(failed.status).toBe(400);
    const login = await server.app.request('/api/v4/users/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login_id: 'admin', password: env.ADMIN_PASSWORD }) });
    expect(login.status).toBe(200);
    const token = login.headers.get('Token');
    expect(token).toBeTruthy();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    expect((await server.app.request('/api/v4/users/me', { headers })).status).toBe(200);
    expect((await server.app.request(`/api/v4/posts/${post.id}`, { headers })).status).toBe(200);
    for (const [method, url] of [['POST', '/api/v4/posts'], ['PUT', `/api/v4/posts/${post.id}`], ['DELETE', `/api/v4/posts/${post.id}`], ['POST', '/api/v4/files'], ['PATCH', `/api/v4/users/${user.id}/patch`]] as const) {
      expect((await server.app.request(url, { method: method, headers, body: '{}' })).status).toBe(503);
    }
    await expect(server.services.users.patchUser(user.id, { nickname: 'forbidden' }, user)).rejects.toThrow('Durable mutations');
    expect((await server.app.request('/api/v4/users/logout', { method: 'POST', headers })).status).toBe(200);
    expect((await server.app.request('/api/v4/users/me', { headers })).status).toBe(401);
    await server.store.close(); await server.abuseControl.close();
    expect(await readFile(env.STORE_PATH, 'utf8')).toBe(before);
    const reopened = await createServerApp({ ...env, HIVE_REHEARSAL: true, AUTHENTICATED_REHEARSAL: true, PREFLIGHT_MODE: true });
    expect((await reopened.app.request('/api/v4/users/me', { headers })).status).toBe(401);
    await reopened.store.close(); await reopened.abuseControl.close();
    expect(await readFile(env.STORE_PATH, 'utf8')).toBe(before);
  });

  it('limits socket input to authentication, ping and read-only status requests', () => {
    for (const action of ['authentication_challenge', 'ping', 'get_statuses', 'get_statuses_by_ids']) expect(rehearsalSocketActionAllowed(JSON.stringify({ action }))).toBe(true);
    for (const action of ['user_typing', 'post', 'command', 'update_status', '']) expect(rehearsalSocketActionAllowed(JSON.stringify({ action }))).toBe(false);
    expect(rehearsalSocketActionAllowed('{')).toBe(false);
  });
});
