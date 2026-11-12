import { expect, test } from '@playwright/test';
import NodeWebSocket from 'ws';

import {
  adminToken,
  createUserViaInvite,
  defaultChannelId,
  frameText,
  waitForFrame,
  websocketUrl
} from './helpers.js';

test('cookie WebSockets require an Origin; bearer clients can omit it', async ({ request }) => {
  const login = await request.post('/api/v4/users/login', {
    data: { login_id: 'admin', password: 'AdminChangeMe123!' }
  });
  expect(login.ok()).toBeTruthy();
  const cookie = login.headers()['set-cookie']?.split(';', 1)[0];
  const token = login.headers().token;
  expect(cookie).toBeTruthy();
  expect(token).toBeTruthy();
  const url = websocketUrl;

  async function firstFrame(
    headers: Record<string, string>,
    sendPing: boolean
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const socket = new NodeWebSocket(url, { headers });
      const timeout = setTimeout(() => {
        socket.terminate();
        reject(new Error('WebSocket frame timeout'));
      }, 5000);
      socket.once('open', () => {
        if (sendPing) socket.send(JSON.stringify({ action: 'ping', seq: 1, data: {} }));
      });
      socket.once('message', (data) => {
        clearTimeout(timeout);
        socket.close();
        const frame = Array.isArray(data)
          ? Buffer.concat(data).toString('utf8')
          : Buffer.from(data as ArrayBuffer).toString('utf8');
        resolve(JSON.parse(frame) as Record<string, unknown>);
      });
      socket.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  expect(await firstFrame({ Cookie: cookie ?? '' }, true)).toMatchObject({
    status: 'FAIL',
    seq_reply: 1
  });
  expect(await firstFrame({ Authorization: `Bearer ${token ?? ''}` }, false)).toMatchObject({
    event: 'hello'
  });
});

test('a second user receives typing, posts and reactions over WebSocket', async ({ request }) => {
  const token = await adminToken(request);
  const auth = { Authorization: `Bearer ${token}` };
  const channelId = await defaultChannelId(request, token);
  const admin = (await (await request.get('/api/v4/users/me', { headers: auth })).json()) as {
    id: string;
  };
  const username = `realtime-${Date.now()}`;
  const userToken = await createUserViaInvite(request, token, username);

  const typing = waitForFrame(
    userToken,
    (frame) => frame.event === 'typing' && frame.data?.user_id === admin.id
  );
  await typing.ready;
  const typed = await request.post(`/api/v4/users/${admin.id}/typing`, {
    headers: auth,
    data: { channel_id: channelId }
  });
  expect(typed.ok(), await typed.text()).toBeTruthy();
  expect((await typing.frame).data).toMatchObject({ channel_id: channelId });

  const marker = `Live message ${Date.now()}`;
  const posted = waitForFrame(
    userToken,
    (frame) => frame.event === 'posted' && frameText(frame, 'post').includes(marker)
  );
  await posted.ready;
  const post = await request.post('/api/v4/posts', {
    headers: auth,
    data: { channel_id: channelId, message: marker }
  });
  expect(post.ok(), await post.text()).toBeTruthy();
  await posted.frame;
  const { id: postId } = (await post.json()) as { id: string };

  const reacted = waitForFrame(
    userToken,
    (frame) => frame.event === 'reaction_added' && frameText(frame, 'reaction').includes(postId)
  );
  await reacted.ready;
  const reaction = await request.post('/api/v4/reactions', {
    headers: auth,
    data: { user_id: admin.id, post_id: postId, emoji_name: 'slightly_smiling_face' }
  });
  expect(reaction.ok(), await reaction.text()).toBeTruthy();
  await reacted.frame;
});
