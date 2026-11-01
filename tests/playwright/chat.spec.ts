import { expect, test } from '@playwright/test';

import { adminToken, createUserViaInvite, defaultChannelId, loginAsAdmin } from './helpers.js';

test('marks webhook display overrides and reveals the authenticated owner', async ({ page, request }) => {
  const token = await adminToken(request);
  const channelId = await defaultChannelId(request, token);
  const createWebhook = await request.post('/api/v4/webhooks/incoming', {
    headers: { Authorization: `Bearer ${token}` },
    data: { channel_id: channelId, label: 'Build relay' }
  });
  expect(createWebhook.ok()).toBeTruthy();
  const webhook = (await createWebhook.json()) as { url: string };
  const marker = `Webhook identity ${Date.now()}`;
  const posted = await request.post(new URL(webhook.url).pathname, {
    headers: { Origin: 'http://127.0.0.1:8097' },
    data: { text: marker, username: 'Release Reporter' }
  });
  expect(posted.ok(), await posted.text()).toBeTruthy();

  await loginAsAdmin(page);
  const post = page.getByTestId('post').filter({ hasText: marker });
  await expect(post.getByText('Release Reporter', { exact: true })).toBeVisible();
  await expect(post.getByText('WEBHOOK', { exact: true })).toBeVisible();
  await post.getByText('Message details', { exact: true }).click();
  await expect(post.getByText('Webhook: Build relay · Owner: @admin', { exact: true })).toBeVisible();
});

test('create channel, post, edit, reply in thread, react, and delete', async ({ page }) => {
  await loginAsAdmin(page);
  const channelName = `Playwright ${Date.now()}`;
  await page.getByRole('button', { name: '+ Channel' }).click();
  await page.getByLabel('Channel name').fill(channelName);
  await page.getByLabel('Visibility').selectOption('Public');
  await page.getByRole('button', { name: 'Create channel' }).click();
  await expect(page.getByRole('button', { name: `#${channelName}`, exact: true })).toBeVisible();

  await page.getByLabel('Message').fill('Hello from Playwright');
  await page.getByRole('button', { name: 'Send' }).click();
  const post = page.getByTestId('post').filter({ hasText: 'Hello from Playwright' });
  await expect(post).toBeVisible();

  await post.hover();
  await post.getByRole('button', { name: 'Reply in thread' }).click();
  await page.getByPlaceholder('Reply in thread').fill('Thread reply from Playwright');
  await page.getByRole('button', { name: 'Reply' }).last().click();
  await expect(page.getByTestId('post-list').getByText('Thread reply from Playwright')).toBeVisible();

  await post.hover();
  await post.getByRole('button', { name: '+ 🙂' }).click();
  await expect(page.getByRole('button', { name: /🙂 reaction 1/u })).toBeVisible();
  await expect(page.getByText('slightly_smiling_face 1')).toBeHidden();

  await post.hover();
  await post.getByRole('button', { name: 'Pin' }).click();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Members' }).click();
  await page.getByRole('button', { name: 'Pinned' }).click();
  await expect(page.getByRole('heading', { name: 'Pinned messages' })).toBeVisible();
  await expect(page.locator('.pinned-row').filter({ hasText: 'Hello from Playwright' })).toBeVisible();

  await post.hover();
  await post.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Edit message').fill('Edited from Playwright');
  await page.getByRole('button', { name: 'Save edit' }).click();
  const editedPost = page.getByTestId('post').filter({ hasText: 'Edited from Playwright' });
  await expect(editedPost).toBeVisible();

  await editedPost.hover();
  await editedPost.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByTestId('post-list').getByText('Edited from Playwright')).toBeHidden();
});

test('start a direct message from the DM panel', async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole('button', { name: '+ DM' }).click();
  await expect(page.getByRole('heading', { name: 'Direct messages' })).toBeVisible();
  await page.getByLabel('Find people').fill('hermes');
  const hermesRow = page.locator('.dm-person').filter({ hasText: '@hermes' });
  await expect(hermesRow).toContainText('Bot account');
  await hermesRow.getByRole('button', { name: 'Message' }).click();
  await expect(page.getByRole('heading', { name: '@hermes' })).toBeVisible();

  await page.getByLabel('Message').fill('DM from Playwright');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByTestId('post-list').getByText('DM from Playwright')).toBeVisible();
  await expect(page.getByRole('button', { name: '@hermes' })).toBeVisible();
});

