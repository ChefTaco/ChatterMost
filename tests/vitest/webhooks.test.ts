import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { isNonPublicAddress, matchTrigger } from '../../src/server/webhooks.js';
import { bearer, createTestServer, firstChannelId, login, type TestServer } from './helpers.js';

type Captured = { headers: IncomingMessage['headers']; body: string };

const receivers: Server[] = [];

afterEach(async () => {
  await Promise.all(receivers.splice(0).map((receiver) => new Promise((resolve) => receiver.close(resolve))));
});

async function receiver(reply: (body: string) => { status: number; body: string }): Promise<{ url: string; captured: Captured[] }> {
  const captured: Captured[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      captured.push({ headers: request.headers, body });
      const answer = reply(body);
      response.writeHead(answer.status, { 'content-type': 'application/json' });
      response.end(answer.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  receivers.push(server);
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`, captured };
}

async function createMember(server: TestServer, username: string): Promise<string> {
  await server.services.users.createUser({ username, email: `${username}@example.test`, password: 'SyntheticPassword123!', role: 'system_user', actorUserId: null });
  const login = await server.app.request('/api/v4/users/login', { method: 'POST', headers: server.baseHeaders, body: JSON.stringify({ login_id: username, password: 'SyntheticPassword123!' }) });
  expect(login.status).toBe(200);
  return login.headers.get('Token') ?? '';
}

function auditActions(server: TestServer): string[] {
  return server.store.read((state) => state.auditLogs.map((entry) => entry.action));
}

describe('incoming webhook lifecycle', () => {
  it('lists, disables, rotates and deletes incoming webhooks with audit records', async () => {
    const server = await createTestServer();
    try {
      const token = await login(server);
      const channelId = await firstChannelId(server.app, token);

      const missing = await server.app.request('/api/v4/webhooks/incoming', { method: 'POST', headers: bearer(token), body: JSON.stringify({ channel_id: 'nosuchchannel000000000000a', label: 'x' }) });
      expect(missing.status).toBe(404);

      const created = (await (await server.app.request('/api/v4/webhooks/incoming', { method: 'POST', headers: bearer(token), body: JSON.stringify({ channel_id: channelId, label: 'Builds' }) })).json()) as { id: string; secret: string; url: string };
      const deliver = (secret: string) => server.app.request(`/api/v4/webhooks/incoming/${created.id}/${secret}`, { method: 'POST', headers: server.baseHeaders, body: JSON.stringify({ text: 'build passed' }) });
      expect((await deliver(created.secret)).status).toBe(200);

      const listed = (await (await server.app.request('/api/v4/webhooks/incoming', { headers: bearer(token) })).json()) as Record<string, unknown>[];
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ id: created.id, channel_id: channelId, label: 'Builds', enabled: true });
      expect(listed[0]).not.toHaveProperty('secret');
      expect(JSON.stringify(listed)).not.toContain(created.secret);

      const disabled = await server.app.request(`/api/v4/webhooks/incoming/${created.id}`, { method: 'PATCH', headers: bearer(token), body: JSON.stringify({ enabled: false, label: 'Builds (paused)' }) });
      expect(await disabled.json()).toMatchObject({ enabled: false, label: 'Builds (paused)' });
      expect((await deliver(created.secret)).status).toBe(404);
      await server.app.request(`/api/v4/webhooks/incoming/${created.id}`, { method: 'PATCH', headers: bearer(token), body: JSON.stringify({ enabled: true }) });

      const rotated = (await (await server.app.request(`/api/v4/webhooks/incoming/${created.id}/secret`, { method: 'PUT', headers: bearer(token) })).json()) as { secret: string; url: string };
      expect(rotated.secret).not.toBe(created.secret);
      expect(rotated.url).toContain(rotated.secret);
      expect((await deliver(created.secret)).status).toBe(404);
      expect((await deliver(rotated.secret)).status).toBe(200);

      expect((await server.app.request(`/api/v4/webhooks/incoming/${created.id}`, { method: 'DELETE', headers: bearer(token) })).status).toBe(200);
      expect((await deliver(rotated.secret)).status).toBe(404);
      expect((await server.app.request(`/api/v4/webhooks/incoming/${created.id}`, { headers: bearer(token) })).status).toBe(404);
      expect(auditActions(server)).toEqual(expect.arrayContaining(['webhook.incoming.created', 'webhook.incoming.updated', 'webhook.incoming.rotated', 'webhook.incoming.deleted']));
    } finally {
      await server.store.close();
    }
  });

  it('keeps webhook management to administrators and refuses archived channels', async () => {
    const server = await createTestServer();
    try {
      const token = await login(server);
      const memberToken = await createMember(server, 'webhookmember');
      expect((await server.app.request('/api/v4/webhooks/incoming', { headers: bearer(memberToken) })).status).toBe(403);
      expect((await server.app.request('/api/v4/hooks/outgoing', { headers: bearer(memberToken) })).status).toBe(403);

      const team = server.store.read((state) => state.teams[0]);
      const archived = (await (await server.app.request('/api/v4/channels', { method: 'POST', headers: bearer(token), body: JSON.stringify({ team_id: team?.id, name: 'to-archive', display_name: 'To archive', type: 'O' }) })).json()) as { id: string };
      await server.app.request(`/api/v4/channels/${archived.id}`, { method: 'DELETE', headers: bearer(token) });
      const refused = await server.app.request('/api/v4/webhooks/incoming', { method: 'POST', headers: bearer(token), body: JSON.stringify({ channel_id: archived.id }) });
      expect(refused.status).toBeGreaterThanOrEqual(400);
      expect(server.store.read((state) => state.incomingWebhooks.length)).toBe(0);
    } finally {
      await server.store.close();
    }
  });
});

describe('outgoing webhooks', () => {
  it('is disabled unless ENABLE_OUTGOING_WEBHOOKS is set', async () => {
    const server = await createTestServer();
    try {
      const token = await login(server);
      const team = server.store.read((state) => state.teams[0]);
      const response = await server.app.request('/api/v4/hooks/outgoing', { method: 'POST', headers: bearer(token), body: JSON.stringify({ team_id: team?.id, display_name: 'Bot', trigger_words: ['!ping'], callback_urls: ['https://hooks.example.test/x'] }) });
      expect(response.status).toBe(403);
    } finally {
      await server.store.close();
    }
  });

  it('sends matching posts to the callback, posts the reply in the thread and does not loop', async () => {
    const hook = await receiver(() => ({ status: 200, body: JSON.stringify({ text: 'pong', response_type: 'comment' }) }));
    const server = await createTestServer({ ENABLE_OUTGOING_WEBHOOKS: 'true', OUTGOING_WEBHOOK_ALLOWED_HOSTS: '127.0.0.1' });
    try {
      const token = await login(server);
      const channelId = await firstChannelId(server.app, token);
      const channel = server.store.read((state) => state.channels.find((candidate) => candidate.id === channelId));
      expect(channel?.type).toBe('O');
      const created = await server.app.request('/api/v4/hooks/outgoing', { method: 'POST', headers: bearer(token), body: JSON.stringify({ team_id: channel?.teamId, display_name: 'Ping bot', trigger_words: ['!ping'], callback_urls: [hook.url] }) });
      expect(created.status).toBe(201);
      const record = (await created.json()) as { id: string; token: string };
      expect(record.token.length).toBeGreaterThan(20);
      const fetched = (await (await server.app.request(`/api/v4/hooks/outgoing/${record.id}`, { headers: bearer(token) })).json()) as Record<string, unknown>;
      expect(fetched).not.toHaveProperty('token');

      const send = async (message: string) => {
        const response = await server.app.request('/api/v4/posts', { method: 'POST', headers: bearer(token), body: JSON.stringify({ channel_id: channelId, message }) });
        expect(response.status).toBe(201);
        await server.webhooks.outgoing.idle();
        return (await response.json()) as { id: string };
      };
      await send('no trigger here !ping');
      expect(hook.captured).toHaveLength(0);
      const trigger = await send('!ping are you there');
      await server.webhooks.outgoing.idle();
      expect(hook.captured).toHaveLength(1);
      const payload = JSON.parse(hook.captured[0]?.body ?? '{}') as Record<string, unknown>;
      expect(payload).toMatchObject({ token: record.token, channel_id: channelId, post_id: trigger.id, text: '!ping are you there', trigger_word: '!ping', user_name: 'admin' });
      expect(hook.captured[0]?.headers['content-type']).toBe('application/json');

      const reply = server.store.read((state) => state.posts.find((post) => post.message === 'pong'));
      expect(reply).toMatchObject({ rootId: trigger.id, props: { from_webhook: 'true', webhook_id: record.id, webhook_label: 'Ping bot' } });
      expect(hook.captured).toHaveLength(1);

      const regenerated = (await (await server.app.request(`/api/v4/hooks/outgoing/${record.id}/regen_token`, { method: 'POST', headers: bearer(token) })).json()) as { token: string };
      expect(regenerated.token).not.toBe(record.token);
      await server.app.request(`/api/v4/hooks/outgoing/${record.id}`, { method: 'PUT', headers: bearer(token), body: JSON.stringify({ content_type: 'application/x-www-form-urlencoded' }) });
      await send('!ping again');
      expect(new URLSearchParams(hook.captured[1]?.body ?? '').get('token')).toBe(regenerated.token);

      await server.app.request(`/api/v4/hooks/outgoing/${record.id}`, { method: 'PUT', headers: bearer(token), body: JSON.stringify({ enabled: false }) });
      await send('!ping while disabled');
      expect(hook.captured).toHaveLength(2);
      expect((await server.app.request(`/api/v4/hooks/outgoing/${record.id}`, { method: 'DELETE', headers: bearer(token) })).status).toBe(200);
      expect(auditActions(server)).toEqual(expect.arrayContaining(['webhook.outgoing.created', 'webhook.outgoing.token_regenerated', 'webhook.outgoing.updated', 'webhook.outgoing.deleted']));
      expect(JSON.stringify(server.store.read((state) => state.auditLogs))).not.toContain(regenerated.token);
    } finally {
      await server.store.close();
    }
  });

  it('refuses callbacks to loopback and private addresses unless the host is allowed', async () => {
    const hook = await receiver(() => ({ status: 200, body: JSON.stringify({ text: 'should not appear' }) }));
    const server = await createTestServer({ ENABLE_OUTGOING_WEBHOOKS: 'true' });
    try {
      const token = await login(server);
      const channelId = await firstChannelId(server.app, token);
      const channel = server.store.read((state) => state.channels.find((candidate) => candidate.id === channelId));
      const created = await server.app.request('/api/v4/hooks/outgoing', { method: 'POST', headers: bearer(token), body: JSON.stringify({ team_id: channel?.teamId, channel_id: channelId, display_name: 'Local', callback_urls: [hook.url] }) });
      expect(created.status).toBe(201);
      const bad = await server.app.request('/api/v4/hooks/outgoing', { method: 'POST', headers: bearer(token), body: JSON.stringify({ team_id: channel?.teamId, display_name: 'Bad', trigger_words: ['x'], callback_urls: ['file:///etc/passwd'] }) });
      expect(bad.status).toBe(400);
      const withCredentials = await server.app.request('/api/v4/hooks/outgoing', { method: 'POST', headers: bearer(token), body: JSON.stringify({ team_id: channel?.teamId, display_name: 'Bad', trigger_words: ['x'], callback_urls: ['https://user:pass@hooks.example.test/'] }) });
      expect(withCredentials.status).toBe(400);
      await server.app.request('/api/v4/posts', { method: 'POST', headers: bearer(token), body: JSON.stringify({ channel_id: channelId, message: 'anything in this channel' }) });
      await server.webhooks.outgoing.idle();
      expect(hook.captured).toHaveLength(0);
      expect(server.store.read((state) => state.posts.some((post) => post.message === 'should not appear'))).toBe(false);
    } finally {
      await server.store.close();
    }
  });

  it('classifies non-public addresses and matches trigger words like the upstream server', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.16.5.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0']) expect(isNonPublicAddress(address, 4), address).toBe(true);
    for (const address of ['::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1']) expect(isNonPublicAddress(address, 6), address).toBe(true);
    expect(isNonPublicAddress('93.184.215.14', 4)).toBe(false);
    expect(isNonPublicAddress('2606:4700::1111', 6)).toBe(false);

    const exact = { triggerWords: ['!deploy'], triggerWhen: 0 as const, channelId: '' };
    expect(matchTrigger(exact, '!deploy now')).toBe('!deploy');
    expect(matchTrigger(exact, '!deployment now')).toBeNull();
    expect(matchTrigger(exact, 'please !deploy')).toBeNull();
    expect(matchTrigger({ ...exact, triggerWhen: 1 }, '!deployment now')).toBe('!deploy');
    expect(matchTrigger({ triggerWords: [], triggerWhen: 0, channelId: 'c' }, 'anything')).toBe('');
    expect(matchTrigger({ triggerWords: [], triggerWhen: 0, channelId: '' }, 'anything')).toBeNull();
  });
});
