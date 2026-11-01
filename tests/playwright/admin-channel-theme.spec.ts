import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { adminToken, createUserViaInvite, enableAdminMode, loginAsAdmin } from './helpers.js';

type MattermostTeam = { id: string };
type MattermostChannel = { id: string; display_name: string };
type MattermostUser = { id: string; username: string };

test('admin mode is conversation-first, persisted, and explicitly reversible', async ({ page }) => {
  await loginAsAdmin(page);
  const toggle = page.getByRole('switch', { name: 'Admin mode' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('button', { name: 'Users' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Delete public channel/u })).toHaveCount(0);
  await expect(page.locator('.side-panel')).toBeHidden();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('button', { name: 'Users' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Delete public channel/u }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Admin mode' })).toHaveAttribute('aria-checked', 'true');

  await page.getByRole('switch', { name: 'Admin mode' }).click();
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Admin mode' })).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('button', { name: 'Users' })).toHaveCount(0);
});

test('non-admin cannot reveal admin mode through persisted client state', async ({ page, request }) => {
  const token = await adminToken(request);
  const username = `mode-user-${Date.now()}`;
  const userToken = await createUserViaInvite(request, token, username);
  const user = await currentUser(request, userToken);
  await page.addInitScript(({ id }) => localStorage.setItem(`chattermost-admin-mode:${id}`, '1'), { id: user.id });
  await page.goto('/login');
  await page.getByLabel('Username or email').fill(username);
  await page.getByLabel('Password').fill(`${username}Password123!`);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('post-list')).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Admin mode' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Users' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Delete public channel/u })).toHaveCount(0);
  await expect(page.getByText('null', { exact: true })).toHaveCount(0);
});

test('conversation inspector opens only on request and closes cleanly', async ({ page }) => {
  await loginAsAdmin(page);
  await expect(page.locator('.side-panel')).toBeHidden();
  await page.getByRole('button', { name: 'Members' }).click();
  await expect(page.getByRole('heading', { name: 'Channel members' })).toBeVisible();
  await page.getByRole('button', { name: 'Close panel' }).click();
  await expect(page.locator('.side-panel')).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
});

test('System console rail button opens privacy settings', async ({ page }) => {
  await loginAsAdmin(page);
  await enableAdminMode(page);
  await page.getByRole('button', { name: 'System', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'System console' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save settings' })).toBeVisible();
});

test('admin deletes active public channel and composer remains on fallback channel', async ({ page, request }) => {
  const token = await adminToken(request);
  const team = await firstTeam(request, token);
  const channelName = `Delete UI ${Date.now()}`;
  const created = await request.post('/api/v4/channels', {
    headers: { Authorization: `Bearer ${token}` },
    data: { team_id: team.id, name: `delete-ui-${Date.now()}`, display_name: channelName, type: 'O' }
  });
  expect(created.ok(), await created.text()).toBeTruthy();

  await loginAsAdmin(page);
  await enableAdminMode(page);
  await page.getByRole('button', { name: `#${channelName}`, exact: true }).click();
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain(`#${channelName}`);
    await dialog.accept();
  });
  await page.getByRole('button', { name: `Delete public channel ${channelName}` }).first().click();
  await expect(page.getByRole('button', { name: `#${channelName}`, exact: true })).toBeHidden();
  await expect(page.getByRole('heading', { name: `#${channelName}`, exact: true })).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Composer survived channel deletion');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByTestId('post-list').getByText('Composer survived channel deletion')).toBeVisible();
});

