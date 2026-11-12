import { expect, test } from '@playwright/test';

import { waitForFrame } from './helpers.js';

// The standalone web UI is retired. The official Mattermost apps still depend on
// these endpoints, so this smoke test runs against the real server process.
test('official app smoke path: ping, login and WebSocket', async ({ request }) => {
  const ping = await request.get('/api/v4/system/ping');
  expect(ping.ok()).toBeTruthy();
  expect((await ping.json()) as Record<string, unknown>).toMatchObject({
    status: 'OK',
    websocket_status: 'OK'
  });

  const mobile = { 'User-Agent': 'Mattermost/2.27 Mobile' };
  expect(
    (
      await request.post('/api/v4/users/login/type', {
        headers: mobile,
        data: { login_id: 'admin' }
      })
    ).ok()
  ).toBeTruthy();
  expect((await request.get('/api/v4/config/client')).ok()).toBeTruthy();
  expect((await request.get('/api/v4/license/client?format=old')).ok()).toBeTruthy();

  const login = await request.post('/api/v4/users/login', {
    headers: mobile,
    data: { login_id: 'admin', password: 'AdminChangeMe123!' }
  });
  expect(login.ok(), await login.text()).toBeTruthy();
  const token = login.headers().token;
  expect(token).toBeTruthy();
  const me = await request.get('/api/v4/users/me', {
    headers: { Authorization: `Bearer ${token ?? ''}` }
  });
  expect((await me.json()) as { username: string }).toMatchObject({ username: 'admin' });

  const hello = waitForFrame(token ?? '', (frame) => frame.event === 'hello');
  expect((await hello.frame).event).toBe('hello');
});

test('retired web UI paths serve the HiveXUI notice', async ({ request }) => {
  for (const path of ['/', '/login', '/signup', '/admin/system-console']) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(200);
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(await response.text()).toContain('<h1>ChatterMost is managed in HiveXUI</h1>');
  }
  expect((await request.get('/assets/app.js')).status()).toBe(404);
});
