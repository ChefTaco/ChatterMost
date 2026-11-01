import { expect, test } from '@playwright/test';

import { adminToken, createUserViaInvite, loginAsAdmin } from './helpers.js';

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
