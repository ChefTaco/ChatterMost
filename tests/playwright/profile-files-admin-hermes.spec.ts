import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext
} from '@playwright/test';

import {
  adminToken,
  createUserViaInvite,
  defaultChannelId,
  enableAdminMode,
  loginAsAdmin
} from './helpers.js';

const tinyPng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

async function rotateHermesBotToken(request: APIRequestContext, token: string): Promise<string> {
  const bots = await request.get('/admin/bots', {
    headers: { Authorization: `Bearer ${token}` }
  });
  expect(bots.ok(), await bots.text()).toBeTruthy();
  const bot = ((await bots.json()) as { user_id: string }[])[0];
  if (bot === undefined) throw new Error('missing Hermes bot account');

  const rotated = await request.post(`/admin/bots/${bot.user_id}/regenerate-token`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  expect(rotated.ok(), await rotated.text()).toBeTruthy();
  const body = (await rotated.json()) as { token: string };
  return body.token;
}

test('profile image upload/reset and file image preview', async ({ page }) => {
  await loginAsAdmin(page);
  const userId = await page.evaluate(async () => {
    const response = await fetch('/api/v4/users/me');
    const body = (await response.json()) as { id: string };
    return body.id;
  });
  await page.locator('.sidebar-head').getByRole('button', { name: 'Profile' }).click();
  const nickname = `Ops ${Date.now()}`;
  await page.getByLabel('Nickname').fill(nickname);
  await page.getByLabel('Position').fill('Switchboard lead');
  await page.getByLabel('Photo').setInputFiles({
    name: 'avatar.png',
    mimeType: 'image/png',
    buffer: tinyPng
  });
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Profile saved.')).toBeVisible();
  await expect(page.getByLabel('Nickname')).toHaveValue(nickname);
  await expect(page.getByLabel('Position')).toHaveValue('Switchboard lead');
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const response = await fetch('/api/v4/users/me');
        const body = (await response.json()) as { nickname: string; position: string };
        return `${body.nickname}|${body.position}`;
      })
    )
    .toBe(`${nickname}|Switchboard lead`);
  await expect
    .poll(async () =>
      page.evaluate(async (id) => {
        const response = await fetch('/api/v4/users/' + id + '/image');
        return response.headers.get('content-type') ?? '';
      }, userId)
    )
    .toContain('image/png');
  await page.getByRole('button', { name: 'Reset photo' }).click();
  await expect(page.getByText('Profile photo reset.')).toBeVisible();

  await page.getByLabel('Message').fill('Image upload');
  await page.locator('input[type=file][name=files]').setInputFiles({
    name: 'upload.png',
    mimeType: 'image/png',
    buffer: tinyPng
  });
  await expect(page.getByLabel('Selected attachments')).toContainText('upload.png');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByAltText('Attachment preview').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open attachment preview' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /Attachment /u })).toBeHidden();

  await page.getByLabel('Message').fill('Text upload');
  await page.locator('input[type=file][name=files]').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('plain text attachment')
  });
  await page.getByRole('button', { name: 'Send' }).click();
  const textPost = page.getByRole('article').filter({ hasText: 'Text upload' });
  await expect(textPost.getByRole('link', { name: 'Attachment notes.txt' })).toBeVisible();
  await expect(textPost.getByAltText('Attachment preview')).toHaveCount(0);

  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Files' })).toBeVisible();
  await expect(page.locator('.file-row').filter({ hasText: 'Attachment' }).first()).toBeVisible();
});

test('unauthorized user cannot download a private-channel file', async ({ request }) => {
  const token = await adminToken(request);
  const teamResponse = await request.get('/api/v4/users/me/teams', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const team = ((await teamResponse.json()) as { id: string }[])[0];
  if (team === undefined) throw new Error('missing team');
  const privateChannel = await request.post('/api/v4/channels', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      team_id: team.id,
      name: `private-${Date.now()}`,
      display_name: 'Private Files',
      type: 'P'
    }
  });
  const channel = (await privateChannel.json()) as { id: string };
  const upload = await request.post('/api/v4/files', {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      channel_id: channel.id,
      files: { name: 'secret.png', mimeType: 'image/png', buffer: tinyPng }
    }
  });
  expect(upload.ok()).toBeTruthy();
  const file = ((await upload.json()) as { file_infos: { id: string }[] }).file_infos[0];
  if (file === undefined) throw new Error('missing file');
  const userToken = await createUserViaInvite(request, token, `files-${Date.now()}`);
  const blocked = await request.get(`/api/v4/files/${file.id}`, {
    headers: { Authorization: `Bearer ${userToken}` }
  });
  expect(blocked.status()).toBeGreaterThanOrEqual(400);
});

test('admin users page and privacy console keep telemetry off', async ({ page, request }) => {
  await loginAsAdmin(page);
  await enableAdminMode(page);
  await page.getByRole('button', { name: 'Users' }).click();
  await expect(
    page.locator('.panel-body span').filter({ hasText: '@admin' }).first()
  ).toBeVisible();
  await page.getByRole('button', { name: 'System', exact: true }).click();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  const token = await adminToken(request);
  const config = await request.get('/api/v4/config/client', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const body = (await config.json()) as {
    PrivacySettings: {
      EnableTelemetry: boolean;
      EnableDiagnostics: boolean;
      EnableFileAttachments: boolean;
      EnableBotAccountCreation: boolean;
    };
  };
  expect(body.PrivacySettings.EnableTelemetry).toBe(false);
  expect(body.PrivacySettings.EnableDiagnostics).toBe(false);
  expect(body.PrivacySettings.EnableFileAttachments).toBe(true);
  expect(body.PrivacySettings.EnableBotAccountCreation).toBe(true);
});

test('Hermes bot posts via REST, receives WebSocket event, and replies in thread', async ({
  page,
  request,
  baseURL
}) => {
  const token = await adminToken(request);
  const channelId = await defaultChannelId(request, token);
  const hermesBotToken = await rotateHermesBotToken(request, token);
  const botRequest = await playwrightRequest.newContext({
    ...(baseURL === undefined ? {} : { baseURL }),
    extraHTTPHeaders: { Authorization: `Bearer ${hermesBotToken}` }
  });
  await loginAsAdmin(page);
  await page.getByLabel('Message').fill('@hermes status check');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('@hermes status check')).toBeVisible();
  await expect(page.getByTestId('bot-response-indicator')).toContainText(
    'Hermes Agent is responding'
  );
  const postedSeen = page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const socket = new WebSocket(
          `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/v4/websocket`
        );
        socket.addEventListener('message', (event) => {
          const frame = JSON.parse(String(event.data)) as { event?: string };
          if (frame.event === 'posted') {
            socket.close();
            resolve('posted');
          }
        });
      })
  );
  await page.waitForTimeout(500);
  try {
    const botPost = await botRequest.post('/api/v4/posts', {
      data: { channel_id: channelId, message: '@admin Hermes online' }
    });
    expect(botPost.ok(), await botPost.text()).toBeTruthy();
    expect(await postedSeen).toBe('posted');
    await expect(page.getByTestId('bot-response-indicator')).toBeHidden();
    const root = (await botPost.json()) as { id: string };
    const reply = await botRequest.post('/api/v4/posts', {
      data: { channel_id: channelId, root_id: root.id, message: 'Threaded Hermes reply' }
    });
    expect(reply.ok(), await reply.text()).toBeTruthy();
    await expect(page.getByText('Threaded Hermes reply')).toBeVisible();
  } finally {
    await botRequest.dispose();
  }
});
