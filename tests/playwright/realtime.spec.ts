import { expect, test } from '@playwright/test';
import NodeWebSocket from 'ws';

import { adminToken, createUserViaInvite, loginAsAdmin } from './helpers.js';

test('cookie WebSockets require an Origin; bearer clients can omit it', async ({ request }) => {
  const login = await request.post('/api/v4/users/login', {
    data: { login_id: 'admin', password: 'AdminChangeMe123!' }
  });
  expect(login.ok()).toBeTruthy();
  const cookie = login.headers()['set-cookie']?.split(';', 1)[0];
  const token = login.headers().token;
  expect(cookie).toBeTruthy();
  expect(token).toBeTruthy();
  const url = 'ws://127.0.0.1:8097/api/v4/websocket';

  async function firstFrame(headers: Record<string, string>, sendPing: boolean): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const socket = new NodeWebSocket(url, { headers });
      const timeout = setTimeout(() => { socket.terminate(); reject(new Error('WebSocket frame timeout')); }, 5000);
      socket.once('open', () => {
        if (sendPing) socket.send(JSON.stringify({ action: 'ping', seq: 1, data: {} }));
      });
      socket.once('message', (data) => {
        clearTimeout(timeout);
        socket.close();
        const frame = Array.isArray(data) ? Buffer.concat(data).toString('utf8') : Buffer.from(data as ArrayBuffer).toString('utf8');
        resolve(JSON.parse(frame) as Record<string, unknown>);
      });
      socket.once('error', (error) => { clearTimeout(timeout); reject(error); });
    });
  }

  expect(await firstFrame({ Cookie: cookie ?? '' }, true)).toMatchObject({ status: 'FAIL', seq_reply: 1 });
  expect(await firstFrame({ Authorization: `Bearer ${token ?? ''}` }, false)).toMatchObject({ event: 'hello' });
});

test('two browser contexts receive posts, reactions, and typing over WebSocket', async ({ browser, request }) => {
  const token = await adminToken(request);
  const username = `realtime-${Date.now()}`;
  await createUserViaInvite(request, token, username);

  const adminContext = await browser.newContext();
  const userContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const userPage = await userContext.newPage();

  await loginAsAdmin(adminPage);
  await userPage.goto('/login');
  await userPage.getByLabel('Username or email').fill(username);
  await userPage.getByLabel('Password').fill(`${username}Password123!`);
  await userPage.getByRole('button', { name: 'Sign in' }).click();
  await expect(userPage.getByTestId('post-list')).toBeVisible();

  const typingSeen = userPage.evaluate(() => new Promise<string>((resolve) => {
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/v4/websocket`);
    socket.addEventListener('message', (event) => {
      const frame = JSON.parse(String(event.data)) as { event?: string };
      if (frame.event === 'typing') {
        socket.close();
        resolve('typing');
      }
    });
  }));

  await userPage.waitForTimeout(500);
  await adminPage.getByLabel('Message').fill('Live message');
  expect(await typingSeen).toBe('typing');
  await adminPage.getByRole('button', { name: 'Send' }).click();
  const livePost = userPage.getByTestId('post').filter({ hasText: 'Live message' });
  await expect(livePost).toBeVisible();

  await livePost.hover();
  await livePost.getByRole('button', { name: '+ 🙂' }).click();
  await expect(adminPage.getByRole('button', { name: /🙂 reaction 1/u })).toBeVisible();

  await adminContext.close();
  await userContext.close();
});

test('mobile-style login and WebSocket smoke path works', async ({ browser, request }) => {
  const loginType = await request.post('/api/v4/users/login/type', {
    headers: { 'User-Agent': 'Mattermost/2.27 Mobile' },
    data: { login_id: 'admin' }
  });
  expect(loginType.ok()).toBeTruthy();
  expect((await request.get('/api/v4/config/client')).ok()).toBeTruthy();
  expect((await request.get('/api/v4/license/client?format=old')).ok()).toBeTruthy();
  expect((await request.get('/api/v4/system/ping')).ok()).toBeTruthy();

  const context = await browser.newContext({ userAgent: 'Mattermost/2.27 Mobile' });
  const page = await context.newPage();
  await loginAsAdmin(page);
  const hello = await page.evaluate(() => new Promise<string>((resolve) => {
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/v4/websocket`);
    socket.addEventListener('message', (event) => {
      const frame = JSON.parse(String(event.data)) as { event?: string };
      if (frame.event === 'hello') {
        socket.close();
        resolve('hello');
      }
    });
  }));
  expect(hello).toBe('hello');
  await context.close();
});
