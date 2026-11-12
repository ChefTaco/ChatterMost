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
  frameText,
  waitForFrame
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

test('client configuration keeps telemetry off', async ({ request }) => {
  const token = await adminToken(request);
  const config = await request.get('/api/v4/config/client', {
    headers: { Authorization: `Bearer ${token}` }
  });
  expect(config.ok()).toBeTruthy();
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

test('Hermes bot posts via REST, the user receives it over WebSocket, and the bot replies in thread', async ({
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
  try {
    const question = await request.post('/api/v4/posts', {
      headers: { Authorization: `Bearer ${token}` },
      data: { channel_id: channelId, message: '@hermes status check' }
    });
    expect(question.ok(), await question.text()).toBeTruthy();

    const marker = `@admin Hermes online ${Date.now()}`;
    const posted = waitForFrame(
      token,
      (frame) => frame.event === 'posted' && frameText(frame, 'post').includes(marker)
    );
    await posted.ready;
    const botPost = await botRequest.post('/api/v4/posts', {
      data: { channel_id: channelId, message: marker }
    });
    expect(botPost.ok(), await botPost.text()).toBeTruthy();
    await posted.frame;

    const root = (await botPost.json()) as { id: string };
    const reply = await botRequest.post('/api/v4/posts', {
      data: { channel_id: channelId, root_id: root.id, message: 'Threaded Hermes reply' }
    });
    expect(reply.ok(), await reply.text()).toBeTruthy();
    const thread = await request.get(`/api/v4/posts/${root.id}/thread`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(thread.ok(), await thread.text()).toBeTruthy();
    const posts = Object.values(
      ((await thread.json()) as { posts: Record<string, { message: string }> }).posts
    );
    expect(posts.map((post) => post.message)).toContain('Threaded Hermes reply');
  } finally {
    await botRequest.dispose();
  }
});