test('discover and execute Hermes commands in a bot DM', async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole('button', { name: '+ DM' }).click();
  await page.getByLabel('Find people').fill('hermes');
  const hermesRow = page.locator('.dm-person').filter({ hasText: '@hermes' });
  await hermesRow.getByRole('button', { name: /^(Message|Open)$/u }).click();
  await expect(page.getByRole('heading', { name: '@hermes' })).toBeVisible();
  const textbox = page.getByRole('textbox', { name: 'Message', exact: true });

  await textbox.fill('/res');
  const palette = page.getByRole('listbox', { name: 'Hermes commands' });
  await expect(palette).toBeVisible();
  await expect(palette.getByRole('option')).toHaveCount(2);
  await expect(palette).toContainText('/reset [now]');
  await expect(palette).toContainText('/resume [name]');
  await textbox.press('ArrowDown');
  await textbox.press('Tab');
  await expect(textbox).toHaveValue('/resume ');

  await textbox.fill('/sta');
  await expect(palette.getByRole('option')).toHaveCount(1);
  await page.evaluate(async () => {
    const channelId = document.querySelector('.channel-row.active')?.getAttribute('data-channel-id');
    if (!channelId) throw new Error('missing active channel');
    const response = await fetch('/api/v4/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_id: channelId, message: 'Realtime palette refresh' })
    });
    if (!response.ok) throw new Error('realtime post failed');
  });
  await expect(textbox).toHaveValue('/sta');
  await expect(palette).toBeVisible();
  await palette.getByRole('option').click();
  await expect(textbox).toHaveValue('/status');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByTestId('post-list').getByText('/status', { exact: true })).toBeVisible();
  await expect(textbox).toHaveValue('');
});

test('keeps a rejected slash command in a human DM for correction', async ({ page, request }) => {
  const token = await adminToken(request);
  const username = `human-command-${Date.now()}`;
  await createUserViaInvite(request, token, username);
  await loginAsAdmin(page);
  await page.getByRole('button', { name: '+ DM' }).click();
  await page.getByLabel('Find people').fill(username);
  const userRow = page.locator('.dm-person').filter({ hasText: '@' + username });
  await userRow.getByRole('button', { name: 'Message' }).click();
  await expect(page.getByRole('heading', { name: '@' + username })).toBeVisible();
  const textbox = page.getByRole('textbox', { name: 'Message', exact: true });
  await textbox.fill('/status');
  await expect(textbox).toHaveValue('/status');
  await expect(page.getByRole('listbox', { name: 'Hermes commands' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Slash commands are available only in conversations containing a bot')).toBeVisible();
  await expect(textbox).toHaveValue('/status');
});

test('composer Enter sends and Shift Enter keeps a newline', async ({ page }) => {
  await loginAsAdmin(page);
  const textbox = page.getByRole('textbox', { name: 'Message', exact: true });
  const enterMessage = `Enter send ${Date.now()}`;

  await textbox.fill(enterMessage);
  await textbox.press('Enter');
  await expect(page.getByTestId('post-list').getByText(enterMessage)).toBeVisible();
  await expect(textbox).toHaveValue('');

  await textbox.fill('First line');
  await textbox.press('Shift+Enter');
  await textbox.pressSequentially('Second line');
  await expect(textbox).toHaveValue('First line\nSecond line');
  await textbox.press('Enter');
  await expect(page.locator('.post-message').filter({ hasText: 'First line' }).last()).toHaveText('First line\nSecond line');
});

test('composer keeps its caret and Shift Enter across a live refresh', async ({ page, request }) => {
  await loginAsAdmin(page);
  const token = await adminToken(request);
  const channelId = await page.locator('.composer').getAttribute('data-channel-id');
  expect(channelId).toBeTruthy();
  const textbox = page.getByRole('textbox', { name: 'Message', exact: true });
  await textbox.fill('First lineSecond line');
  await textbox.evaluate((element) => {
    if (element instanceof HTMLTextAreaElement) element.setSelectionRange(10, 10);
  });
  await page.keyboard.down('Shift');
  const marker = `Live composer refresh ${Date.now()}`;
  const posted = await request.post('/api/v4/posts', {
    headers: { Authorization: `Bearer ${token}` },
    data: { channel_id: channelId, message: marker }
  });
  expect(posted.ok(), await posted.text()).toBeTruthy();
  await expect(page.getByTestId('post-list').getByText(marker)).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.up('Shift');
  await expect(textbox).toHaveValue('First line\nSecond line');
});

test('search messages and use the emoji picker', async ({ page }) => {
  await loginAsAdmin(page);
  const marker = `searchable-${Date.now()}`;
  await page.getByLabel('Message').fill(`A message with ${marker}`);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByTestId('post-list').getByText(marker)).toBeVisible();

  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByLabel('Search messages').fill(marker);
  await page.getByRole('button', { name: 'Search' }).last().click();
  await expect(page.locator('.search-result').filter({ hasText: marker })).toBeVisible();

  await page.getByRole('button', { name: 'Emoji' }).click();
  await page.getByRole('textbox', { name: 'Search', exact: true }).fill('rocket');
  await page.getByRole('button', { name: 'Add emoji 🚀' }).click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('🚀');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Launch approved 🚀');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByTestId('post-list').getByText('Launch approved 🚀')).toBeVisible();
});

test('mobile search stays above panels and returns results', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsAdmin(page);
  const marker = `mobile-search-${Date.now()}`;
  await page.getByLabel('Message').fill(`Panel-safe ${marker}`);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByTestId('post-list').getByText(marker)).toBeVisible();

  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByLabel('Search messages')).toBeVisible();
  await expect(page.getByLabel('Search messages')).toBeEnabled();
  await expect(
    page.getByLabel('Search messages').evaluate((input) => {
      const rect = input.getBoundingClientRect();
      const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return target === input || input.contains(target);
    })
  ).resolves.toBe(true);
  await page.getByLabel('Search messages').fill(marker);
  await page.getByRole('button', { name: 'Search' }).last().click();
  await expect(page.locator('.search-result').filter({ hasText: marker })).toBeVisible();
  await page.getByRole('button', { name: 'Members' }).click();
  await expect(page.getByRole('heading', { name: 'Channel members' })).toBeVisible();
});

