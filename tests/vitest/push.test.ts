import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { parseDeviceId } from '../../src/server/push.js';
import { bearer, createTestServer, firstChannelId, login, type TestServer } from './helpers.js';

const proxies: Server[] = [];

afterEach(async () => {
  await Promise.all(proxies.splice(0).map((proxy) => new Promise((resolve) => proxy.close(resolve))));
});

async function pushProxy(answer: (payload: Record<string, unknown>) => Record<string, unknown>): Promise<{ url: string; received: { path: string; payload: Record<string, unknown> }[] }> {
  const received: { path: string; payload: Record<string, unknown> }[] = [];
  const proxy = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      received.push({ path: request.url ?? '', payload });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(answer(payload)));
    });
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  proxies.push(proxy);
  return { url: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`, received };
}

async function mobileUser(server: TestServer, channelId: string, username: string, deviceId: string): Promise<{ id: string; token: string }> {
  const user = await server.services.users.createUser({ username, email: `${username}@example.test`, password: 'SyntheticPassword123!', role: 'system_user', actorUserId: null });
  const team = server.store.read((state) => state.teams[0]);
  if (team === undefined) throw new Error('missing team');
  await server.services.teams.addUserToTeam(team.id, user.id, 'team_user');
  await server.services.channels.addUserToChannel(channelId, user.id, '');
  const signIn = await server.app.request('/api/v4/users/login', { method: 'POST', headers: server.baseHeaders, body: JSON.stringify({ login_id: username, password: 'SyntheticPassword123!' }) });
  const token = signIn.headers.get('Token') ?? '';
  expect((await server.app.request('/api/v4/users/sessions/device', { method: 'PUT', headers: bearer(token), body: JSON.stringify({ device_id: deviceId }) })).status).toBe(200);
  return { id: user.id, token };
}

describe('mobile push notifications', () => {
  it('parses device registrations from the official apps', () => {
    expect(parseDeviceId('android_rn-v2:synthetic-token')).toEqual({ platform: 'android_rn', token: 'synthetic-token', version: 'v2' });
    expect(parseDeviceId('apple:abc123')).toEqual({ platform: 'apple', token: 'abc123', version: '' });
    for (const invalid of ['', 'apple', 'apple:', 'windows:abc', ':abc']) expect(parseDeviceId(invalid), invalid).toBeNull();
  });

  it('is off without a push proxy', async () => {
    const server = await createTestServer();
    try {
      const token = await login(server);
      expect(await (await server.app.request('/api/v4/push/status', { headers: bearer(token) })).json()).toMatchObject({ enabled: false, transport: 'disabled' });
    } finally {
      await server.store.close();
    }
  });

  it('notifies offline members by preference, without message text by default, and drops removed devices', async () => {
    const proxy = await pushProxy((payload) => ({ status: payload.device_id === 'gone-token' ? 'REMOVE' : 'OK' }));
    const server = await createTestServer({ PUSH_NOTIFICATION_SERVER: proxy.url });
    try {
      const token = await login(server);
      const channelId = await firstChannelId(server.app, token);
      const bob = await mobileUser(server, channelId, 'bob', 'android_rn-v2:bob-token');
      const carol = await mobileUser(server, channelId, 'carol', 'apple_rn-v2:gone-token');
      expect(await (await server.app.request('/api/v4/push/status', { headers: bearer(token) })).json()).toMatchObject({ enabled: true, transport: 'push-proxy', contents: 'generic' });
      expect(await (await server.app.request('/api/v4/config/client?format=old', { headers: bearer(token) })).json()).toMatchObject({ SendPushNotifications: 'true' });

      const post = async (channel: string, message: string) => {
        const response = await server.app.request('/api/v4/posts', { method: 'POST', headers: bearer(token), body: JSON.stringify({ channel_id: channel, message }) });
        expect(response.status).toBe(201);
        await server.push.idle();
        return ((await response.json()) as { id: string }).id;
      };

      await post(channelId, 'no mention for anyone');
      expect(proxy.received).toHaveLength(0);

      const mentionId = await post(channelId, 'hello @bob');
      expect(proxy.received).toHaveLength(1);
      expect(proxy.received[0]?.path).toBe('/api/v1/send_push');
      expect(proxy.received[0]?.payload).toMatchObject({ platform: 'android_rn', device_id: 'bob-token', version: 'v2', type: 'message', post_id: mentionId, channel_id: channelId, sender_name: 'admin', message: '@admin sent a message' });
      expect(JSON.stringify(proxy.received[0]?.payload)).not.toContain('hello @bob');

      const direct = (await (await server.app.request('/api/v4/channels/direct', { method: 'POST', headers: bearer(token), body: JSON.stringify([server.services.users.findByUsername('admin')?.id, carol.id]) })).json()) as { id: string };
      await post(direct.id, 'a private note');
      expect(proxy.received.at(-1)?.payload).toMatchObject({ device_id: 'gone-token' });
      expect(server.store.read((state) => state.sessions.filter((session) => session.userId === carol.id).map((session) => session.deviceId))).toEqual(['']);

      // An open WebSocket means the user is looking at chat: no push.
      const connection = server.services.hub.attach({ send: () => undefined, close: () => undefined } as never, bob.id);
      const before = proxy.received.length;
      await post(channelId, 'again @bob');
      expect(proxy.received).toHaveLength(before);
      server.services.hub.detach(connection.id);

      await server.app.request(`/api/v4/channels/${channelId}/members/${bob.id}/notify_props`, { method: 'PUT', headers: bearer(bob.token), body: JSON.stringify({ push: 'none' }) });
      await post(channelId, 'muted @bob');
      expect(proxy.received).toHaveLength(before);
    } finally {
      await server.store.close();
    }
  });

  it('includes the message text only with PUSH_NOTIFICATION_CONTENTS=full', async () => {
    const proxy = await pushProxy(() => ({ status: 'OK' }));
    const server = await createTestServer({ PUSH_NOTIFICATION_SERVER: proxy.url, PUSH_NOTIFICATION_CONTENTS: 'full' });
    try {
      const token = await login(server);
      const channelId = await firstChannelId(server.app, token);
      await mobileUser(server, channelId, 'dave', 'apple:dave-token');
      await server.app.request('/api/v4/posts', { method: 'POST', headers: bearer(token), body: JSON.stringify({ channel_id: channelId, message: '@dave the build is green' }) });
      await server.push.idle();
      expect(proxy.received[0]?.payload).toMatchObject({ platform: 'apple', version: '', message: '@admin: @dave the build is green' });
    } finally {
      await server.store.close();
    }
  });
});
