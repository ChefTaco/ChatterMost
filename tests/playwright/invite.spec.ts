import { devices, expect, test } from '@playwright/test';

import { adminToken, createInvite, enableAdminMode, loginAsAdmin } from './helpers.js';

test('admin creates invite, user enrolls, and one-use invite cannot be reused', async ({ page }) => {
  await loginAsAdmin(page);
  await enableAdminMode(page);
  await page.getByRole('button', { name: 'Users' }).click();
  await page.getByRole('button', { name: 'Create one-use invite' }).click();
  const inviteText = await page.locator('.notice').filter({ hasText: 'Invite:' }).textContent();
  const invite = inviteText?.replace('Invite:', '').trim();
  expect(invite).toBeTruthy();

  const username = `invite-${Date.now()}`;
  await page.goto(`/signup?invite=${invite}`);
  await page.getByLabel('Email').fill(`${username}@example.test`);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(`${username}Password123!`);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByTestId('post-list')).toBeVisible();
  await expect(page.getByText('Welcome to ChatterMost')).toBeVisible();

  await page.goto(`/signup?invite=${invite}`);
  await page.getByLabel('Email').fill(`${username}-reuse@example.test`);
  await page.getByLabel('Username').fill(`${username}-reuse`);
  await page.getByLabel('Password').fill(`${username}Password456!`);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.locator('[data-error]')).toContainText('Invite code is invalid or expired');
});

test('invited user joins a public Test channel on desktop and iPhone', async ({ browser, page, request }) => {
  const token = await adminToken(request);
  const teams = await request.get('/api/v4/users/me/teams', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const team = ((await teams.json()) as { id: string }[])[0];
  if (team === undefined) {
    throw new Error('missing team');
  }
  const channelName = `Test ${Date.now()}`;
  const channelResponse = await request.post('/api/v4/channels', {
    headers: { Authorization: `Bearer ${token}` },
    data: { team_id: team.id, name: channelName.toLowerCase().replaceAll(' ', '-'), display_name: channelName, type: 'O' }
  });
  expect(channelResponse.ok()).toBeTruthy();

  const invite = await createInvite(request, token);
  const username = `testotron-${Date.now()}`;
  const password = `${username}Password123!`;
  await page.goto(`/signup?invite=${invite}`);
  await page.getByLabel('Email').fill(`${username}@example.test`);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByTestId('post-list')).toBeVisible();
  await expect(page.getByText('Welcome to ChatterMost')).toBeVisible();
  await expect(page.getByRole('button', { name: 'System', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: `+ #${channelName}` }).click();
  await expect(page.getByRole('heading', { name: `#${channelName}` })).toBeVisible();
  await page.getByLabel('Message').fill('Testotron desktop check-in');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Testotron desktop check-in')).toBeVisible();

  const mobileContext = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3
  });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto('/login');
  await mobilePage.getByLabel('Username or email').fill(username);
  await mobilePage.getByLabel('Password').fill(password);
  await mobilePage.getByRole('button', { name: 'Sign in' }).click();
  await expect(mobilePage.getByTestId('post-list')).toBeVisible();
  await expect(mobilePage.getByRole('button', { name: 'System', exact: true })).toHaveCount(0);
  await expect(mobilePage.locator('.composer')).toHaveCSS('position', 'fixed');
  await expect(mobilePage.locator('.file-picker [data-icon="paperclip"] svg')).toBeVisible();
  await expect(mobilePage.locator('.emoji-picker [data-icon="smile"] svg')).toBeVisible();
  await mobilePage.getByLabel('Channel').selectOption({ label: `#${channelName}` });
  await expect(mobilePage.getByRole('heading', { name: `#${channelName}` })).toBeVisible();
  await mobilePage.getByLabel('Message').fill('Testotron iPhone check-in ');
  await mobilePage.getByRole('button', { name: 'Emoji' }).click();
  await expect(mobilePage.getByRole('dialog', { name: 'Emoji picker' })).toBeVisible();
  expect(await mobilePage.locator('.emoji-choice').count()).toBeGreaterThanOrEqual(48);
  await mobilePage.getByRole('button', { name: 'Add emoji 👀' }).click();
  await expect(mobilePage.getByLabel('Message')).toHaveValue('Testotron iPhone check-in 👀');
  await mobilePage.getByRole('button', { name: 'Send' }).click();
  await expect(mobilePage.getByText('Testotron iPhone check-in 👀')).toBeVisible();
  await mobileContext.close();
});
