import { expect, type APIRequestContext, type Page } from '@playwright/test';

// A real browser always attaches an Origin header on same-origin writes. The
// API request fixture accumulates the session cookie across calls, so setup
// requests that authenticate by cookie must present a same-origin Origin for
// the server's CSRF protection to accept them, exactly as the Web UI does.
const webOrigin = 'http://127.0.0.1:8097';

export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username or email').fill('admin');
  await page.getByLabel('Password').fill('AdminChangeMe123!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('post-list')).toBeVisible();
}

export async function enableAdminMode(page: Page): Promise<void> {
  const toggle = page.getByRole('switch', { name: 'Admin mode' });
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-checked')) !== 'true') {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
}

export async function adminToken(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/v4/users/login', {
    headers: { Origin: webOrigin },
    data: { login_id: 'admin', password: 'AdminChangeMe123!' }
  });
  expect(response.ok()).toBeTruthy();
  const token = response.headers().token;
  if (token === undefined) {
    throw new Error('missing admin token');
  }
  return token;
}

export async function defaultChannelId(request: APIRequestContext, token: string): Promise<string> {
  const teams = await request.get('/api/v4/users/me/teams', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const teamBody = (await teams.json()) as { id: string }[];
  const team = teamBody[0];
  if (team === undefined) {
    throw new Error('missing default team');
  }
  const channels = await request.get(`/api/v4/users/me/teams/${team.id}/channels`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const channelBody = (await channels.json()) as { id: string }[];
  const channel = channelBody[0];
  if (channel === undefined) {
    throw new Error('missing default channel');
  }
  return channel.id;
}

export async function createInvite(request: APIRequestContext, token: string): Promise<string> {
  const response = await request.post('/admin/invites', {
    headers: { Authorization: `Bearer ${token}` },
    data: { max_uses: 1, expires_in_hours: 24 }
  });
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { code: string };
  return body.code;
}

export async function createUserViaInvite(
  request: APIRequestContext,
  token: string,
  username: string
): Promise<string> {
  const invite = await createInvite(request, token);
  const response = await request.post('/api/v4/users', {
    headers: { Origin: webOrigin },
    data: {
      invite_code: invite,
      username,
      email: `${username}@example.test`,
      password: `${username}Password123!`
    }
  });
  expect(response.ok()).toBeTruthy();
  const login = await request.post('/api/v4/users/login', {
    headers: { Origin: webOrigin },
    data: { login_id: username, password: `${username}Password123!` }
  });
  const userToken = login.headers().token;
  if (userToken === undefined) {
    throw new Error('missing user token');
  }
  return userToken;
}
