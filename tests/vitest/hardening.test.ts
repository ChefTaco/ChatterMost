import { describe, expect, it } from 'vitest';

import { createId, nowMs } from '../../src/shared/mattermost.js';
import { bearer, createTestServer, firstChannelId, login, type TestServer } from './helpers.js';

async function createMember(server: TestServer, adminToken: string, username: string): Promise<{ token: string; userId: string; password: string }> {
  const password = `${username}Password123!`;
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
    body: JSON.stringify({ invite_code: invite.code, username, email: `${username}@example.test`, password })
  });
  expect(signup.status).toBe(201);
  const user = (await signup.json()) as { id: string };
  const loginResponse = await server.app.request('/api/v4/users/login', {
    method: 'POST',
    headers: server.baseHeaders,
    body: JSON.stringify({ login_id: username, password })
  });
  const token = loginResponse.headers.get('Token');
  if (token === null) {
    throw new Error('missing token');
  }
  return { token, userId: user.id, password };
}

describe('Security and correctness hardening', () => {
  it('does not disclose account or hidden email existence through discovery endpoints', async () => {
    const server = await createTestServer();
    const adminToken = await login(server);
    const member = await createMember(server, adminToken, 'privacyprobe');

    const existingType = await server.app.request('/api/v4/users/login/type', {
      method: 'POST',
      headers: server.baseHeaders,
      body: JSON.stringify({ login_id: 'privacyprobe@example.test' })
    });
    const missingType = await server.app.request('/api/v4/users/login/type', {
      method: 'POST',
      headers: server.baseHeaders,
      body: JSON.stringify({ login_id: 'absent@example.test' })
    });
    const existingBody = (await existingType.json()) as Record<string, unknown>;
    const missingBody = (await missingType.json()) as Record<string, unknown>;
    expect({ ...existingBody, login_id: '<normalized>' }).toEqual({
      ...missingBody,
      login_id: '<normalized>'
    });

    const hiddenSearch = await server.app.request('/api/v4/users/search', {
      method: 'POST',
      headers: bearer(member.token),
      body: JSON.stringify({ term: 'admin@example.test' })
    });
    expect(await hiddenSearch.json()).toEqual([]);
    const hiddenLookup = await server.app.request('/api/v4/users/email/admin@example.test', {
      headers: bearer(member.token)
    });
    expect(hiddenLookup.status).toBe(404);

    const adminSearch = await server.app.request('/api/v4/users/search', {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify({ term: 'privacyprobe@example.test' })
    });
    expect((await adminSearch.json()) as { id: string }[]).toContainEqual(
      expect.objectContaining({ id: member.userId })
    );
  });

  it('revokes every owned credential and webhook when an account is deactivated', async () => {
    const server = await createTestServer();
    const adminToken = await login(server);
    const created = await server.app.request('/admin/users', {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify({
        username: 'disabledadmin',
        email: 'disabledadmin@example.test',
        password: 'DisabledAdminPassword123!',
        role: 'system_admin system_user'
      })
    });
    const createdUser = (await created.json()) as { id: string };
    const loginResponse = await server.app.request('/api/v4/users/login', {
      method: 'POST',
      headers: server.baseHeaders,
      body: JSON.stringify({ login_id: 'disabledadmin', password: 'DisabledAdminPassword123!' })
    });
    const sessionToken = loginResponse.headers.get('Token');
    if (sessionToken === null) throw new Error('missing disabled admin session');
    const disabledAdmin = server.services.users.getById(createdUser.id);
    const personalToken = await server.services.sessions.createPersonalAccessToken(
      createdUser.id,
      'deactivation regression',
      disabledAdmin
    );
    const channelId = await firstChannelId(server.app, sessionToken);
    const webhookResponse = await server.app.request('/api/v4/webhooks/incoming', {
      method: 'POST',
      headers: bearer(sessionToken),
      body: JSON.stringify({ channel_id: channelId, label: 'disabled owner' })
    });
    const webhook = (await webhookResponse.json()) as { id: string; secret: string };

    const deactivate = await server.app.request(`/admin/users/${createdUser.id}/deactivate`, {
      method: 'POST',
      headers: bearer(adminToken)
    });
    expect(deactivate.status).toBe(200);
    const reactivate = await server.app.request(`/admin/users/${createdUser.id}/reactivate`, {
      method: 'POST',
      headers: bearer(adminToken)
    });
    expect(reactivate.status).toBe(200);

    for (const token of [sessionToken, personalToken.token]) {
      const me = await server.app.request('/api/v4/users/me', { headers: bearer(token) });
      expect(me.status).toBe(401);
    }
    const webhookPost = await server.app.request(
      `/api/v4/webhooks/incoming/${webhook.id}/${webhook.secret}`,
      {
        method: 'POST',
        headers: server.baseHeaders,
        body: JSON.stringify({ text: 'credential must stay revoked' })
      }
    );
    expect(webhookPost.status).toBe(404);
  });

  it('rejects MIME-spoofed profile images and oversized JSON or posts', async () => {
    const server = await createTestServer();
    const token = await login(server);
    const fakeImage = new File(['<script>not an image</script>'], 'fake.png', {
      type: 'image/png'
    });
    const imageForm = new FormData();
    imageForm.set('image', fakeImage);
    const imageResponse = await server.app.request('/api/v4/users/admin/image', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: imageForm
    });
    expect(imageResponse.status).toBe(400);

    for (const contentType of ['application/json', 'text/plain']) {
      const oversizedJson = await server.app.request('/api/v4/users/search', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': contentType,
          'Content-Length': String(1024 * 1024 + 1)
        },
        body: '{}'
      });
      expect(oversizedJson.status, contentType).toBe(413);
    }

    const channelId = await firstChannelId(server.app, token);
    const oversizedPost = await server.app.request('/api/v4/posts', {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify({ channel_id: channelId, message: 'x'.repeat(16_384) })
    });
    expect(oversizedPost.status).toBe(400);
  });

  it('does not fall back to an ambient cookie after an explicit credential fails', async () => {
    const server = await createTestServer();
    const loginResponse = await server.app.request('/api/v4/users/login', {
      method: 'POST',
      headers: server.baseHeaders,
      body: JSON.stringify({ login_id: 'admin', password: 'AdminChangeMe123!' })
    });
    const sessionCookie = loginResponse.headers.get('set-cookie')?.split(';', 1)[0];
    if (sessionCookie === undefined) throw new Error('missing session cookie');
    const response = await server.app.request('/api/v4/users/me', {
      headers: {
        Authorization: 'Bearer invalid-explicit-credential',
        Cookie: sessionCookie
      }
    });
    expect(response.status).toBe(401);
  });

  it('indexes case-insensitive channel search and invalidates the index on channel changes', async () => {
    const server = await createTestServer();
    await login(server);
    const admin = server.services.users.findByUsername('admin');
    if (admin === null) {
      throw new Error('missing admin');
    }
    const team = server.services.teams.listUserTeams(admin.id)[0];
    if (team === undefined) {
      throw new Error('missing team');
    }

    expect(server.services.channels.searchTeamChannels(team.id, 'TOWN')).toContainEqual(
      expect.objectContaining({ name: 'town-square' })
    );
    const channel = await server.services.channels.createChannel({
      creatorId: admin.id,
      teamId: team.id,
      type: 'O',
      name: 'indexed-release',
      displayName: 'Initial Display',
      header: '',
      purpose: ''
    });
    expect(server.services.channels.searchTeamChannels(team.id, 'DEXED-REL')).toContainEqual(
      expect.objectContaining({ id: channel.id })
    );

    await server.services.channels.patchChannel(channel.id, { displayName: 'Renamed Signal' }, admin);
    expect(server.services.channels.searchTeamChannels(team.id, 'NAMED sig')).toContainEqual(
      expect.objectContaining({ id: channel.id })
    );

    await server.services.channels.deleteChannel(channel.id, admin);
    expect(server.services.channels.searchTeamChannels(team.id, 'indexed-release')).not.toContainEqual(
      expect.objectContaining({ id: channel.id })
    );
  });

  it('validates the incoming webhook secret and never impersonates an arbitrary user', async () => {
    const server = await createTestServer();
    const adminToken = await login(server);
    const admin = server.services.users.findByUsername('admin');
    if (admin === null) {
      throw new Error('missing admin');
    }
    const channelId = await firstChannelId(server.app, adminToken);

    const createResponse = await server.app.request('/api/v4/webhooks/incoming', {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify({ channel_id: channelId, label: 'External agent' })
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { id: string; secret: string; url: string; channel_id: string };
    expect(created).toMatchObject({ channel_id: channelId });
    expect(typeof created.secret).toBe('string');
    expect(created).not.toHaveProperty('secretHash');
    expect(created).not.toHaveProperty('secret_hash');

    const wrongSecret = await server.app.request(`/api/v4/webhooks/incoming/${created.id}/not-the-real-secret`, {
      method: 'POST',
      headers: server.baseHeaders,
      body: JSON.stringify({ text: 'should not post' })
    });
    expect(wrongSecret.status).toBe(404);

    const mallory = await createMember(server, adminToken, 'mallory');
    const protectedAdmin = await server.app.request(`/api/v4/webhooks/incoming/${created.id}/${created.secret}`, {
      method: 'POST',
      headers: server.baseHeaders,
      body: JSON.stringify({ text: 'should not post', username: 'ADMIN' })
    });
    expect(protectedAdmin.status).toBe(400);

    const protectedBot = await server.app.request(`/api/v4/webhooks/incoming/${created.id}/${created.secret}`, {
      method: 'POST',
      headers: server.baseHeaders,
      body: JSON.stringify({ text: 'should not post', username: 'hermes' })
    });
    expect(protectedBot.status).toBe(400);

    await server.services.users.patchUser(admin.id, { nickname: 'Root Operator' }, admin);
    for (const protectedDisplayName of ['ＡＤＭＩＮ', 'аdmin', 'Root Operator', 'Hermes Agent']) {
      const protectedDisplay = await server.app.request(`/api/v4/webhooks/incoming/${created.id}/${created.secret}`, {
        method: 'POST',
        headers: server.baseHeaders,
        body: JSON.stringify({ text: 'should not post', username: protectedDisplayName })
      });
      expect(protectedDisplay.status, protectedDisplayName).toBe(400);
    }

    const posted = await server.app.request(`/api/v4/webhooks/incoming/${created.id}/${created.secret}`, {
      method: 'POST',
      headers: server.baseHeaders,
      body: JSON.stringify({ text: 'hi from the outside', username: 'External Assistant' })
    });
    expect(posted.status).toBe(200);
    const post = (await posted.json()) as { user_id: string; message: string; props: Record<string, unknown> };
    expect(post.user_id).toBe(admin.id);
    expect(post.user_id).not.toBe(mallory.userId);
    expect(post.message).toBe('hi from the outside');
    expect(post.props).toMatchObject({
      from_webhook: 'true',
      override_username: 'External Assistant',
      webhook_id: created.id,
      webhook_label: 'External agent',
      webhook_owner_id: admin.id,
      webhook_owner_username: admin.username
    });
  });

  it('requires the current password for a self-service password change', async () => {
    const server = await createTestServer();
    const adminToken = await login(server);
    const alice = await createMember(server, adminToken, 'alicepw');

    const missing = await server.app.request(`/api/v4/users/${alice.userId}/password`, {
      method: 'PUT',
      headers: bearer(alice.token),
      body: JSON.stringify({ new_password: 'FreshAlicePass123!' })
    });
    expect(missing.status).toBe(401);

    const wrong = await server.app.request(`/api/v4/users/${alice.userId}/password`, {
      method: 'PUT',
      headers: bearer(alice.token),
      body: JSON.stringify({ new_password: 'FreshAlicePass123!', current_password: 'wrong-password' })
    });
    expect(wrong.status).toBe(401);

    const correct = await server.app.request(`/api/v4/users/${alice.userId}/password`, {
      method: 'PUT',
      headers: bearer(alice.token),
      body: JSON.stringify({ new_password: 'FreshAlicePass123!', current_password: alice.password })
    });
    expect(correct.status).toBe(200);

    const relogin = await server.app.request('/api/v4/users/login', {
      method: 'POST',
      headers: server.baseHeaders,
      body: JSON.stringify({ login_id: 'alicepw', password: 'FreshAlicePass123!' })
    });
    expect(relogin.headers.get('Token')).not.toBeNull();

    const adminReset = await server.app.request(`/api/v4/users/${alice.userId}/password`, {
      method: 'PUT',
      headers: bearer(adminToken),
      body: JSON.stringify({ new_password: 'AdminSetAlice123!' })
    });
    expect(adminReset.status).toBe(200);
  });

  it('lets any channel member pin a post without marking it edited', async () => {
    const server = await createTestServer();
    const adminToken = await login(server);
    const channelId = await firstChannelId(server.app, adminToken);

    const postResponse = await server.app.request('/api/v4/posts', {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify({ channel_id: channelId, message: 'pin me' })
    });
    expect(postResponse.status).toBe(201);
    const post = (await postResponse.json()) as { id: string };

    const member = await createMember(server, adminToken, 'pinmember');
    const addMember = await server.app.request(`/api/v4/channels/${channelId}/members`, {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify({ user_id: member.userId })
    });
    expect(addMember.status).toBe(200);

    const pinned = await server.app.request(`/api/v4/posts/${post.id}/pin`, {
      method: 'POST',
      headers: bearer(member.token)
    });
    expect(pinned.status).toBe(200);
    const pinnedPost = (await pinned.json()) as { is_pinned: boolean; edit_at: number };
    expect(pinnedPost.is_pinned).toBe(true);
    expect(pinnedPost.edit_at).toBe(0);

    const history = await server.app.request(`/api/v4/posts/${post.id}/edit_history`, {
      headers: bearer(adminToken)
    });
    expect((await history.json()) as unknown[]).toHaveLength(0);

    const unpinned = await server.app.request(`/api/v4/posts/${post.id}/unpin`, {
      method: 'POST',
      headers: bearer(member.token)
    });
    expect(unpinned.status).toBe(200);
    expect((await unpinned.json()) as { is_pinned: boolean }).toMatchObject({ is_pinned: false });
  });

  it('clears the unread count after a channel is viewed', async () => {
    const server = await createTestServer();
    const adminToken = await login(server);
    const admin = server.services.users.findByUsername('admin');
    if (admin === null) {
      throw new Error('missing admin');
    }
    const channelId = await firstChannelId(server.app, adminToken);

    const view = async (): Promise<void> => {
      const response = await server.app.request(`/api/v4/channels/members/${admin.id}/view`, {
        method: 'POST',
        headers: bearer(adminToken),
        body: JSON.stringify({ channel_id: channelId })
      });
      expect(response.status).toBe(200);
    };
    const unreadCount = async (): Promise<number> => {
      const response = await server.app.request(`/api/v4/users/${admin.id}/channels/${channelId}/unread`, {
        headers: bearer(adminToken)
      });
      expect(response.status).toBe(200);
      return ((await response.json()) as { msg_count: number }).msg_count;
    };

    await view();
    expect(await unreadCount()).toBe(0);

    const posted = await server.app.request('/api/v4/posts', {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify({ channel_id: channelId, message: 'a new message' })
    });
    expect(posted.status).toBe(201);
    expect(await unreadCount()).toBe(1);

    await view();
    expect(await unreadCount()).toBe(0);
  });

  it('blocks ordinary members from renaming a channel while allowing header edits', async () => {
    const server = await createTestServer();
    const adminToken = await login(server);
    const teamsResponse = await server.app.request('/api/v4/users/me/teams', { headers: bearer(adminToken) });
    const team = ((await teamsResponse.json()) as { id: string }[])[0];
    if (team === undefined) {
      throw new Error('missing team');
    }
    const channelResponse = await server.app.request('/api/v4/channels', {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify({ team_id: team.id, name: 'rename-guard', display_name: 'Rename Guard', type: 'O' })
    });
    expect(channelResponse.status).toBe(201);
    const channel = (await channelResponse.json()) as { id: string };

    const member = await createMember(server, adminToken, 'renamemember');
    const join = await server.app.request(`/api/v4/channels/${channel.id}/members`, {
      method: 'POST',
      headers: bearer(member.token),
      body: JSON.stringify({ user_id: member.userId })
    });
    expect(join.status).toBe(200);

    const rename = await server.app.request(`/api/v4/channels/${channel.id}/patch`, {
      method: 'PUT',
      headers: bearer(member.token),
      body: JSON.stringify({ display_name: 'Hijacked Name' })
    });
    expect(rename.status).toBe(403);

    const headerEdit = await server.app.request(`/api/v4/channels/${channel.id}/patch`, {
      method: 'PUT',
      headers: bearer(member.token),
      body: JSON.stringify({ header: 'Member-provided header' })
    });
    expect(headerEdit.status).toBe(200);
    expect((await headerEdit.json()) as { header: string }).toMatchObject({ header: 'Member-provided header' });
  });

  it('blocks members from creating channels in teams they do not belong to', async () => {
    const server = await createTestServer();
    const adminToken = await login(server);
    const admin = server.services.users.findByUsername('admin');
    if (admin === null) {
      throw new Error('missing admin');
    }
    const now = nowMs();
    const foreignTeam = {
      id: createId(),
      createAt: now,
      updateAt: now,
      deleteAt: 0,
      name: 'foreign-team',
      displayName: 'Foreign Team',
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
      state.teams.push(foreignTeam);
    });
    await server.services.teams.addUserToTeam(foreignTeam.id, admin.id, 'team_admin');

    const member = await createMember(server, adminToken, 'foreignchannel');

    const blocked = await server.app.request('/api/v4/channels', {
      method: 'POST',
      headers: bearer(member.token),
      body: JSON.stringify({ team_id: foreignTeam.id, name: 'foreign-injected', display_name: 'Foreign Injected', type: 'O' })
    });
    expect(blocked.status).toBe(403);
    expect(server.services.channels.listTeamChannels(foreignTeam.id).some((channel) => channel.name === 'foreign-injected')).toBe(false);

    const homeTeam = server.services.teams.listUserTeams(member.userId)[0];
    if (homeTeam === undefined) {
      throw new Error('missing home team');
    }
    const allowed = await server.app.request('/api/v4/channels', {
      method: 'POST',
      headers: bearer(member.token),
      body: JSON.stringify({ team_id: homeTeam.id, name: 'home-allowed', display_name: 'Home Allowed', type: 'O' })
    });
    expect(allowed.status).toBe(201);

    const removal = server.store.write((state) => {
      const membership = state.teamMembers.find(
        (candidate) => candidate.teamId === homeTeam.id && candidate.userId === member.userId
      );
      if (membership === undefined) throw new Error('missing team membership');
      membership.deleteAt = nowMs();
      membership.updateAt = membership.deleteAt;
    });
    const racedCreation = server.services.channels.createChannel({
      creatorId: member.userId,
      teamId: homeTeam.id,
      type: 'P',
      name: 'membership-race',
      displayName: 'Membership Race',
      header: '',
      purpose: '',
      actor: server.services.users.getById(member.userId)
    });
    await removal;
    await expect(racedCreation).rejects.toMatchObject({ statusCode: 403 });
    expect(server.services.channels.listTeamChannels(homeTeam.id).some((channel) => channel.name === 'membership-race')).toBe(false);

    const adminCreate = await server.app.request('/api/v4/channels', {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify({ team_id: foreignTeam.id, name: 'admin-foreign', display_name: 'Admin Foreign', type: 'O' })
    });
    expect(adminCreate.status).toBe(201);
  });

  it('enforces max_uses on a single-use invite under concurrent redemption', async () => {
    const server = await createTestServer();
    const adminToken = await login(server);
    const inviteResponse = await server.app.request('/admin/invites', {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify({ max_uses: 1, expires_in_hours: 12 })
    });
    expect(inviteResponse.status).toBe(201);
    const invite = (await inviteResponse.json()) as { code: string };

    const signup = async (username: string): Promise<Response> =>
      server.app.request('/api/v4/users', {
        method: 'POST',
        headers: server.baseHeaders,
        body: JSON.stringify({ invite_code: invite.code, username, email: `${username}@example.test`, password: `${username}Password123!` })
      });

    const [first, second] = await Promise.all([signup('racefirst'), signup('racesecond')]);
    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([201, 400]);

    const created = ['racefirst', 'racesecond'].filter((username) => server.services.users.findByUsername(username) !== null);
    expect(created).toHaveLength(1);
  });

  it('commits invite enrollment atomically and preserves an independent revoke', async () => {
    const server = await createTestServer();
    const adminToken = await login(server);
    const admin = server.services.users.findByUsername('admin');
    if (admin === null) throw new Error('missing admin');
    const team = server.services.teams.listUserTeams(admin.id)[0];
    const channel = server.services.channels.listForUser(admin.id).find((candidate) => candidate.teamId === team?.id);
    if (team === undefined || channel === undefined) throw new Error('missing enrollment targets');

    const invalidTargetInvite = await server.services.invites.createInvite({
      actor: admin,
      maxUses: 1,
      expiresInHours: 12,
      teamIds: [team.id],
      channelIds: [channel.id]
    });
    await server.store.write((state) => {
      const stored = state.channels.find((candidate) => candidate.id === channel.id);
      if (stored === undefined) throw new Error('missing invite channel');
      stored.deleteAt = nowMs();
    });
    const membershipCountsBefore = server.store.read((state) => ({
      teams: state.teamMembers.length,
      channels: state.channelMembers.length
    }));
    await expect(
      server.services.invites.enroll({
        inviteCode: invalidTargetInvite.code,
        username: 'atomicfailure',
        email: 'atomicfailure@example.test',
        password: 'AtomicFailurePassword123!'
      })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(server.services.users.findByUsername('atomicfailure')).toBeNull();
    expect(
      server.store.read((state) => state.inviteCodes.find((candidate) => candidate.id === invalidTargetInvite.invite.id))
    ).toMatchObject({ uses: 0, disabledAt: 0 });
    expect(
      server.store.read((state) => ({
        teams: state.teamMembers.length,
        channels: state.channelMembers.length
      }))
    ).toEqual(membershipCountsBefore);

    const revokeInviteResponse = await server.app.request('/admin/invites', {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify({ max_uses: 1, expires_in_hours: 12 })
    });
    const revokeInvite = (await revokeInviteResponse.json()) as { invite: { id: string }; code: string };
    const failedSignup = server.app.request('/api/v4/users', {
      method: 'POST',
      headers: server.baseHeaders,
      body: JSON.stringify({
        invite_code: revokeInvite.code,
        username: 'admin',
        email: 'another-admin@example.test',
        password: 'AnotherAdminPassword123!'
      })
    });
    const revoked = await server.app.request(`/admin/invites/${revokeInvite.invite.id}`, {
      method: 'DELETE',
      headers: bearer(adminToken)
    });
    expect(revoked.status).toBe(200);
    expect((await failedSignup).status).not.toBe(201);
    expect(
      server.store.read((state) => state.inviteCodes.find((candidate) => candidate.id === revokeInvite.invite.id))
    ).toMatchObject({ uses: 0 });
    expect(
      server.store.read((state) => state.inviteCodes.find((candidate) => candidate.id === revokeInvite.invite.id)?.disabledAt ?? 0)
    ).toBeGreaterThan(0);
  });

  it('excludes private channels after leave, removal, channel deletion, and team removal', async () => {
    const server = await createTestServer();
    const adminToken = await login(server);
    const admin = server.services.users.findByUsername('admin');
    if (admin === null) throw new Error('missing admin');
    const member = await createMember(server, adminToken, 'formerprivate');
    const team = server.services.teams.listUserTeams(member.userId)[0];
    if (team === undefined) throw new Error('missing team');

    const createPrivate = async (name: string): Promise<string> => {
      const channel = await server.services.channels.createChannel({
        creatorId: admin.id,
        teamId: team.id,
        type: 'P',
        name,
        displayName: name,
        header: '',
        purpose: '',
        actor: admin
      });
      await server.services.channels.addUserToChannel(channel.id, member.userId, '', admin);
      return channel.id;
    };
    const search = async (term: string): Promise<string[]> => {
      const response = await server.app.request(`/api/v4/teams/${team.id}/channels/search`, {
        method: 'POST',
        headers: bearer(member.token),
        body: JSON.stringify({ term })
      });
      expect(response.status).toBe(200);
      return ((await response.json()) as { id: string }[]).map((channel) => channel.id);
    };
    const autocomplete = async (term: string): Promise<string[]> => {
      const response = await server.app.request(
        `/api/v4/teams/${team.id}/channels/autocomplete?name=${encodeURIComponent(term)}`,
        { headers: bearer(member.token) }
      );
      expect(response.status).toBe(200);
      return ((await response.json()) as { id: string }[]).map((channel) => channel.id);
    };

    const leftChannelId = await createPrivate('former-leave-secret');
    expect(await search('former-leave-secret')).toContain(leftChannelId);
    expect(await autocomplete('former-leave-secret')).toContain(leftChannelId);
    const leave = await server.app.request(`/api/v4/channels/${leftChannelId}/members/${member.userId}`, {
      method: 'DELETE',
      headers: bearer(member.token)
    });
    expect(leave.status).toBe(200);
    expect(await search('former-leave-secret')).not.toContain(leftChannelId);
    expect(await autocomplete('former-leave-secret')).not.toContain(leftChannelId);

    const removedChannelId = await createPrivate('former-remove-secret');
    const remove = await server.app.request(`/api/v4/channels/${removedChannelId}/members/${member.userId}`, {
      method: 'DELETE',
      headers: bearer(adminToken)
    });
    expect(remove.status).toBe(200);
    expect(await search('former-remove-secret')).not.toContain(removedChannelId);

    const deletedChannelId = await createPrivate('former-deleted-channel');
    await server.services.channels.deleteChannel(deletedChannelId, admin);
    expect(server.services.channels.listChannelIdsForUser(member.userId)).not.toContain(deletedChannelId);

    const deletedTeamChannelId = await createPrivate('former-deleted-team');
    await server.store.write((state) => {
      const storedTeam = state.teams.find((candidate) => candidate.id === team.id);
      if (storedTeam === undefined) throw new Error('missing team');
      storedTeam.deleteAt = nowMs();
      storedTeam.updateAt = storedTeam.deleteAt;
    });
    expect(server.services.channels.listChannelIdsForUser(member.userId)).not.toContain(deletedTeamChannelId);
  });

  it('revokes other sessions on a self-service password change and on an admin reset', async () => {
    const server = await createTestServer();
    const adminToken = await login(server);
    const member = await createMember(server, adminToken, 'sessionrevoke');

    const secondLogin = await server.app.request('/api/v4/users/login', {
      method: 'POST',
      headers: server.baseHeaders,
      body: JSON.stringify({ login_id: 'sessionrevoke', password: member.password })
    });
    const secondToken = secondLogin.headers.get('Token');
    if (secondToken === null) {
      throw new Error('missing second token');
    }

    const change = await server.app.request(`/api/v4/users/${member.userId}/password`, {
      method: 'PUT',
      headers: bearer(member.token),
      body: JSON.stringify({ new_password: 'RotatedSessionPass123!', current_password: member.password })
    });
    expect(change.status).toBe(200);

    const callerStillValid = await server.app.request('/api/v4/users/me', { headers: bearer(member.token) });
    expect(callerStillValid.status).toBe(200);

    const otherRevoked = await server.app.request('/api/v4/users/me', { headers: bearer(secondToken) });
    expect(otherRevoked.status).toBe(401);

    const reLogin = await server.app.request('/api/v4/users/login', {
      method: 'POST',
      headers: server.baseHeaders,
      body: JSON.stringify({ login_id: 'sessionrevoke', password: 'RotatedSessionPass123!' })
    });
    const rotatedToken = reLogin.headers.get('Token');
    if (rotatedToken === null) {
      throw new Error('missing rotated token');
    }

    const adminReset = await server.app.request(`/admin/users/${member.userId}/reset-password`, {
      method: 'POST',
      headers: bearer(adminToken),
      body: JSON.stringify({ new_password: 'AdminForcedPass123!' })
    });
    expect(adminReset.status).toBe(200);

    const afterAdminReset = await server.app.request('/api/v4/users/me', { headers: bearer(rotatedToken) });
    expect(afterAdminReset.status).toBe(401);
  });
});
