import { describe, expect, it, vi } from 'vitest';

import { WebSocketHub } from '../../src/server/services.js';
import { createId, nowMs } from '../../src/shared/mattermost.js';
import { JsonStore } from '../../src/server/store.js';
import { bearer, createTestServer, firstChannelId, login } from './helpers.js';

describe('Mattermost-compatible API', () => {
  it('returns exact Mattermost-compatible errors', async () => {
    const server = await createTestServer();
    const response = await server.app.request('/api/v4/users/me');
    expect(response.status).toBe(401);
    const json = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(json).sort()).toEqual(['detailed_error', 'id', 'message', 'request_id', 'status_code']);
  });

  it('rejects malformed JSON even for bodies whose fields are optional', async () => {
    const server = await createTestServer();
    const token = await login(server);
    const response = await server.app.request('/api/v4/users/search', {
      method: 'POST',
      headers: bearer(token),
      body: '{'
    });
    expect(response.status).toBe(400);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      id: 'api.context.invalid_param.app_error',
      message: 'Invalid JSON request body'
    });
  });

  it('returns a Mattermost-compatible 413 before parsing an oversized request', async () => {
    const server = await createTestServer();
    const response = await server.app.request('/api/v4/users/login/type', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(31 * 1024 * 1024)
      },
      body: '{}'
    });
    expect(response.status).toBe(413);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      id: 'api.context.request_body_too_large.app_error',
      status_code: 413
    });
  });

  it('uses safe pagination defaults for malformed query values', async () => {
    const server = await createTestServer();
    const token = await login(server);
    const response = await server.app.request('/api/v4/users?page=NaN&per_page=Infinity', {
      headers: bearer(token)
    });
    expect(response.status).toBe(200);
    expect((await response.json()) as { username: string }[]).toContainEqual(expect.objectContaining({ username: 'admin' }));
  });

  it('ignores forwarding headers from direct untrusted clients', async () => {
    const server = await createTestServer({ TRUSTED_PROXIES: '127.0.0.1/32' });
    let response = new Response();
    for (let index = 0; index <= 240; index += 1) {
      response = await server.app.request('/api/v4/system/ping', {
        headers: { 'X-Forwarded-For': `198.51.100.${index % 250}` }
      }, peer('203.0.113.9'));
    }
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).not.toBeNull();
  });

  it('walks the full trusted proxy chain to the first untrusted address', async () => {
    const server = await createTestServer({ TRUSTED_PROXIES: '127.0.0.1/32,10.0.0.0/8' });
    let response = new Response();
    for (let index = 0; index <= 240; index += 1) {
      response = await server.app.request('/api/v4/system/ping', {
        headers: { 'X-Forwarded-For': `198.51.100.7, 10.${index % 250}.0.1` }
      }, peer('127.0.0.1'));
    }
    expect(response.status).toBe(429);
  });

  it('rate limits login accounts separately across changing source addresses', async () => {
    // Twenty real password checks can exceed ten seconds on shared CI runners.
    const server = await createTestServer({ TRUSTED_PROXIES: '127.0.0.1/32', RATE_LIMIT_LOGIN_SOURCE_MAX: '20', RATE_LIMIT_LOGIN_ACCOUNT_MAX: '20' });
    let response = new Response();
    for (let index = 1; index <= 21; index += 1) {
      response = await server.app.request('/api/v4/users/login', {
        method: 'POST',
        headers: server.baseHeaders,
        body: JSON.stringify({ login_id: 'admin', password: 'incorrect-password' })
      }, peer(`198.51.100.${index}`));
    }
    expect(response.status).toBe(429);

    const unrelated = await server.app.request('/api/v4/users/login', {
      method: 'POST',
      headers: server.baseHeaders,
      body: JSON.stringify({ login_id: 'nobody-else', password: 'incorrect-password' })
    }, peer('198.51.100.99'));
    expect(unrelated.status).toBe(400);
  }, 30_000);

  it('reports abuse-control identity and throttle telemetry to administrators', async () => {
    const server = await createTestServer();
    const token = await login(server);
    const response = await server.app.request('/api/v4/metrics', { headers: bearer(token) });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { abuse_control: Record<string, unknown> };
    expect(body.abuse_control).toMatchObject({ backend: 'local', cross_instance_consistent: false, account_checks: 1 });
    expect(body.abuse_control.trusted_proxy_decisions).toBeTypeOf('object');
  });

  it('persists admin bootstrap across store reconnect', async () => {
    const server = await createTestServer();
    const admin = server.services.users.findByUsername('admin');
    expect(admin?.roles).toContain('system_admin');
    const token = await login(server);
    const me = await server.app.request('/api/v4/users/me', { headers: bearer(token) });
    expect((await me.json()) as { username: string }).toMatchObject({ username: 'admin' });
  });

  it('creates invite, enrolls once, and blocks reuse', async () => {
    const server = await createTestServer();
    const token = await login(server);
    const inviteResponse = await server.app.request('/admin/invites', {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify({ max_uses: 1, expires_in_hours: 12 })
    });
    const invite = (await inviteResponse.json()) as { code: string };
    const signup = await server.app.request('/api/v4/users', {
      method: 'POST',
      headers: server.baseHeaders,
      body: JSON.stringify({
        invite_code: invite.code,
        username: 'alice',
        email: 'alice@example.test',
        password: 'AlicePassword123!'
      })
    });
    expect(signup.status).toBe(201);
    const reuse = await server.app.request('/api/v4/users', {
      method: 'POST',
      headers: server.baseHeaders,
      body: JSON.stringify({
        invite_code: invite.code,
        username: 'bob',
        email: 'bob@example.test',
        password: 'BobPassword123!'
      })
    });
    expect(reuse.status).toBe(400);
  });

  it('supports channels, posts, threads, reactions, preferences, status, and privacy', async () => {
    const server = await createTestServer();
    const token = await login(server);
    const channelId = await firstChannelId(server.app, token);
    const postResponse = await server.app.request('/api/v4/posts', {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify({ channel_id: channelId, message: 'hello @hermes #check' })
    });
    const post = (await postResponse.json()) as {
      id: string;
      channel_id: string;
      metadata: { mentions: string[] };
    };
    expect(post.channel_id).toBe(channelId);
    expect(post.metadata.mentions).toContain('hermes');

    const nullablePost = await server.app.request('/api/v4/posts', {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify({
        channel_id: channelId,
        message: 'mmctl-compatible nullable fields',
        root_id: null,
        file_ids: null,
        pending_post_id: null,
        props: null
      })
    });
    expect(nullablePost.status).toBe(201);

    const replyResponse = await server.app.request('/api/v4/posts', {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify({ channel_id: channelId, root_id: post.id, message: 'thread reply' })
    });
    expect(replyResponse.status).toBe(201);

    const reaction = await server.app.request('/api/v4/reactions', {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify({ post_id: post.id, emoji_name: 'white_check_mark' })
    });
    expect(reaction.status).toBe(201);

    const preferences = await server.app.request('/api/v4/users/admin/preferences', {
      method: 'PUT',
      headers: bearer(token),
      body: JSON.stringify([{ category: 'display', name: 'theme', value: 'system' }])
    });
    expect(preferences.status).toBe(200);

    const status = await server.app.request('/api/v4/users/admin/status', {
      method: 'PUT',
      headers: bearer(token),
      body: JSON.stringify({ status: 'dnd' })
    });
    expect((await status.json()) as { status: string }).toMatchObject({ status: 'dnd' });

    const config = await server.app.request('/api/v4/config/patch', {
      method: 'PUT',
      headers: bearer(token),
      body: JSON.stringify({
        PrivacySettings: { EnableTelemetry: false, EnableDiagnostics: false }
      })
    });
    expect(config.status).toBe(200);
  });

  it('paginates team channels and exposes archived channels for mmctl compatibility', async () => {
    const server = await createTestServer();
    const token = await login(server);
    const teams = await server.app.request('/api/v4/users/me/teams', { headers: bearer(token) });
    const team = ((await teams.json()) as { id: string }[])[0];
    if (team === undefined) {
      throw new Error('missing default team');
    }

    const firstPage = await server.app.request(`/api/v4/teams/${team.id}/channels?page=0&per_page=1`, {
      headers: bearer(token)
    });
    const firstPageBody = (await firstPage.json()) as { id: string; name: string }[];
    expect(firstPageBody).toHaveLength(1);

    const secondPage = await server.app.request(`/api/v4/teams/${team.id}/channels?page=1&per_page=1`, {
      headers: bearer(token)
    });
    const secondPageBody = (await secondPage.json()) as { id: string; name: string }[];
    expect(secondPageBody).toHaveLength(1);
    expect(secondPageBody[0]?.id).not.toBe(firstPageBody[0]?.id);

    const archivedBefore = await server.app.request(`/api/v4/teams/${team.id}/channels/deleted?page=0&per_page=10`, {
      headers: bearer(token)
    });
    expect((await archivedBefore.json()) as unknown[]).toEqual([]);

    await server.app.request(`/api/v4/channels/${secondPageBody[0]?.id}`, {
      method: 'DELETE',
      headers: bearer(token)
    });
    const archivedAfter = await server.app.request(`/api/v4/teams/${team.id}/channels/deleted?page=0&per_page=10`, {
      headers: bearer(token)
    });
    const archivedBody = (await archivedAfter.json()) as { id: string; delete_at: number }[];
    expect(archivedBody).toHaveLength(1);
    expect(archivedBody[0]?.id).toBe(secondPageBody[0]?.id);
    expect(archivedBody[0]?.delete_at).toBeGreaterThan(0);
  });

  it('lets private channel admins add users and blocks ordinary member adds', async () => {
    const server = await createTestServer();
    const adminToken = await login(server);
    const bob = await createInvitedUser(server, adminToken, 'privatebob');
    const carol = await createInvitedUser(server, adminToken, 'privatecarol');
    const dave = await createInvitedUser(server, adminToken, 'privatedave');
    const teamsResponse = await server.app.request('/api/v4/users/me/teams', {
      headers: bearer(bob.token)
    });
    const team = ((await teamsResponse.json()) as { id: string }[])[0];
    if (team === undefined) {
      throw new Error('missing team');
    }

    const channelResponse = await server.app.request('/api/v4/channels', {
      method: 'POST',
      headers: bearer(bob.token),
      body: JSON.stringify({
        team_id: team.id,
        name: 'private-unit-test',
        display_name: 'Private Unit Test',
        type: 'P'
      })
    });
    expect(channelResponse.status).toBe(201);
    const channel = (await channelResponse.json()) as { id: string };

    const addCarol = await server.app.request(`/api/v4/channels/${channel.id}/members`, {
      method: 'POST',
      headers: bearer(bob.token),
      body: JSON.stringify({ user_id: carol.userId })
    });
    expect(addCarol.status).toBe(200);

    const carolChannels = await server.app.request(`/api/v4/users/me/teams/${team.id}/channels`, {
      headers: bearer(carol.token)
    });
    expect(((await carolChannels.json()) as { id: string }[]).some((item) => item.id === channel.id)).toBe(true);

    const blocked = await server.app.request(`/api/v4/channels/${channel.id}/members`, {
      method: 'POST',
      headers: bearer(carol.token),
      body: JSON.stringify({ user_id: dave.userId })
    });
    expect(blocked.status).toBe(403);
  });

  it('lets invited users discover and join public channels without seeing private channels', async () => {
    const server = await createTestServer();
    const adminToken = await login(server);
    const teamsResponse = await server.app.request('/api/v4/users/me/teams', {
      headers: bearer(adminToken)
    });
    const team = ((await teamsResponse.json()) as { id: string }[])[0];
    if (team === undefined) {
      throw new Error('missing team');
    }

    const publicChannelResponse = await server.app.request('/api/v4/channels', {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify({
        team_id: team.id,
        name: 'test-public',
        display_name: 'Test Public',
        type: 'O'
      })
    });
    expect(publicChannelResponse.status).toBe(201);
    const publicChannel = (await publicChannelResponse.json()) as {
      id: string;
      display_name: string;
    };

    const privateChannelResponse = await server.app.request('/api/v4/channels', {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify({
        team_id: team.id,
        name: 'test-private',
        display_name: 'Test Private',
        type: 'P'
      })
    });
    expect(privateChannelResponse.status).toBe(201);
    const privateChannel = (await privateChannelResponse.json()) as { id: string };

    const testotron = await createInvitedUser(server, adminToken, 'testotronunit');
    const visibleChannels = await server.app.request(`/api/v4/teams/${team.id}/channels`, {
      headers: bearer(testotron.token)
    });
    const visibleBody = (await visibleChannels.json()) as { id: string; display_name: string }[];
    expect(visibleBody.some((channel) => channel.id === publicChannel.id)).toBe(true);
    expect(visibleBody.some((channel) => channel.id === privateChannel.id)).toBe(false);

    const joinPublic = await server.app.request(`/api/v4/channels/${publicChannel.id}/members`, {
      method: 'POST',
      headers: bearer(testotron.token),
      body: JSON.stringify({ user_id: testotron.userId })
    });
    expect(joinPublic.status).toBe(200);

    const post = await server.app.request('/api/v4/posts', {
      method: 'POST',
      headers: bearer(testotron.token),
      body: JSON.stringify({
        channel_id: publicChannel.id,
        message: 'Testotron joins #Test Public'
      })
    });
    expect(post.status).toBe(201);
  });

  it('blocks public channel discovery and self-join outside team membership', async () => {
    const server = await createTestServer();
    const adminToken = await login(server);
    const admin = server.services.users.findByUsername('admin');
    if (admin === null) {
      throw new Error('missing admin');
    }
    const now = nowMs();
    const otherTeam = {
      id: createId(),
      createAt: now,
      updateAt: now,
      deleteAt: 0,
      name: 'restricted-team',
      displayName: 'Restricted Team',
      description: '',
      type: 'O' as const,
      companyName: '',
      allowedDomains: '',
      inviteId: '',
      allowOpenInvite: false,
      schemeId: null,
      groupConstrained: false
    };
    await server.store.write((state) => {
      state.teams.push(otherTeam);
    });
    await server.services.teams.addUserToTeam(otherTeam.id, admin.id, 'team_admin');

    const channelResponse = await server.app.request('/api/v4/channels', {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify({
        team_id: otherTeam.id,
        name: 'restricted-public',
        display_name: 'Restricted Public',
        type: 'O'
      })
    });
    expect(channelResponse.status).toBe(201);
    const channel = (await channelResponse.json()) as { id: string };

    const outsider = await createInvitedUser(server, adminToken, 'outsiderunit');

    const listChannels = await server.app.request(`/api/v4/teams/${otherTeam.id}/channels`, {
      headers: bearer(outsider.token)
    });
    expect(listChannels.status).toBe(404);

    const searchChannels = await server.app.request(`/api/v4/teams/${otherTeam.id}/channels/search`, {
      method: 'POST',
      headers: bearer(outsider.token),
      body: JSON.stringify({ term: 'restricted' })
    });
    expect(searchChannels.status).toBe(404);

    const getChannelByName = await server.app.request(`/api/v4/teams/${otherTeam.id}/channels/name/restricted-public`, {
      headers: bearer(outsider.token)
    });
    expect(getChannelByName.status).toBe(404);

    const joinPublic = await server.app.request(`/api/v4/channels/${channel.id}/members`, {
      method: 'POST',
      headers: bearer(outsider.token),
      body: JSON.stringify({ user_id: outsider.userId })
    });
    expect(joinPublic.status).toBe(404);
  });

  it('lets administrators revoke and later restore team membership', async () => {
    const server = await createTestServer();
    const adminToken = await login(server);
    const player = await createInvitedUser(server, adminToken, 'revokedplayer');
    const victim = await createInvitedUser(server, adminToken, 'revokedvictim');
    const team = server.services.teams.listUserTeams(player.userId)[0];
    if (team === undefined) throw new Error('missing team');

    const denied = await server.app.request(`/api/v4/teams/${team.id}/members/${player.userId}`, {
      method: 'DELETE',
      headers: bearer(player.token)
    });
    expect(denied.status).toBe(403);
    const elevated = await server.app.request(`/api/v4/teams/${team.id}/members/${player.userId}/roles`, {
      method: 'PUT',
      headers: bearer(adminToken),
      body: JSON.stringify({ roles: 'team_user team_admin' })
    });
    expect(elevated.status).toBe(200);
    const removed = await server.app.request(`/api/v4/teams/${team.id}/members/${victim.userId}`, {
      method: 'DELETE',
      headers: bearer(player.token)
    });
    expect(removed.status).toBe(200);
    expect(
      (await server.app.request(`/api/v4/teams/${team.id}/members/${victim.userId}`, {
        headers: bearer(adminToken)
      })).status
    ).toBe(404);

    const restored = await server.app.request(`/api/v4/teams/${team.id}/members`, {
      method: 'POST',
      headers: bearer(player.token),
      body: JSON.stringify({ user_id: victim.userId })
    });
    expect(restored.status).toBe(200);
    expect(
      (await server.app.request(`/api/v4/teams/${team.id}/members/${victim.userId}`, {
        headers: bearer(adminToken)
      })).status
    ).toBe(200);
  });

  it('blocks invited users from reading or discovering admin Hermes direct messages', async () => {
    const server = await createTestServer();
    const adminToken = await login(server);
    const admin = server.services.users.findByUsername('admin');
    const hermes = server.services.users.findByUsername('hermes');
    if (admin === null) throw new Error('missing admin');
    if (hermes === null) throw new Error('missing hermes');
    const testotron = await createInvitedUser(server, adminToken, 'testotron-dmprivacy');
    const testFrames: string[] = [];
    const testConnection = server.services.hub.attach({ send: (payload) => testFrames.push(payload) }, testotron.userId);
    testFrames.length = 0;

    const direct = await server.app.request('/api/v4/channels/direct', {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify([hermes.id])
    });
    expect(direct.status).toBe(200);
    const channel = (await direct.json()) as { id: string };
    const secret = `admin hermes private ${Date.now()}`;
    const postResponse = await server.app.request('/api/v4/posts', {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify({ channel_id: channel.id, message: secret })
    });
    expect(postResponse.status).toBe(201);
    const post = (await postResponse.json()) as { id: string };

    const testChannels = await server.app.request('/api/v4/users/me/channels', {
      headers: bearer(testotron.token)
    });
    expect(await testChannels.text()).not.toContain(channel.id);

    const blockedRequests: (() => Promise<Response>)[] = [
      async () => server.app.request(`/api/v4/channels/${channel.id}`, { headers: bearer(testotron.token) }),
      async () =>
        server.app.request(`/api/v4/channels/${channel.id}/posts`, {
          headers: bearer(testotron.token)
        }),
      async () => server.app.request(`/api/v4/posts/${post.id}`, { headers: bearer(testotron.token) }),
      async () => server.app.request(`/api/v4/posts/${post.id}/thread`, { headers: bearer(testotron.token) }),
      async () =>
        server.app.request(`/api/v4/channels/${channel.id}/members`, {
          headers: bearer(testotron.token)
        }),
      async () =>
        server.app.request(`/api/v4/channels/${channel.id}/members/${admin.id}`, {
          headers: bearer(testotron.token)
        }),
      async () =>
        server.app.request(`/api/v4/users/${testotron.userId}/channels/${channel.id}/unread`, {
          headers: bearer(testotron.token)
        }),
      async () =>
        server.app.request(`/api/v4/posts/${post.id}/reactions`, {
          headers: bearer(testotron.token)
        }),
      async () =>
        server.app.request(`/api/v4/posts/${post.id}/files/info`, {
          headers: bearer(testotron.token)
        }),
      async () =>
        server.app.request('/api/v4/posts/ids', {
          method: 'POST',
          headers: bearer(testotron.token),
          body: JSON.stringify([post.id])
        })
    ];
    for (const requestBlockedResource of blockedRequests) {
      const response = await requestBlockedResource();
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(await response.text()).not.toContain(secret);
    }

    const globalSearch = await server.app.request('/api/v4/posts/search', {
      method: 'POST',
      headers: bearer(testotron.token),
      body: JSON.stringify({ terms: secret })
    });
    expect(globalSearch.status).toBe(200);
    expect(await globalSearch.text()).not.toContain(secret);

    const reactionsByIds = await server.app.request('/api/v4/posts/ids/reactions', {
      method: 'POST',
      headers: bearer(testotron.token),
      body: JSON.stringify([post.id])
    });
    expect(reactionsByIds.status).toBe(200);
    expect(await reactionsByIds.text()).not.toContain(post.id);

    const leakedFrames = testFrames.map((payload) => JSON.parse(payload) as { event?: string; data?: Record<string, unknown> }).filter((frame) => ['channel_created', 'direct_added', 'group_added', 'posted'].includes(frame.event ?? ''));
    expect(leakedFrames).toEqual([]);
    server.services.hub.detach(testConnection.id);
  });

  it('enforces CSRF on cookie-authenticated writes and exempts bearer clients', async () => {
    const server = await createTestServer();
    const token = await login(server);
    const cookie = `MMSID=${token}`;

    const foreignOrigin = await server.app.request('/api/v4/users/admin/status', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        Origin: 'http://evil.example'
      },
      body: JSON.stringify({ status: 'away' })
    });
    expect(foreignOrigin.status).toBe(403);

    const missingOrigin = await server.app.request('/api/v4/users/admin/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ status: 'dnd' })
    });
    expect(missingOrigin.status).toBe(403);

    const sameOrigin = await server.app.request('/api/v4/users/admin/status', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        Origin: 'http://localhost:8065'
      },
      body: JSON.stringify({ status: 'online' })
    });
    expect(sameOrigin.status).toBe(200);

    const bearerFromForeignOrigin = await server.app.request('/api/v4/users/admin/status', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Origin: 'http://evil.example'
      },
      body: JSON.stringify({ status: 'online' })
    });
    expect(bearerFromForeignOrigin.status).toBe(200);
  });

  it('handles profile images and file permissions', async () => {
    const server = await createTestServer();
    const token = await login(server);
    const adminId = server.services.users.findByUsername('admin')?.id;
    if (adminId === undefined) throw new Error('missing admin user');
    const channelId = await firstChannelId(server.app, token);
    const pngBytes = new Uint8Array(24);
    pngBytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    pngBytes.set([0, 0, 0, 2, 0, 0, 0, 3], 16);
    const png = new File([pngBytes], 'tiny.png', {
      type: 'image/png'
    });
    const profileForm = new FormData();
    profileForm.set('image', png);
    const profile = await server.app.request(`/api/v4/users/${adminId}/image`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: profileForm
    });
    expect(profile.status).toBe(200);
    const nonexistentProfile = await server.app.request('/api/v4/users/does-not-exist/image', {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: profileForm
    });
    expect(nonexistentProfile.status).toBe(404);
    for (const endpoint of [`/api/v4/users/${adminId}/image`, `/api/v4/users/${adminId}/image/default`]) {
      expect((await server.app.request(endpoint)).status).toBe(401);
      expect((await server.app.request(endpoint, { headers: bearer(token) })).status).toBe(200);
    }

    const uploadForm = new FormData();
    uploadForm.set('channel_id', channelId);
    uploadForm.append('files', png);
    uploadForm.append('files', png);
    const upload = await server.app.request('/api/v4/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: uploadForm
    });
    expect(upload.status).toBe(201);
    const body = (await upload.json()) as { file_infos: { id: string }[] };
    const file = body.file_infos[0];
    const duplicateFile = body.file_infos[1];
    expect(file?.id).toHaveLength(26);
    expect(duplicateFile?.id).toHaveLength(26);
    expect(duplicateFile?.id).not.toBe(file?.id);
    const attachmentPost = await server.app.request('/api/v4/posts', {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify({
        channel_id: channelId,
        message: '',
        file_ids: [file?.id, duplicateFile?.id]
      })
    });
    expect(attachmentPost.status).toBe(201);
    const attachment = (await attachmentPost.json()) as {
      id: string;
      file_ids: string[];
      metadata: {
        files: { id: string; post_id: string; mime_type: string; width: number; height: number }[];
      };
    };
    expect(attachment.file_ids).toEqual([file?.id]);
    expect(attachment.metadata.files).toEqual([
      expect.objectContaining({
        id: file?.id,
        post_id: attachment.id,
        mime_type: 'image/png',
        width: 2,
        height: 3
      })
    ]);
    const attachmentInfos = await server.app.request(`/api/v4/posts/${attachment.id}/files/info`, {
      headers: bearer(token)
    });
    expect(await attachmentInfos.json()).toEqual([expect.objectContaining({ id: file?.id, post_id: attachment.id })]);
    const attachedFileInfo = await server.app.request(`/api/v4/files/${file?.id}/info`, {
      headers: bearer(token)
    });
    expect(await attachedFileInfo.json()).toMatchObject({ id: file?.id, post_id: attachment.id });
    const removeAttachment = await server.app.request(`/api/v4/posts/${attachment.id}/patch`, {
      method: 'PUT',
      headers: bearer(token),
      body: JSON.stringify({ message: 'attachment removed', file_ids: [] })
    });
    expect(await removeAttachment.json()).toMatchObject({
      message: 'attachment removed',
      file_ids: [],
      metadata: { files: [] }
    });

    const missingAttachment = await server.app.request('/api/v4/posts', {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify({ channel_id: channelId, message: '', file_ids: [createId()] })
    });
    expect(missingAttachment.status).toBe(400);

    const raw = await server.app.request(`/api/v4/files/${file?.id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(raw.status).toBe(200);
    expect(raw.headers.get('content-disposition')).toContain('attachment');
    expect(raw.headers.get('x-content-type-options')).toBe('nosniff');

    const script = new File([new TextEncoder().encode('alert(document.cookie)')], 'payload.js', {
      type: 'application/javascript'
    });
    const scriptForm = new FormData();
    scriptForm.set('channel_id', channelId);
    scriptForm.append('files', script);
    const blockedScript = await server.app.request('/api/v4/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: scriptForm
    });
    expect(blockedScript.status).toBe(400);
  });

  it('authenticates Hermes bot token and records supervised events', async () => {
    const server = await createTestServer();
    const adminToken = await login(server);
    const channelId = await firstChannelId(server.app, adminToken);
    const me = await server.app.request('/api/v4/users/me', {
      headers: bearer('test-hermes-token')
    });
    expect((await me.json()) as { username: string }).toMatchObject({ username: 'hermes' });
    const post = await server.app.request('/api/v4/posts', {
      method: 'POST',
      headers: bearer('test-hermes-token'),
      body: JSON.stringify({ channel_id: channelId, message: 'Hermes reply', root_id: '' })
    });
    expect(post.status).toBe(201);
    const events = await server.app.request('/admin/supervision/events', {
      headers: bearer(adminToken)
    });
    expect((await events.json()) as unknown[]).not.toHaveLength(0);
  });

  it('hides pre-moderation held posts from other members while keeping them visible to the author and admins', async () => {
    const server = await createTestServer();
    const adminToken = await login(server);
    const channelId = await firstChannelId(server.app, adminToken);
    const alice = await createInvitedUser(server, adminToken, 'holdalice');
    const bob = await createInvitedUser(server, adminToken, 'holdbob');

    const policy = await server.app.request('/admin/supervision/policy', {
      method: 'PUT',
      headers: bearer(adminToken),
      body: JSON.stringify({ mode: 'pre_moderation', blockedTerms: ['hold'] })
    });
    expect(policy.status).toBe(200);

    const heldSecret = `please hold this ${Date.now()}`;
    const heldResponse = await server.app.request('/api/v4/posts', {
      method: 'POST',
      headers: bearer(alice.token),
      body: JSON.stringify({ channel_id: channelId, message: heldSecret })
    });
    expect(heldResponse.status).toBe(201);
    const heldPost = (await heldResponse.json()) as { id: string };

    const bobView = await server.app.request(`/api/v4/channels/${channelId}/posts`, {
      headers: bearer(bob.token)
    });
    expect(bobView.status).toBe(200);
    const bobBody = await bobView.text();
    expect(bobBody).not.toContain(heldSecret);
    expect(bobBody).not.toContain(heldPost.id);

    const bobSearch = await server.app.request('/api/v4/posts/search', {
      method: 'POST',
      headers: bearer(bob.token),
      body: JSON.stringify({ terms: 'hold' })
    });
    expect(await bobSearch.text()).not.toContain(heldSecret);

    const authorView = await server.app.request(`/api/v4/channels/${channelId}/posts`, {
      headers: bearer(alice.token)
    });
    expect(await authorView.text()).toContain(heldPost.id);

    const adminView = await server.app.request(`/api/v4/channels/${channelId}/posts`, {
      headers: bearer(adminToken)
    });
    expect(await adminView.text()).toContain(heldPost.id);
  });

  it('exposes build metadata without leaking secrets', async () => {
    const server = await createTestServer({
      BUILD_HASH: 'abc1234',
      BUILD_DATE: '2026-07-02T00:00:00.000Z',
      RELEASE_ID: '20260702000000'
    });
    const ping = await server.app.request('/api/v4/system/ping');
    expect((await ping.json()) as Record<string, unknown>).toMatchObject({
      build_hash: 'abc1234',
      build_date: '2026-07-02T00:00:00.000Z',
      release_id: '20260702000000'
    });
    const token = await login(server);
    const config = await server.app.request('/api/v4/config/client', { headers: bearer(token) });
    const clientConfig = (await config.json()) as Record<string, unknown>;
    expect(clientConfig).toMatchObject({
      BuildHash: 'abc1234',
      BuildDate: '2026-07-02T00:00:00.000Z',
      ReleaseId: '20260702000000'
    });
    expect(clientConfig.DiagnosticId).toMatch(/^[a-z0-9]{26}$/u);
    expect(clientConfig.TelemetryId).toBe(clientConfig.DiagnosticId);
    expect(clientConfig).toMatchObject({
      EnableSignUpWithEmail: 'false',
      EnableSignInWithEmail: 'true',
      EnableSignInWithUsername: 'true'
    });

    const fullConfig = await server.app.request('/api/v4/config', { headers: bearer(token) });
    expect(await fullConfig.json()).toMatchObject({
      NativeAgentRegistry: {
        Enabled: true,
        RedisFanoutEnabled: false,
        WebSocketFanoutMode: 'local-process'
      }
    });

    const ha = await server.app.request('/api/v4/ha/status', { headers: bearer(token) });
    expect(await ha.json()).toMatchObject({
      websocket_fanout_mode: 'local-process',
      redis_fanout_enabled: false,
      sticky_session_free_websockets: false,
      multi_process_websocket_safe: false
    });

    const repeatedConfig = await server.app.request('/api/v4/config/client', {
      headers: bearer(token)
    });
    expect(((await repeatedConfig.json()) as Record<string, unknown>).DiagnosticId).toBe(clientConfig.DiagnosticId);
  });

  it('serves the complete Mattermost-compatible mobile team channel bootstrap', async () => {
    const server = await createTestServer();
    const token = await login(server);
    const admin = server.services.users.findByUsername('admin');
    const hermes = server.services.users.findByUsername('hermes');
    if (admin === null || hermes === null) throw new Error('missing DM participants');
    const dmResponse = await server.app.request('/api/v4/channels/direct', {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify([admin.id, hermes.id])
    });
    const dm = (await dmResponse.json()) as { id: string };
    const teamsResponse = await server.app.request('/api/v4/users/me/teams', {
      headers: bearer(token)
    });
    const teams = (await teamsResponse.json()) as { id: string }[];
    const team = teams[0];
    if (team === undefined) {
      throw new Error('missing default team');
    }

    const [channelsResponse, membershipsResponse, categoriesResponse] = await Promise.all([
      server.app.request(`/api/v4/users/me/teams/${team.id}/channels?include_deleted=true&last_delete_at=0`, {
        headers: bearer(token)
      }),
      server.app.request(`/api/v4/users/me/teams/${team.id}/channels/members`, {
        headers: bearer(token)
      }),
      server.app.request(`/api/v4/users/me/teams/${team.id}/channels/categories`, {
        headers: bearer(token)
      })
    ]);

    expect([channelsResponse.status, membershipsResponse.status, categoriesResponse.status]).toEqual([200, 200, 200]);
    const channels = (await channelsResponse.json()) as { id: string }[];
    const memberships = (await membershipsResponse.json()) as { channel_id: string }[];
    const categories = (await categoriesResponse.json()) as {
      categories: { id: string; channel_ids: string[]; type: string }[];
      order: string[];
    };
    expect(channels.length).toBeGreaterThan(0);
    expect(channels.map((channel) => channel.id)).toContain(dm.id);
    expect(memberships.map((member) => member.channel_id).sort()).toEqual(channels.map((channel) => channel.id).sort());
    expect(categories.categories[0]).toMatchObject({
      type: 'channels'
    });
    expect(categories.categories[0]?.channel_ids).not.toContain(dm.id);
    expect(categories.categories[1]).toMatchObject({
      type: 'direct_messages',
      channel_ids: [dm.id]
    });
    expect(categories.order).toEqual(categories.categories.map((category) => category.id));
  });

  it('covers the native mobile cold-start, discovery, settings, and DM support endpoints', async () => {
    const server = await createTestServer();
    const token = await login(server);
    const admin = server.services.users.findByUsername('admin');
    const hermes = server.services.users.findByUsername('hermes');
    if (admin === null || hermes === null) throw new Error('missing mobile fixture users');
    const team = server.services.teams.listUserTeams(admin.id)[0];
    if (team === undefined) throw new Error('missing mobile fixture team');
    const dmResponse = await server.app.request('/api/v4/channels/direct', {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify([admin.id, hermes.id])
    });
    const dm = (await dmResponse.json()) as { id: string };
    const staleUserId = createId();
    await server.store.write((state) => {
      const timestamp = nowMs();
      state.teamMembers.push({
        id: createId(),
        teamId: team.id,
        userId: staleUserId,
        roles: 'team_user',
        createAt: timestamp,
        updateAt: timestamp,
        deleteAt: 0
      });
    });

    const requests = await Promise.all([
      server.app.request('/api/v4/users/me/teams/members', { headers: bearer(token) }),
      server.app.request('/api/v4/users/ids', {
        method: 'POST',
        headers: bearer(token),
        body: JSON.stringify([hermes.id])
      }),
      server.app.request(`/api/v4/users?active=true&in_team=${team.id}&page=0&per_page=100`, {
        headers: bearer(token)
      }),
      server.app.request(`/api/v4/users?in_channel=${dm.id}`, { headers: bearer(token) }),
      server.app.request('/api/v4/channels/search?include_deleted=false', {
        method: 'POST',
        headers: bearer(token),
        body: JSON.stringify({ term: 'town', team_ids: [team.id] })
      }),
      server.app.request(`/api/v4/channels/${dm.id}/stats`, { headers: bearer(token) }),
      server.app.request('/api/v4/users/me/sessions', { headers: bearer(token) }),
      server.app.request('/api/v4/users/sessions/device', {
        method: 'PUT',
        headers: bearer(token),
        body: JSON.stringify({ device_id: 'mobile-device', mobile_version: '2.41.3' })
      }),
      server.app.request('/api/v4/users/me/patch', {
        method: 'PUT',
        headers: bearer(token),
        body: JSON.stringify({ locale: 'en' })
      }),
      server.app.request(`/api/v4/users/${admin.id}/posts/flagged?channel_id=&team_id=`, {
        headers: bearer(token)
      })
    ]);

    expect(requests.map((response) => response.status)).toEqual(Array.from({ length: 10 }, () => 200));
    expect((await requests[0]?.json()) as { team_id: string }[]).toContainEqual(expect.objectContaining({ team_id: team.id }));
    expect((await requests[1]?.json()) as { id: string }[]).toContainEqual(expect.objectContaining({ id: hermes.id }));
    expect((await requests[2]?.json()) as { id: string }[]).not.toContainEqual(expect.objectContaining({ id: staleUserId }));
    expect((await requests[3]?.json()) as { id: string }[]).toHaveLength(2);
    expect((await requests[4]?.json()) as { name: string }[]).toContainEqual(expect.objectContaining({ name: 'town-square' }));
    expect(await requests[5]?.json()).toMatchObject({ channel_id: dm.id, member_count: 2 });
    expect((await requests[6]?.json()) as { user_id: string }[]).toContainEqual(expect.objectContaining({ user_id: admin.id }));
    expect(await requests[9]?.json()).toMatchObject({ order: [], posts: {} });
  });

  it('supplies a complete high-contrast native theme without replacing an explicit theme', async () => {
    const server = await createTestServer();
    const token = await login(server);
    const initial = await server.app.request('/api/v4/users/me/preferences', {
      headers: bearer(token)
    });
    const initialThemes = ((await initial.json()) as { category: string; value: string }[]).filter((preference) => preference.category === 'theme');
    expect(initialThemes).toHaveLength(1);
    expect(JSON.parse(initialThemes[0]?.value ?? '{}')).toMatchObject({
      sidebarBg: '#202228',
      sidebarText: '#ffffff',
      centerChannelBg: '#191b1f',
      centerChannelColor: '#e3e4e8'
    });

    const me = server.services.users.findByUsername('admin');
    if (me === null) throw new Error('missing admin');
    const customTheme = JSON.stringify({
      type: 'Custom',
      centerChannelBg: '#ffffff',
      centerChannelColor: '#000000'
    });
    await server.app.request(`/api/v4/users/${me.id}/preferences`, {
      method: 'PUT',
      headers: bearer(token),
      body: JSON.stringify([{ category: 'theme', name: '', value: customTheme }])
    });
    const updated = await server.app.request(`/api/v4/users/${me.id}/preferences`, {
      headers: bearer(token)
    });
    const updatedThemes = ((await updated.json()) as { category: string; value: string }[]).filter((preference) => preference.category === 'theme');
    expect(updatedThemes).toEqual([expect.objectContaining({ value: customTheme })]);
  });

  it('supports latent native discovery, channel metadata, and notification flows', async () => {
    const server = await createTestServer();
    const token = await login(server);
    const admin = server.services.users.findByUsername('admin');
    if (admin === null) throw new Error('missing admin');
    const team = server.services.teams.listUserTeams(admin.id)[0];
    const channel = server.services.channels.listForUser(admin.id, team?.id)[0];
    if (team === undefined || channel === undefined) throw new Error('missing mobile fixtures');

    const responses = await Promise.all([
      server.app.request('/api/v4/plugins/webapp', { headers: bearer(token) }),
      server.app.request('/api/v4/agents/status', { headers: bearer(token) }),
      server.app.request(`/api/v4/channels/${channel.id}/timezones`, { headers: bearer(token) }),
      server.app.request(`/api/v4/channels/${channel.id}/member_counts_by_group?include_timezones=true`, {
        headers: bearer(token)
      }),
      server.app.request(`/api/v4/channels/${channel.id}/access_control/attributes`, {
        headers: bearer(token)
      }),
      server.app.request(`/api/v4/users/autocomplete?in_team=${team.id}&name=adm&limit=25`, {
        headers: bearer(token)
      }),
      server.app.request(`/api/v4/teams/${team.id}/channels/autocomplete?name=town`, {
        headers: bearer(token)
      }),
      server.app.request(`/api/v4/teams/${team.id}/channels/search_autocomplete?name=town`, {
        headers: bearer(token)
      }),
      server.app.request(`/api/v4/channels/${channel.id}/members/me/notify_props`, {
        method: 'PUT',
        headers: bearer(token),
        body: JSON.stringify({ channel_id: channel.id, user_id: admin.id, mark_unread: 'mention' })
      })
    ]);
    expect(responses.map((response) => response.status)).toEqual(Array.from({ length: 9 }, () => 200));
    expect(await responses[0]?.json()).toEqual([]);
    expect(await responses[1]?.json()).toMatchObject({ available: false });
    expect(await responses[2]?.json()).toEqual([]);
    expect((await responses[5]?.json()) as { users: { id: string }[] }).toMatchObject({
      users: [expect.objectContaining({ id: admin.id })]
    });
    expect((await responses[6]?.json()) as { id: string }[]).toContainEqual(expect.objectContaining({ id: channel.id }));
    expect(await responses[8]?.json()).toMatchObject({ notify_props: { mark_unread: 'mention' } });
  });

  it('paginates channel history without repeating the same mobile page', async () => {
    const server = await createTestServer();
    const token = await login(server);
    const channelId = await firstChannelId(server.app, token);
    const created: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const response = await server.app.request('/api/v4/posts', {
        method: 'POST',
        headers: bearer(token),
        body: JSON.stringify({ channel_id: channelId, message: `pagination ${index}` })
      });
      created.push(((await response.json()) as { id: string }).id);
    }

    const latestResponse = await server.app.request(`/api/v4/channels/${channelId}/posts?page=0&per_page=2`, {
      headers: bearer(token)
    });
    const latest = (await latestResponse.json()) as { order: string[] };
    expect(new Set(latest.order)).toEqual(new Set(created.slice(-2)));

    const olderResponse = await server.app.request(`/api/v4/channels/${channelId}/posts?before=${created[3]}&page=0&per_page=2`, { headers: bearer(token) });
    const older = (await olderResponse.json()) as { order: string[] };
    expect(new Set(older.order)).toEqual(new Set(created.slice(1, 3)));
    expect(older.order.some((id) => latest.order.includes(id))).toBe(false);

    const newerResponse = await server.app.request(`/api/v4/channels/${channelId}/posts?after=${created[1]}&page=0&per_page=2`, { headers: bearer(token) });
    const newer = (await newerResponse.json()) as { order: string[] };
    expect(new Set(newer.order)).toEqual(new Set(created.slice(2, 4)));

    const sinceResponse = await server.app.request(`/api/v4/channels/${channelId}/posts?since=${Date.now() + 60_000}&per_page=60`, { headers: bearer(token) });
    expect((await sinceResponse.json()) as { order: string[] }).toMatchObject({ order: [] });
  });

  it('exposes mobile role permissions that keep direct-message composers writable', async () => {
    const server = await createTestServer();
    const token = await login(server);
    const rolesResponse = await server.app.request('/api/v4/roles/names', {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify(['system_user', 'channel_user'])
    });
    expect(rolesResponse.status).toBe(200);
    const roles = (await rolesResponse.json()) as { name: string; permissions: string[] }[];
    expect(roles).toHaveLength(2);
    expect(roles.every((role) => role.permissions.includes('create_post'))).toBe(true);

    const admin = server.services.users.findByUsername('admin');
    const hermes = server.services.users.findByUsername('hermes');
    if (admin === null || hermes === null) throw new Error('missing DM participants');
    const dmResponse = await server.app.request('/api/v4/channels/direct', {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify([admin.id, hermes.id])
    });
    const dm = (await dmResponse.json()) as { id: string };
    await server.store.write((state) => {
      const legacyMember = state.channelMembers.find((member) => member.channelId === dm.id && member.userId === admin.id);
      if (legacyMember !== undefined) legacyMember.roles = '';
    });
    const memberResponse = await server.app.request(`/api/v4/channels/${dm.id}/members/${admin.id}`, {
      headers: bearer(token)
    });
    expect((await memberResponse.json()) as { roles: string }).toMatchObject({
      roles: 'channel_user'
    });

    await server.app.request('/api/v4/channels/direct', {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify([admin.id, hermes.id])
    });
    expect(server.services.channels.getMember(dm.id, admin.id).roles).toBe('channel_user');
  });

  it('supports admin lifecycle actions for deactivate, reactivate, reset password, and session revoke', async () => {
    const server = await createTestServer();
    const adminToken = await login(server);
    const user = await createInvitedUser(server, adminToken, 'lifecycleuser');

    const deactivate = await server.app.request(`/admin/users/${user.userId}/deactivate`, {
      method: 'POST',
      headers: bearer(adminToken)
    });
    expect(deactivate.status).toBe(200);
    const usersAfterDeactivate = await server.app.request('/admin/users', {
      headers: bearer(adminToken)
    });
    expect(((await usersAfterDeactivate.json()) as { id: string; delete_at: number }[]).find((item) => item.id === user.userId)?.delete_at).toBeGreaterThan(0);

    const reactivate = await server.app.request(`/admin/users/${user.userId}/reactivate`, {
      method: 'POST',
      headers: bearer(adminToken)
    });
    expect(reactivate.status).toBe(200);

    const reset = await server.app.request(`/admin/users/${user.userId}/reset-password`, {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify({ new_password: 'NewLifecyclePassword123!' })
    });
    expect(reset.status).toBe(200);
    const loginWithNewPassword = await server.app.request('/api/v4/users/login', {
      method: 'POST',
      headers: server.baseHeaders,
      body: JSON.stringify({ login_id: 'lifecycleuser', password: 'NewLifecyclePassword123!' })
    });
    expect(loginWithNewPassword.status).toBe(200);
    const userToken = loginWithNewPassword.headers.get('Token');
    expect(userToken).not.toBeNull();

    const revoke = await server.app.request(`/admin/users/${user.userId}/revoke-sessions`, {
      method: 'POST',
      headers: bearer(adminToken)
    });
    expect(revoke.status).toBe(200);
    const revokedMe = await server.app.request('/api/v4/users/me', {
      headers: bearer(userToken ?? '')
    });
    expect(revokedMe.status).toBe(401);
  });

  it('rotates Hermes bot token once and reports redacted health', async () => {
    const server = await createTestServer();
    const adminToken = await login(server);
    const bots = await server.app.request('/admin/bots', { headers: bearer(adminToken) });
    const bot = ((await bots.json()) as { user_id: string; token_configured: boolean }[])[0];
    expect(bot?.token_configured).toBe(true);
    if (bot === undefined) throw new Error('missing bot');

    const rotated = await server.app.request(`/admin/bots/${bot.user_id}/regenerate-token`, {
      method: 'POST',
      headers: bearer(adminToken)
    });
    expect(rotated.status).toBe(200);
    const rotatedBody = (await rotated.json()) as { operation_id: string; token: string };
    expect(rotated.headers.get('X-Operation-ID')).toBe(rotatedBody.operation_id);
    expect(rotatedBody.operation_id).toHaveLength(26);
    expect(rotatedBody.token).toHaveLength(43);
    const oldTokenMe = await server.app.request('/api/v4/users/me', {
      headers: bearer('test-hermes-token')
    });
    expect(oldTokenMe.status).toBe(401);
    const newTokenMe = await server.app.request('/api/v4/users/me', {
      headers: bearer(rotatedBody.token)
    });
    expect(newTokenMe.status).toBe(200);

    const health = await server.app.request('/admin/hermes/health', {
      headers: bearer(adminToken)
    });
    const healthBody = (await health.json()) as Record<string, unknown>;
    expect(healthBody).toMatchObject({ token_configured: true, bot_count: 1 });
    expect(JSON.stringify(healthBody)).not.toContain(rotatedBody.token);

    await server.services.auditLog.publishPending();
    const operation = await server.app.request(`/admin/bot-operations/${rotatedBody.operation_id}`, {
      headers: bearer(adminToken)
    });
    expect(operation.status).toBe(200);
    expect(await operation.json()).toMatchObject({
      operation_id: rotatedBody.operation_id,
      status: 'published',
      action: 'bot.token_regenerated',
      target_id: bot.user_id
    });
  });

  it('provisions hostname bot accounts with one-time tokens and default channel membership', async () => {
    const server = await createTestServer();
    const adminToken = await login(server);
    const created = await server.app.request('/admin/bots', {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify({ username: 'archie', display_name: 'Hermes Agent on archie' })
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      operation_id: string;
      token: string;
      user: { id: string; username: string; is_bot: boolean };
    };
    expect(body.user).toMatchObject({ username: 'archie', is_bot: true });
    expect(body.token).toHaveLength(43);
    expect(body.operation_id).toHaveLength(26);
    expect(created.headers.get('X-Operation-ID')).toBe(body.operation_id);
    await server.services.auditLog.publishPending();
    expect(server.services.auditLog.list().find((entry) => entry.action === 'bot.created' && entry.targetId === body.user.id)).toMatchObject({
      metadata: { parent_operation_id: body.operation_id }
    });

    const me = await server.app.request('/api/v4/users/me', { headers: bearer(body.token) });
    expect(me.status).toBe(200);
    expect((await me.json()) as { username: string }).toMatchObject({ username: 'archie' });
    const channels = await server.app.request('/api/v4/users/me/channels', {
      headers: bearer(body.token)
    });
    expect(((await channels.json()) as unknown[]).length).toBeGreaterThanOrEqual(2);

    const reprovisioned = await server.app.request('/admin/bots', {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify({ username: 'archie', display_name: 'Archie Hermes' })
    });
    expect(reprovisioned.status).toBe(201);
    const next = (await reprovisioned.json()) as { token: string; user: { id: string } };
    expect(next.user.id).toBe(body.user.id);
    expect(next.token).not.toBe(body.token);
    expect((await server.app.request('/api/v4/users/me', { headers: bearer(body.token) })).status).toBe(401);
    expect((await server.app.request('/api/v4/users/me', { headers: bearer(next.token) })).status).toBe(200);
    await server.services.auditLog.publishPending();
    expect(server.services.auditLog.list().filter((entry) => entry.action === 'bot.created' && entry.targetId === body.user.id)).toHaveLength(1);
  });

  it('renames a bot identity and synthetic email away and back without rotating its token or replacing its user', async () => {
    const server = await createTestServer();
    const adminToken = await login(server);
    const created = await server.app.request('/admin/bots', {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify({ username: 'old-player', display_name: 'Old Player' })
    });
    expect(created.status).toBe(201);
    const original = (await created.json()) as {
      token: string;
      user: { id: string };
    };
    const admin = server.services.users.findByUsername('admin');
    if (admin === null) throw new Error('missing admin');
    const frames: string[] = [];
    const connected = server.services.hub.attach({ send: (payload) => frames.push(payload) }, admin.id);
    frames.length = 0;

    const renamed = await server.app.request(`/admin/bots/${original.user.id}`, {
      method: 'PUT',
      headers: bearer(adminToken),
      body: JSON.stringify({ username: 'orris-mott', display_name: 'Orris Mott' })
    });
    expect(renamed.status).toBe(200);
    const renamedBody = (await renamed.json()) as {
      operation_id: string;
      user: { id: string; username: string; nickname: string };
      bot: { user_id: string; display_name: string };
    };
    expect(renamed.headers.get('X-Operation-ID')).toBe(renamedBody.operation_id);
    expect(renamedBody).toMatchObject({
      user: { id: original.user.id, username: 'orris-mott', nickname: 'Orris Mott' },
      bot: { user_id: original.user.id, display_name: 'Orris Mott' }
    });
    expect(server.store.read((state) => state.users.find((candidate) => candidate.id === original.user.id)?.email)).toBe('orris-mott@bot.localhost');
    expect(frames.map((payload) => JSON.parse(payload) as { event?: string; data?: { user_id?: string } })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'user_updated',
          data: { user_id: original.user.id }
        })
      ])
    );

    const me = await server.app.request('/api/v4/users/me', { headers: bearer(original.token) });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      id: original.user.id,
      username: 'orris-mott',
      nickname: 'Orris Mott'
    });

    const renamedBack = await server.app.request(`/admin/bots/${original.user.id}`, {
      method: 'PUT',
      headers: bearer(adminToken),
      body: JSON.stringify({ username: 'old-player', display_name: 'Old Player Restored' })
    });
    expect(renamedBack.status).toBe(200);
    expect(server.store.read((state) => state.users.find((candidate) => candidate.id === original.user.id)?.email)).toBe('old-player@bot.localhost');

    const renamedAwayAgain = await server.app.request(`/admin/bots/${original.user.id}`, {
      method: 'PUT',
      headers: bearer(adminToken),
      body: JSON.stringify({ username: 'orris-mott', display_name: 'Orris Mott' })
    });
    expect(renamedAwayAgain.status).toBe(200);
    const reused = await server.app.request('/admin/bots', {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify({ username: 'old-player', display_name: 'New Old Player' })
    });
    expect(reused.status).toBe(201);
    expect(await reused.json()).toMatchObject({ user: { username: 'old-player' } });
    server.services.hub.detach(connected.id);
  });

  it('preserves external bot email and rejects synthetic email conflicts before rename acceptance', async () => {
    const server = await createTestServer();
    const adminToken = await login(server);
    const created = await server.app.request('/admin/bots', {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify({ username: 'email-source', display_name: 'Email Source' })
    });
    const bot = (await created.json()) as { user: { id: string } };
    await server.store.write((state) => {
      const user = state.users.find((candidate) => candidate.id === bot.user.id);
      if (user !== undefined) user.email = 'managed@example.test';
    });
    const externalRename = await server.app.request(`/admin/bots/${bot.user.id}`, {
      method: 'PUT',
      headers: bearer(adminToken),
      body: JSON.stringify({ username: 'external-email', display_name: 'External Email' })
    });
    expect(externalRename.status).toBe(200);
    expect(server.store.read((state) => state.users.find((candidate) => candidate.id === bot.user.id)?.email)).toBe('managed@example.test');

    const claimed = await server.app.request('/admin/users', {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify({
        username: 'email-owner',
        email: 'claimed-name@bot.localhost',
        password: 'ClaimedPassword123!'
      })
    });
    expect(claimed.status).toBe(201);
    await server.store.write((state) => {
      const user = state.users.find((candidate) => candidate.id === bot.user.id);
      if (user !== undefined) user.email = 'email-source@bot.localhost';
    });
    const admin = server.services.users.findByUsername('admin');
    if (admin === null) throw new Error('missing admin');
    const frames: string[] = [];
    const connected = server.services.hub.attach({ send: (payload) => frames.push(payload) }, admin.id);
    frames.length = 0;
    const conflict = await server.app.request(`/admin/bots/${bot.user.id}`, {
      method: 'PUT',
      headers: bearer(adminToken),
      body: JSON.stringify({ username: 'claimed-name', display_name: 'Claimed Name' })
    });
    expect(conflict.status).toBe(409);
    expect(frames).toHaveLength(0);
    expect(server.store.read((state) => {
      const user = state.users.find((candidate) => candidate.id === bot.user.id);
      return { username: user?.username, email: user?.email };
    })).toEqual({ username: 'external-email', email: 'email-source@bot.localhost' });
    server.services.hub.detach(connected.id);
  });

  it('keeps accepted bot token mutations reconcilable when audit publication fails', async () => {
    const server = await createTestServer();
    const adminToken = await login(server);
    await server.services.auditLog.publishPending();
    const bots = await server.app.request('/admin/bots', { headers: bearer(adminToken) });
    const bot = ((await bots.json()) as { user_id: string }[])[0];
    if (bot === undefined) throw new Error('missing bot');
    const publish = vi.spyOn(server.services.auditLog, 'publishPending').mockRejectedValueOnce(new Error('simulated audit persistence failure'));

    const rotated = await server.app.request(`/admin/bots/${bot.user_id}/regenerate-token`, {
      method: 'POST',
      headers: bearer(adminToken)
    });
    expect(rotated.status).toBe(200);
    const body = (await rotated.json()) as { operation_id: string; token: string };
    expect((await server.app.request('/api/v4/users/me', { headers: bearer(body.token) })).status).toBe(200);
    expect(server.store.read((state) => state.auditOutbox.find((event) => event.operationId === body.operation_id)?.publishedAt)).toBe(0);
    expect(server.services.auditLog.list().some((entry) => entry.id === body.operation_id)).toBe(false);

    const accepted = await server.app.request(`/admin/bot-operations/${body.operation_id}`, {
      headers: bearer(adminToken)
    });
    expect(await accepted.json()).toMatchObject({ status: 'accepted' });

    publish.mockRestore();
    await server.services.auditLog.publishPending();
    const published = await server.app.request(`/admin/bot-operations/${body.operation_id}`, {
      headers: bearer(adminToken)
    });
    expect(await published.json()).toMatchObject({ status: 'published' });
    expect(server.services.auditLog.list().find((entry) => entry.id === body.operation_id)).toMatchObject({
      action: 'bot.token_regenerated',
      targetId: bot.user_id,
      metadata: { operation_id: body.operation_id }
    });
  });

  it('lets admins manage custom emoji while users can list active entries', async () => {
    const server = await createTestServer();
    const adminToken = await login(server);
    const created = await server.app.request('/admin/custom-emoji', {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify({ name: 'ship_it', emoji: '🚢' })
    });
    expect(created.status).toBe(201);
    const emoji = (await created.json()) as { id: string; name: string; emoji: string };
    expect(emoji).toMatchObject({ name: 'ship_it', emoji: '🚢' });

    const listed = await server.app.request('/api/v4/emoji', { headers: bearer(adminToken) });
    expect((await listed.json()) as { name: string }[]).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'ship_it', emoji: '🚢' })]));

    const deleted = await server.app.request(`/admin/custom-emoji/${emoji.id}`, {
      method: 'DELETE',
      headers: bearer(adminToken)
    });
    expect(deleted.status).toBe(200);
    const afterDelete = await server.app.request('/api/v4/emoji', { headers: bearer(adminToken) });
    expect((await afterDelete.json()) as { name: string }[]).toHaveLength(0);
  });

  it('previews and applies test artifact cleanup only with confirmation', async () => {
    const server = await createTestServer();
    const adminToken = await login(server);
    const teamResponse = await server.app.request('/api/v4/users/me/teams', {
      headers: bearer(adminToken)
    });
    const team = ((await teamResponse.json()) as { id: string }[])[0];
    if (team === undefined) throw new Error('missing team');
    const testotron = await createInvitedUser(server, adminToken, 'testotron-cleanup');
    const channelResponse = await server.app.request('/api/v4/channels', {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify({
        team_id: team.id,
        name: 'test-cleanup',
        display_name: 'Test Cleanup',
        type: 'O'
      })
    });
    const channel = (await channelResponse.json()) as { id: string };

    const preview = await server.app.request('/admin/test-artifacts/cleanup', {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify({
        dry_run: true,
        username_prefix: 'testotron-',
        channel_name_prefix: 'Test'
      })
    });
    expect((await preview.json()) as Record<string, unknown>).toMatchObject({
      dry_run: true,
      matched_user_count: 1,
      matched_channel_count: 1
    });

    const blocked = await server.app.request('/admin/test-artifacts/cleanup', {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify({
        dry_run: false,
        username_prefix: 'testotron-',
        channel_name_prefix: 'Test'
      })
    });
    expect(blocked.status).toBe(400);

    const applied = await server.app.request('/admin/test-artifacts/cleanup', {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify({
        dry_run: false,
        username_prefix: 'testotron-',
        channel_name_prefix: 'Test',
        confirm: 'cleanup test artifacts'
      })
    });
    expect((await applied.json()) as Record<string, unknown>).toMatchObject({
      dry_run: false,
      cleaned_user_count: 1,
      cleaned_channel_count: 1
    });
    expect(server.services.users.findById(testotron.userId)?.deleteAt).toBeGreaterThan(0);
    expect(server.store.read((state) => state.channels.find((item) => item.id === channel.id)?.deleteAt ?? 0)).toBeGreaterThan(0);
  });
});

function peer(remoteAddress: string): { incoming: { socket: { remoteAddress: string } } } {
  return { incoming: { socket: { remoteAddress } } };
}

describe('Hermes slash commands', () => {
  it('forwards a native command as exactly one user-authored DM post and websocket event', async () => {
    const server = await createTestServer();
    const token = await login(server);
    const admin = server.services.users.findByUsername('admin');
    const hermes = server.services.users.findByUsername('hermes');
    if (admin === null || hermes === null) throw new Error('missing DM participants');
    const direct = await server.app.request('/api/v4/channels/direct', {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify([hermes.id])
    });
    const channel = (await direct.json()) as { id: string };
    const sent: string[] = [];
    const connection = server.services.hub.attach({ send: (payload) => sent.push(payload) }, hermes.id);
    sent.length = 0;

    const response = await server.app.request('/api/v4/commands/execute', {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify({ channel_id: channel.id, command: '/status' })
    });
    expect(response.status).toBe(200);
    const commandResponse = (await response.json()) as { response_type: string; text: string; post_id: string; create_at: number };
    expect(commandResponse).toMatchObject({ response_type: 'in_channel', text: '' });
    expect(commandResponse.post_id).toMatch(/^[a-z0-9]{26}$/u);
    expect(commandResponse.create_at).toBeGreaterThan(0);
    const posts = server.services.posts.listChannelPosts(channel.id, admin);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ userId: admin.id, message: '/status' });
    const postedFrames = sent
      .map((payload) => JSON.parse(payload) as { event?: string; data?: { post?: string; channel_type?: string } })
      .filter((frame) => frame.event === 'posted');
    expect(postedFrames).toHaveLength(1);
    expect(postedFrames[0]?.data?.channel_type).toBe('D');
    expect(JSON.parse(postedFrames[0]?.data?.post ?? '{}')).toMatchObject({ user_id: admin.id, message: '/status' });
    server.services.hub.detach(connection.id);
  });

  it('auto-targets a sole bot outside DMs and requires one explicit target with multiple bots', async () => {
    const server = await createTestServer();
    const token = await login(server);
    const admin = server.services.users.findByUsername('admin');
    const hermes = server.services.users.findByUsername('hermes');
    if (admin === null || hermes === null) throw new Error('missing command participants');
    const publicChannelId = await firstChannelId(server.app, token);

    const singleBotResponse = await server.app.request('/api/v4/commands/execute', {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify({ channel_id: publicChannelId, command: '/status' })
    });
    expect(singleBotResponse.status).toBe(200);
    expect(server.services.posts.listChannelPosts(publicChannelId, admin).at(-1)?.message).toBe('/status @hermes');

    const secondBot = await server.services.users.createUser({
      username: 'secondbot',
      email: 'secondbot@example.test',
      password: 'SecondBotPassword123!',
      role: 'system_user',
      actorUserId: admin.id,
      isBot: true,
      botDescription: 'Second bot'
    });
    const teammate = await createInvitedUser(server, token, 'commandteammate');
    const group = await server.services.channels.direct([hermes.id, secondBot.id, teammate.userId], admin.id);

    const ambiguous = await server.app.request('/api/v4/commands/execute', {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify({ channel_id: group.id, command: '/status' })
    });
    expect(ambiguous.status).toBe(400);
    expect((await ambiguous.json()) as Record<string, unknown>).toMatchObject({
      message: 'Mention exactly one bot when using a slash command in a conversation with multiple bots'
    });
    expect(server.services.posts.listChannelPosts(group.id, admin)).toHaveLength(0);

    const targeted = await server.app.request('/api/v4/commands/execute', {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify({ channel_id: group.id, command: '/status @secondbot' })
    });
    expect(targeted.status).toBe(200);
    expect(server.services.posts.listChannelPosts(group.id, admin)).toHaveLength(1);
    expect(server.services.posts.listChannelPosts(group.id, admin)[0]?.message).toBe('/status @secondbot');

    const outsideTarget = await server.app.request('/api/v4/commands/execute', {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify({ channel_id: publicChannelId, command: '/status @secondbot' })
    });
    expect(outsideTarget.status).toBe(400);
    expect((await outsideTarget.json()) as Record<string, unknown>).toMatchObject({
      message: 'Bot @secondbot is not a member of this conversation'
    });
  });

  it('rejects non-bot conversations and command attempts by non-members', async () => {
    const server = await createTestServer();
    const token = await login(server);
    const admin = server.services.users.findByUsername('admin');
    const hermes = server.services.users.findByUsername('hermes');
    if (admin === null || hermes === null) throw new Error('missing command participants');
    const alice = await createInvitedUser(server, token, 'commandalice');
    const bob = await createInvitedUser(server, token, 'commandbob');
    const humanDm = await server.services.channels.direct([alice.userId], admin.id);
    const noBot = await server.app.request('/api/v4/commands/execute', {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify({ channel_id: humanDm.id, command: '/status' })
    });
    expect(noBot.status).toBe(400);

    const botDm = await server.services.channels.direct([hermes.id], admin.id);
    const outsider = await server.app.request('/api/v4/commands/execute', {
      method: 'POST',
      headers: bearer(bob.token),
      body: JSON.stringify({ channel_id: botDm.id, command: '/status' })
    });
    expect(outsider.status).toBe(404);
    expect(server.services.posts.listChannelPosts(botDm.id, admin)).toHaveLength(0);
  });

  it('rejects custom command creation and unknown triggers without creating a post', async () => {
    const server = await createTestServer();
    const token = await login(server);
    const admin = server.services.users.findByUsername('admin');
    const hermes = server.services.users.findByUsername('hermes');
    const teamId = server.services.teams.defaultTeamIds()[0];
    if (admin === null || hermes === null || teamId === undefined) throw new Error('missing command participants');
    const channel = await server.services.channels.direct([hermes.id], admin.id);

    const createResponse = await server.app.request('/api/v4/commands', {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify({
        team_id: teamId,
        trigger: 'deploy',
        url: 'https://integration.example.test/command',
        method: 'POST',
        description: 'Deploy integration'
      })
    });
    expect(createResponse.status).toBe(400);
    expect((await createResponse.json()) as Record<string, unknown>).toMatchObject({
      message: 'Custom slash commands are not supported'
    });

    const executeResponse = await server.app.request('/api/v4/commands/execute', {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify({ channel_id: channel.id, command: '/deploy production secret-argument' })
    });
    expect(executeResponse.status).toBe(400);
    expect((await executeResponse.json()) as Record<string, unknown>).toMatchObject({
      message: 'Unknown slash command /deploy'
    });
    expect(server.services.posts.listChannelPosts(channel.id, admin)).toHaveLength(0);
  });

  it('supports correlated command execution in an existing thread', async () => {
    const server = await createTestServer();
    const token = await login(server);
    const admin = server.services.users.findByUsername('admin');
    const hermes = server.services.users.findByUsername('hermes');
    if (admin === null || hermes === null) throw new Error('missing command participants');
    const channel = await server.services.channels.direct([hermes.id], admin.id);
    const root = await server.services.posts.createPost({ actor: admin, channelId: channel.id, message: 'smoke root' });

    const response = await server.app.request('/api/v4/commands/execute', {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify({ channel_id: channel.id, command: '/status', root_id: root.id })
    });
    expect(response.status).toBe(200);
    const result = (await response.json()) as { post_id: string };
    expect(server.services.posts.getPost(result.post_id)).toMatchObject({ rootId: root.id, message: '/status' });
  });

  it('returns Mattermost-compatible command definitions and autocomplete suggestions', async () => {
    const server = await createTestServer();
    const token = await login(server);
    const teamId = server.services.teams.defaultTeamIds()[0];
    if (teamId === undefined) throw new Error('missing default team');
    const commandsResponse = await server.app.request(`/api/v4/commands?team_id=${teamId}`, { headers: bearer(token) });
    expect(commandsResponse.status).toBe(200);
    const commands = (await commandsResponse.json()) as Record<string, unknown>[];
    const model = commands.find((command) => command.trigger === 'model');
    const arxiv = commands.find((command) => command.trigger === 'arxiv');
    expect(commands.some((command) => command.trigger === 'tasks')).toBe(true);
    expect(commands.some((command) => command.trigger === 'sources')).toBe(true);
    expect(model).toMatchObject({
      team_id: teamId,
      trigger: 'model',
      auto_complete: true,
      auto_complete_desc: 'Show or switch the session model',
      auto_complete_hint: '[provider:model]',
      plugin_id: 'hermes-agent'
    });
    expect(model).not.toHaveProperty('teamId');
    expect(arxiv).toMatchObject({
      team_id: teamId,
      trigger: 'arxiv',
      auto_complete_hint: '<prompt>',
      plugin_id: 'hermes-agent'
    });

    const suggestionsResponse = await server.app.request(
      `/api/v4/teams/${teamId}/commands/autocomplete_suggestions?user_input=${encodeURIComponent('/res')}`,
      { headers: bearer(token) }
    );
    expect(suggestionsResponse.status).toBe(200);
    expect(await suggestionsResponse.json()).toEqual([
      {
        Complete: '/reset',
        Suggestion: 'reset',
        Hint: '[now]',
        Description: 'Reset the current Hermes conversation',
        IconData: ''
      },
      {
        Complete: '/resume',
        Suggestion: 'resume',
        Hint: '[name]',
        Description: 'Resume a named Hermes session',
        IconData: ''
      }
    ]);
  });
});

describe('WebSocket protocol', () => {
  it('emits Mattermost-compatible direct-message post payloads', async () => {
    const server = await createTestServer();
    const adminToken = await login(server);
    const admin = server.services.users.findByUsername('admin');
    const hermes = server.services.users.findByUsername('hermes');
    expect(admin).not.toBeNull();
    expect(hermes).not.toBeNull();
    if (admin === null || hermes === null) {
      return;
    }
    const direct = await server.app.request('/api/v4/channels/direct', {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify([admin.id, hermes.id])
    });
    expect([200, 201]).toContain(direct.status);
    const channel = (await direct.json()) as { id: string };
    const sent: string[] = [];
    const connection = server.services.hub.attach({ send: (payload) => sent.push(payload) }, hermes.id);
    const postResponse = await server.app.request('/api/v4/posts', {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify({ channel_id: channel.id, message: 'hello hermes' })
    });
    expect(postResponse.status).toBe(201);

    const posted = sent.map((payload) => JSON.parse(payload) as { event?: string; data?: Record<string, unknown> }).find((payload) => payload.event === 'posted');
    expect(posted?.data?.channel_type).toBe('D');
    const post = JSON.parse(String(posted?.data?.post)) as {
      channel_id?: string;
      user_id?: string;
      file_ids?: string[];
    };
    expect(post.channel_id).toBe(channel.id);
    expect(post.user_id).toBe(admin.id);
    expect(post.file_ids).toEqual([]);
    server.services.hub.detach(connection.id);
  });

  it('emits Mattermost-compatible events and response frames', async () => {
    const store = new JsonStore(null);
    await store.initialize();
    const hub = new WebSocketHub(store);
    const sent: string[] = [];
    const connection = hub.attach({ send: (payload) => sent.push(payload) }, 'user-a');
    await hub.broadcast('posted', { channel_id: 'channel-a', post: '{}' }, { user_id: 'user-a' });
    expect(sent.some((payload) => parseEvent(payload) === 'hello')).toBe(true);
    expect(sent.some((payload) => parseEvent(payload) === 'posted')).toBe(true);
    hub.detach(connection.id);
  });

  it('isolates a failed WebSocket client without interrupting healthy fanout', async () => {
    const store = new JsonStore(null);
    await store.initialize();
    const hub = new WebSocketHub(store);
    const healthyFrames: string[] = [];
    let failedSends = 0;
    hub.attach(
      {
        send: () => {
          failedSends += 1;
          if (failedSends > 1) throw new Error('socket closed');
        }
      },
      'broken-user'
    );
    hub.attach({ send: (payload) => healthyFrames.push(payload) }, 'healthy-user');

    await expect(hub.broadcast('notice', {}, {})).resolves.toBeUndefined();
    expect(healthyFrames.some((payload) => parseEvent(payload) === 'notice')).toBe(true);
    expect(hub.connectionCount()).toBe(1);
  });

  it('keeps Mattermost-compatible mobile WebSockets alive with an authenticated pong response', async () => {
    const server = await createTestServer();
    const token = await login(server);
    const sent: string[] = [];
    const connection = server.services.hub.attach({ send: (payload) => sent.push(payload) }, null);

    await server.services.hub.handleClientMessage(connection.id, JSON.stringify({ action: 'authentication_challenge', seq: 1, data: { token } }), (candidate) => server.services.sessions.authenticateToken(candidate), server.services.statuses);
    await server.services.hub.handleClientMessage(connection.id, JSON.stringify({ action: 'ping', seq: 2 }), (candidate) => server.services.sessions.authenticateToken(candidate), server.services.statuses);

    const frames = sent.map((payload) => JSON.parse(payload) as Record<string, unknown>);
    expect(frames[0]).toMatchObject({ event: 'hello', seq: 0 });
    expect(frames[1]).toEqual({ status: 'OK', seq_reply: 1 });
    const pong = frames.find((frame) => frame.seq_reply === 2);
    expect(pong).toMatchObject({
      status: 'OK',
      seq_reply: 2,
      data: { text: 'pong', version: '11.8.0' }
    });
    server.services.hub.detach(connection.id);
  });

  it('keeps server event sequences contiguous per WebSocket connection and restartable at zero', async () => {
    const store = new JsonStore(null);
    await store.initialize();
    const hub = new WebSocketHub(store);
    const userAFrames: string[] = [];
    const userBFrames: string[] = [];
    const userA = hub.attach({ send: (payload) => userAFrames.push(payload) }, 'user-a');
    const userB = hub.attach({ send: (payload) => userBFrames.push(payload) }, 'user-b');

    await hub.broadcast('user_a_only', {}, { user_id: 'user-a' });
    await hub.broadcast('user_b_only', {}, { user_id: 'user-b' });
    await hub.broadcast('everyone', {}, {});

    const eventSequences = (frames: string[]) =>
      frames
        .map((payload) => JSON.parse(payload) as { event?: string; seq?: number })
        .filter((frame) => frame.event !== undefined)
        .map((frame) => frame.seq);
    expect(eventSequences(userAFrames)).toEqual([0, 1, 2]);
    expect(eventSequences(userBFrames)).toEqual([0, 1, 2]);

    hub.detach(userA.id);
    const reconnectFrames: string[] = [];
    const reconnect = hub.attach({ send: (payload) => reconnectFrames.push(payload) }, 'user-a', {
      connectionId: userA.id,
      eventSeq: 3
    });
    expect(reconnect.id).toBe(userA.id);
    expect(eventSequences(reconnectFrames)).toEqual([3]);

    const collisionFrames: string[] = [];
    const collision = hub.attach({ send: (payload) => collisionFrames.push(payload) }, 'user-a', {
      connectionId: reconnect.id,
      eventSeq: 4
    });
    expect(collision.id).not.toBe(reconnect.id);
    expect(eventSequences(collisionFrames)).toEqual([0]);

    hub.detach(userB.id);
    hub.detach(reconnect.id);
    hub.detach(collision.id);
  });

  it('does not send a duplicate hello when a bearer-authenticated socket repeats its auth challenge', async () => {
    const server = await createTestServer();
    const token = await login(server);
    const admin = server.services.users.findByUsername('admin');
    if (admin === null) throw new Error('missing admin');
    const sent: string[] = [];
    const connection = server.services.hub.attach({ send: (payload) => sent.push(payload) }, admin.id);

    await server.services.hub.handleClientMessage(connection.id, JSON.stringify({ action: 'authentication_challenge', seq: 1, data: { token } }), (candidate) => server.services.sessions.authenticateToken(candidate), server.services.statuses);

    const frames = sent.map((payload) => JSON.parse(payload) as { event?: string; seq?: number });
    expect(frames.filter((frame) => frame.event === 'hello')).toHaveLength(1);
    expect(frames.find((frame) => frame.event === 'hello')?.seq).toBe(0);
    server.services.hub.detach(connection.id);
  });

  it('emits snake_case payloads for posts, threads, reactions, typing, and status changes', async () => {
    const server = await createTestServer();
    const adminToken = await login(server);
    const admin = server.services.users.findByUsername('admin');
    const hermes = server.services.users.findByUsername('hermes');
    if (admin === null) throw new Error('missing admin');
    if (hermes === null) throw new Error('missing hermes');
    const channelId = await firstChannelId(server.app, adminToken);
    const sent: string[] = [];
    const connection = server.services.hub.attach({ send: (payload) => sent.push(payload) }, admin.id);
    const peerConnection = server.services.hub.attach({ send: (payload) => sent.push(payload) }, hermes.id);

    const postResponse = await server.app.request('/api/v4/posts', {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify({ channel_id: channelId, message: 'root for realtime' })
    });
    const post = (await postResponse.json()) as { id: string };
    await server.app.request('/api/v4/posts', {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify({
        channel_id: channelId,
        root_id: post.id,
        message: 'reply for realtime'
      })
    });
    await server.app.request('/api/v4/reactions', {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify({ post_id: post.id, emoji_name: 'white_check_mark' })
    });
    await server.app.request(`/api/v4/users/${admin.id}/typing`, {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify({ channel_id: channelId })
    });
    await server.app.request(`/api/v4/users/${admin.id}/status`, {
      method: 'PUT',
      headers: bearer(adminToken),
      body: JSON.stringify({ status: 'away' })
    });

    const frames = sent.map((payload) => JSON.parse(payload) as { event?: string; data?: Record<string, unknown> });
    const posted = frames.find((frame) => frame.event === 'posted');
    const postedPost = JSON.parse(String(posted?.data?.post)) as Record<string, unknown>;
    expect(posted?.data).toMatchObject({
      channel_id: channelId,
      channel_type: 'O',
      sender_name: 'admin'
    });
    expect(postedPost).toHaveProperty('channel_id', channelId);
    expect(postedPost).toHaveProperty('file_ids');

    const thread = frames.find((frame) => frame.event === 'thread_updated');
    expect(thread?.data).toMatchObject({ root_id: post.id });

    const reaction = frames.find((frame) => frame.event === 'reaction_added');
    expect(reaction?.data?.reaction).toMatchObject({
      user_id: admin.id,
      post_id: post.id,
      emoji_name: 'white_check_mark'
    });
    expect(reaction?.data?.reaction).not.toHaveProperty('emojiName');

    const typing = frames.find((frame) => frame.event === 'typing');
    expect(typing?.data).toMatchObject({
      user_id: admin.id,
      channel_id: channelId,
      parent_id: '',
      sender_name: 'admin',
      is_bot: false
    });

    const status = frames.find((frame) => frame.event === 'status_change');
    expect(status?.data).toMatchObject({ user_id: admin.id, status: 'away' });
    server.services.hub.detach(connection.id);
    server.services.hub.detach(peerConnection.id);
  });

  it('rejects typing events that spoof another user or target a channel outside the caller membership', async () => {
    const server = await createTestServer();
    const adminToken = await login(server);
    const admin = server.services.users.findByUsername('admin');
    const hermes = server.services.users.findByUsername('hermes');
    if (admin === null) throw new Error('missing admin');
    if (hermes === null) throw new Error('missing hermes');
    const mallory = await createInvitedUser(server, adminToken, 'typingmallory');
    const teamsResponse = await server.app.request('/api/v4/users/me/teams', {
      headers: bearer(adminToken)
    });
    const team = ((await teamsResponse.json()) as { id: string }[])[0];
    if (team === undefined) throw new Error('missing team');
    const channelResponse = await server.app.request('/api/v4/channels', {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify({
        team_id: team.id,
        name: 'typing-private',
        display_name: 'Typing Private',
        type: 'P'
      })
    });
    expect(channelResponse.status).toBe(201);
    const channel = (await channelResponse.json()) as { id: string };
    const sent: string[] = [];
    const connection = server.services.hub.attach({ send: (payload) => sent.push(payload) }, admin.id);

    const spoofedBotTyping = await server.app.request(`/api/v4/users/${hermes.id}/typing`, {
      method: 'POST',
      headers: bearer(mallory.token),
      body: JSON.stringify({ channel_id: channel.id })
    });
    expect(spoofedBotTyping.status).toBe(403);

    const nonMemberTyping = await server.app.request(`/api/v4/users/${mallory.userId}/typing`, {
      method: 'POST',
      headers: bearer(mallory.token),
      body: JSON.stringify({ channel_id: channel.id })
    });
    expect(nonMemberTyping.status).toBe(404);
    expect(sent.map((payload) => JSON.parse(payload) as { event?: string }).some((frame) => frame.event === 'typing')).toBe(false);
    server.services.hub.detach(connection.id);
  });
});

function parseEvent(payload: string): string | undefined {
  const parsed = JSON.parse(payload) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const event = (parsed as { event?: unknown }).event;
  return typeof event === 'string' ? event : undefined;
}

async function createInvitedUser(server: Awaited<ReturnType<typeof createTestServer>>, adminToken: string, username: string): Promise<{ token: string; userId: string }> {
  const inviteResponse = await server.app.request('/admin/invites', {
    method: 'POST',
    headers: bearer(adminToken),
    body: JSON.stringify({ max_uses: 1, expires_in_hours: 12 })
  });
  expect(inviteResponse.status).toBe(201);
  const invite = (await inviteResponse.json()) as { code: string };
  const signup = await server.app.request('/api/v4/users', {
    method: 'POST',
    headers: server.baseHeaders,
    body: JSON.stringify({
      invite_code: invite.code,
      username,
      email: `${username}@example.test`,
      password: `${username}Password123!`
    })
  });
  expect(signup.status).toBe(201);
  const user = (await signup.json()) as { id: string };
  const loginResponse = await server.app.request('/api/v4/users/login', {
    method: 'POST',
    headers: server.baseHeaders,
    body: JSON.stringify({ login_id: username, password: `${username}Password123!` })
  });
  const token = loginResponse.headers.get('Token');
  if (token === null) {
    throw new Error('missing token');
  }
  return { token, userId: user.id };
}