test('gallery replaces chat pane and closes back to composer', async ({ page }) => {
  await loginAsAdmin(page);
  const marker = `gallery-${Date.now()}`;
  await page.locator('input[name="files"]').setInputFiles({
    name: `${marker}.png`,
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
      'base64'
    )
  });
  await expect(page.getByLabel('Selected attachments')).toContainText(`${marker}.png`);
  await page.getByLabel('Message').fill(`Image ${marker}`);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByTestId('post-list').getByText(`Image ${marker}`)).toBeVisible();

  await page.getByRole('button', { name: 'Gallery' }).click();
  await expect(page.getByTestId('channel-gallery')).toBeVisible();
  await expect(page.getByTestId('post-list')).toBeHidden();
  await expect(page.getByRole('link').filter({ hasText: `Image ${marker}` })).toBeVisible();
  await page.getByRole('button', { name: 'Close gallery' }).click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
});

test('long channel history starts at the latest 50 and can reveal older messages', async ({ page, request }) => {
  const token = await adminToken(request);
  const teams = await request.get('/api/v4/users/me/teams', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const team = ((await teams.json()) as { id: string }[])[0];
  if (team === undefined) throw new Error('missing team');
  const marker = `history-${Date.now()}`;
  const created = await request.post('/api/v4/channels', {
    headers: { Authorization: `Bearer ${token}` },
    data: { team_id: team.id, name: marker, display_name: `History ${Date.now()}`, type: 'O' }
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const channel = (await created.json()) as { id: string; display_name: string };
  for (let index = 1; index <= 55; index += 1) {
    const response = await request.post('/api/v4/posts', {
      headers: { Authorization: `Bearer ${token}` },
      data: { channel_id: channel.id, message: `${marker} message ${String(index).padStart(2, '0')}` }
    });
    expect(response.ok(), await response.text()).toBeTruthy();
  }

  await loginAsAdmin(page);
  await page.getByRole('button', { name: `#${channel.display_name}`, exact: true }).click();
  const postList = page.getByTestId('post-list');
  await expect(postList.getByText(`${marker} message 55`)).toBeVisible();
  await expect(postList.getByText(`${marker} message 06`)).toBeVisible();
  await expect(postList.getByText(`${marker} message 05`)).toBeHidden();
  await expect(postList.getByRole('button', { name: 'Load 50 older messages' })).toBeVisible();

  await postList.getByRole('button', { name: 'Load 50 older messages' }).click();
  await expect(postList.getByText(`${marker} message 01`)).toBeVisible();
  await expect(postList.getByRole('button', { name: 'Load 50 older messages' })).toBeHidden();

  await postList.evaluate((node) => {
    node.scrollTop = 0;
    node.dispatchEvent(new Event('scroll'));
  });
  const jump = page.getByRole('button', { name: 'Jump to latest' });
  await expect(jump).toBeVisible();
  await jump.click();
  await expect(jump).toBeHidden();
  await expect(postList.getByText(`${marker} message 55`)).toBeVisible();
});