test('admin creates a private channel and adds a user from channel members', async ({ page, request }) => {
  const token = await adminToken(request);
  const team = await firstTeam(request, token);
  const username = `private-ui-${Date.now()}`;
  const userToken = await createUserViaInvite(request, token, username);
  const user = await currentUser(request, userToken);
  const channelName = `Private UI ${Date.now()}`;
  let channelId = '';

  try {
    await loginAsAdmin(page);
    await page.getByRole('button', { name: '+ Channel' }).click();
    await page.getByLabel('Channel name').fill(channelName);
    await page.getByLabel('Visibility').selectOption('Private');
    await page.getByRole('button', { name: 'Create channel' }).click();
    await page.getByRole('button', { name: `#${channelName}` }).click();
    await page.locator('header').getByRole('button', { name: 'Members' }).click();
    await expect(page.getByRole('heading', { name: 'Channel members' })).toBeVisible();
    await expect(page.getByText('Private channel: only listed members can read and post here.')).toBeVisible();

    const channel = await findChannel(request, token, team.id, channelName);
    channelId = channel.id;
    await page.getByRole('button', { name: `Add @${username}` }).click();
    await expect(
      page.locator('.panel-body .data-row').filter({ hasText: `@${username}` }).getByText('member')
    ).toBeVisible();

    const userChannels = await request.get(`/api/v4/users/me/teams/${team.id}/channels`, {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    expect(userChannels.ok()).toBeTruthy();
    expect(((await userChannels.json()) as MattermostChannel[]).some((item) => item.id === channelId)).toBe(true);
  } finally {
    if (channelId.length > 0) {
      await request.delete(`/api/v4/channels/${channelId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
    }
    await request.post(`/admin/users/${user.id}/deactivate`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }
});

test('theme toggle keeps key text readable in light and dark modes', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('chattermost-theme', 'light');
  });
  await loginAsAdmin(page);
  await page.getByRole('button', { name: 'Members' }).click();
  await expect(page.locator('body')).toHaveClass(/theme-light/u);
  await expectReadableText(page);

  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('body')).toHaveClass(/theme-dark/u);
  await expectReadableText(page);

  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('body')).toHaveClass(/theme-light/u);
  await expectReadableText(page);
});

test('admin manages user lifecycle from the Users panel', async ({ page, request }) => {
  const token = await adminToken(request);
  const username = `lifecycle-ui-${Date.now()}`;
  await createUserViaInvite(request, token, username);

  await loginAsAdmin(page);
  await enableAdminMode(page);
  await page.getByRole('button', { name: 'Users' }).click();
  const row = page.locator('.admin-user-card').filter({ hasText: `@${username}` });
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: 'Reset password' }).click();
  await page.getByLabel(`New password for @${username}`).fill('LifecycleUiPassword123!');
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page.getByText(`Password reset for @${username}.`)).toBeVisible();

  await row.getByRole('button', { name: 'Deactivate' }).click();
  await expect(page.getByText(`@${username} deactivated.`)).toBeVisible();
  await expect(row.getByText('deactivated')).toBeVisible();

  await row.getByRole('button', { name: 'Reactivate' }).click();
  await expect(page.getByText(`@${username} reactivated.`)).toBeVisible();
  await expect(row.getByRole('button', { name: 'Deactivate' })).toBeVisible();
});

test('admin creates and edits users from the Admin modal', async ({ page }) => {
  const username = `modal-ui-${Date.now()}`;

  await loginAsAdmin(page);
  await enableAdminMode(page);
  await page.getByRole('button', { name: 'Users' }).click();
  await expect(page.getByRole('heading', { name: 'Admin', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New user' }).click();
  await page.getByRole('textbox', { name: 'Username' }).fill(username);
  await page.getByRole('textbox', { name: 'Email' }).fill(`${username}@example.test`);
  await page.getByLabel('Password').fill('ModalUserPassword123!');
  await page.getByRole('textbox', { name: 'First name' }).fill('Modal');
  await page.getByRole('textbox', { name: 'Last name' }).fill('User');
  await page.getByRole('button', { name: 'Create user' }).click();
  await expect(page.getByText('User created.')).toBeVisible();

  const row = page.locator('.admin-user-card').filter({ hasText: `@${username}` });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('textbox', { name: 'Position' }).fill('QA Operator');
  await page.getByRole('button', { name: 'Save user' }).click();
  await expect(page.getByText('User saved.')).toBeVisible();

  await row.getByRole('button', { name: 'Deactivate' }).click();
  await expect(page.getByText(`@${username} deactivated.`)).toBeVisible();
});

test('channel policy and Hermes health panels are wired', async ({ page, request }) => {
  const token = await adminToken(request);
  const team = await firstTeam(request, token);
  const channelName = `Policy UI ${Date.now()}`;
  const created = await request.post('/api/v4/channels', {
    headers: { Authorization: `Bearer ${token}` },
    data: { team_id: team.id, name: `policy-ui-${Date.now()}`, display_name: channelName, type: 'O' }
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const policyChannel = (await created.json()) as MattermostChannel;
  const seededPost = await request.post('/api/v4/posts', {
    headers: { Authorization: `Bearer ${token}` },
    data: { channel_id: policyChannel.id, message: 'Policy test fixture' }
  });
  expect(seededPost.ok(), await seededPost.text()).toBeTruthy();
  await loginAsAdmin(page);
  await enableAdminMode(page);
  await page.getByRole('button', { name: `#${channelName}`, exact: true }).click();
  await expect(page.getByRole('heading', { name: `#${channelName}`, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Members', exact: true }).click();
  await page.getByRole('button', { name: 'Policy', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Channel policy' })).toBeVisible();
  await page.getByLabel('Require @mention').check();
  await page.getByLabel('Allowed agent usernames').fill('hermes');
  await page.getByRole('button', { name: 'Save policy' }).click();
  await expect(page.getByText('Policy saved.')).toBeVisible();

  const channels = await request.get('/api/v4/users/me/channels', {
    headers: { Authorization: `Bearer ${token}` }
  });
  expect(channels.ok()).toBeTruthy();
  expect(policyChannel.id).toHaveLength(26);
  const policy = await request.get(`/api/v4/channels/${policyChannel.id}/agent-policy`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  expect((await policy.json()) as Record<string, unknown>).toMatchObject({
    mention_required: true,
    allowed_agents: ['hermes']
  });

  await page.getByRole('button', { name: 'Hermes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hermes health' })).toBeVisible();
  await expect(page.locator('.metric-tile').filter({ hasText: 'Bot token' })).toContainText('Configured');
});

test('admin adds custom emoji and uses it in the picker', async ({ page }) => {
  await loginAsAdmin(page);
  await enableAdminMode(page);
  await page.getByRole('button', { name: 'System', exact: true }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(`ship_${Date.now()}`);
  await page.getByRole('textbox', { name: 'Emoji', exact: true }).fill('🚢');
  await page.getByRole('button', { name: 'Add emoji' }).click();
  await expect(page.getByText('Custom emoji added.')).toBeVisible();

  await page.getByRole('button', { name: 'Emoji', exact: true }).click();
  await page.getByRole('button', { name: /Add emoji ship_/u }).click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('🚢');
});

async function firstTeam(request: APIRequestContext, token: string): Promise<MattermostTeam> {
  const response = await request.get('/api/v4/users/me/teams', {
    headers: { Authorization: `Bearer ${token}` }
  });
  expect(response.ok()).toBeTruthy();
  const team = ((await response.json()) as MattermostTeam[])[0];
  if (team === undefined) {
    throw new Error('missing team');
  }
  return team;
}

async function currentUser(request: APIRequestContext, token: string): Promise<MattermostUser> {
  const response = await request.get('/api/v4/users/me', {
    headers: { Authorization: `Bearer ${token}` }
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as MattermostUser;
}

async function findChannel(
  request: APIRequestContext,
  token: string,
  teamId: string,
  displayName: string
): Promise<MattermostChannel> {
  const response = await request.get(`/api/v4/users/me/teams/${teamId}/channels`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  expect(response.ok()).toBeTruthy();
  const channel = ((await response.json()) as MattermostChannel[]).find(
    (item) => item.display_name === displayName
  );
  if (channel === undefined) {
    throw new Error('missing created channel');
  }
  return channel;
}

async function expectReadableText(page: Page): Promise<void> {
  for (const selector of ['.chat-header h2', '.chat-header p', '.panel-tabs button.active']) {
    await page.locator(selector).first().waitFor({ state: 'visible' });
    // Poll the measurement so a transient mid-render/theme-transition state
    // (where the computed color is not yet resolvable) does not flake the run.
    await expect.poll(async () => contrastRatio(page, selector), { message: selector }).toBeGreaterThanOrEqual(4.5);
  }
}

async function contrastRatio(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((element: Element): number => {
    const parseRgb = (value: string): [number, number, number, number] | null => {
      const rgbMatch = /rgba?\(([^)]+)\)/u.exec(value);
      if (rgbMatch !== null && rgbMatch[1] !== undefined) {
        const parts = rgbMatch[1]
          .replaceAll('/', ' ')
          .split(/[,\s]+/u)
          .filter(Boolean)
          .map((part) => Number.parseFloat(part.trim()));
        const red = parts[0];
        const green = parts[1];
        const blue = parts[2];
        if (red === undefined || green === undefined || blue === undefined) return null;
        return [red, green, blue, parts[3] ?? 1];
      }
      const srgbMatch = /color\(srgb\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)(?:\s*\/\s*([0-9.]+))?\)/u.exec(value);
      if (srgbMatch !== null) {
        const red = Number.parseFloat(srgbMatch[1] ?? '0') * 255;
        const green = Number.parseFloat(srgbMatch[2] ?? '0') * 255;
        const blue = Number.parseFloat(srgbMatch[3] ?? '0') * 255;
        const alpha = Number.parseFloat(srgbMatch[4] ?? '1');
        return [red, green, blue, alpha];
      }
      return null;
    };
    const resolvedBackground = (): [number, number, number, number] => {
      let current: Element | null = element;
      while (current !== null) {
        const candidate = parseRgb(window.getComputedStyle(current).backgroundColor);
        if (candidate !== null && candidate[3] > 0) {
          return candidate;
        }
        current = current.parentElement;
      }
      return parseRgb(window.getComputedStyle(document.body).backgroundColor) ?? [255, 255, 255, 1];
    };
    const luminance = ([red, green, blue]: [number, number, number]): number => {
      const channels = [red, green, blue].map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928
          ? normalized / 12.92
          : Math.pow((normalized + 0.055) / 1.055, 2.4);
      });
      return (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722;
    };
    const text = parseRgb(window.getComputedStyle(element).color);
    if (text === null) return 0;
    const base = resolvedBackground();
    const lighter = Math.max(luminance([text[0], text[1], text[2]]), luminance([base[0], base[1], base[2]]));
    const darker = Math.min(luminance([text[0], text[1], text[2]]), luminance([base[0], base[1], base[2]]));
    return (lighter + 0.05) / (darker + 0.05);
  });
}
