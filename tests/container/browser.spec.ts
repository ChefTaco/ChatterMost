import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import NodeWebSocket from 'ws';
import { parse } from 'dotenv';
import { z } from 'zod';

const root = process.env.CHATTERMOST_CONTAINER_TEST_ROOT;
if (!root) throw new Error('A disposable synthetic container installation is required');
const installation = z
  .object({ port: z.number().int(), server_url: z.string() })
  .parse(JSON.parse(readFileSync(path.join(root, 'installation.json'), 'utf8')) as unknown);
if (!installation.server_url.startsWith('http://127.0.0.1:')) {
  throw new Error('Container browser proof is restricted to synthetic loopback installations');
}
const credentials = z
  .object({ ADMIN_USERNAME: z.string(), ADMIN_PASSWORD: z.string() })
  .parse(parse(readFileSync(path.join(root, 'secrets/runtime.env'))));
const fixture = z
  .object({ admin_id: z.string(), channel_id: z.string(), post_id: z.string() })
  .parse(JSON.parse(readFileSync(path.join(root, 'synthetic-fixture.json'), 'utf8')) as unknown);
const origin = `http://127.0.0.1:${installation.port}`;

// The standalone web UI is retired (HiveXUI is the UI). This proof drives the same
// HTTP login and bearer WebSocket path that the official Mattermost apps use.
test('published container keeps login, retained attachments and live WebSocket delivery after recovery', async ({
  request
}) => {
  const login = await request.post(`${origin}/api/v4/users/login`, {
    data: { login_id: credentials.ADMIN_USERNAME, password: credentials.ADMIN_PASSWORD }
  });
  expect(login.ok()).toBeTruthy();
  const token = login.headers().token;
  if (!token) throw new Error('Login did not return a session token');
  const headers = { Authorization: `Bearer ${token}` };
  const me = z
    .object({ id: z.string() })
    .parse(await (await request.get(`${origin}/api/v4/users/me`, { headers })).json());
  expect(me.id).toBe(fixture.admin_id);
  const channel = await request.get(`${origin}/api/v4/channels/${fixture.channel_id}`, { headers });
  expect(channel.ok()).toBeTruthy();
  const retained = z
    .object({ message: z.string(), file_ids: z.array(z.string()) })
    .parse(
      await (await request.get(`${origin}/api/v4/posts/${fixture.post_id}`, { headers })).json()
    );
  expect(retained.message).toContain('Synthetic distribution persistence proof');
  const names = await Promise.all(
    retained.file_ids.map(
      async (id) =>
        z
          .object({ name: z.string() })
          .parse(await (await request.get(`${origin}/api/v4/files/${id}/info`, { headers })).json())
          .name
    )
  );
  expect(names).toContain('synthetic.txt');

  const marker = `Synthetic WebSocket proof ${Date.now()}`;
  const socket = new NodeWebSocket(`ws://127.0.0.1:${installation.port}/api/v4/websocket`, {
    headers
  });
  let markReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });
  const delivered = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error('WebSocket delivery timeout'));
    }, 15_000);
    socket.on('message', (data) => {
      const text = Array.isArray(data)
        ? Buffer.concat(data).toString('utf8')
        : Buffer.from(data as ArrayBuffer).toString('utf8');
      const frame = JSON.parse(text) as { event?: string; data?: { post?: unknown } };
      if (frame.event === 'hello') markReady();
      if (
        frame.event === 'posted' &&
        typeof frame.data?.post === 'string' &&
        frame.data.post.includes(marker)
      ) {
        clearTimeout(timeout);
        socket.close();
        resolve();
      }
    });
    socket.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
  await Promise.race([ready, delivered]);
  const posted = await request.post(`${origin}/api/v4/posts`, {
    headers,
    data: { channel_id: fixture.channel_id, message: marker }
  });
  expect(posted.ok()).toBeTruthy();
  await delivered;
});
