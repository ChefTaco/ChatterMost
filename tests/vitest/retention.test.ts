import { describe, expect, it } from 'vitest';

import type { FileInfoRecord, UserRecord } from '../../src/server/domain.js';
import { bearer, createTestServer, firstChannelId, login, type TestServer } from './helpers.js';

const DAY_MS = 86_400_000;

function adminUser(server: TestServer): UserRecord {
  const admin = server.store.read((state) => state.users.find((user) => user.username === 'admin'));
  if (admin === undefined) throw new Error('missing admin');
  return admin;
}

async function ageRecords(server: TestServer, ids: string[], days: number): Promise<void> {
  const createAt = Date.now() - days * DAY_MS;
  await server.store.write((state) => {
    for (const record of [...state.posts, ...state.files]) {
      if (ids.includes(record.id)) record.createAt = createAt;
    }
  });
}

async function fileExists(server: TestServer, file: FileInfoRecord): Promise<boolean> {
  try {
    await server.services.files.readFile(file);
    return true;
  } catch {
    return false;
  }
}

async function createSecondChannel(server: TestServer, token: string): Promise<string> {
  const teams = (await (await server.app.request('/api/v4/users/me/teams', { headers: bearer(token) })).json()) as { id: string }[];
  const response = await server.app.request('/api/v4/channels', {
    method: 'POST',
    headers: bearer(token),
    body: JSON.stringify({ team_id: teams[0]?.id, name: 'keep-forever', display_name: 'Keep forever', type: 'O' })
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

// Unattached-upload collection is covered in data-lifecycle.test.ts; it is off here to isolate channel limits.
describe('channel retention', () => {
  it('purges posts, history, reactions and files older than the channel limit and audits it', async () => {
    const server = await createTestServer({ ORPHAN_UPLOAD_GRACE_HOURS: '0' });
    try {
      const token = await login(server);
      const channelId = await firstChannelId(server.app, token);
      const otherChannelId = await createSecondChannel(server, token);
      const admin = adminUser(server);
      const { posts, files, reactions } = server.services;

      const upload = (name: string) =>
        files.storeFile({ userId: admin.id, channelId, name, mimeType: 'text/plain', bytes: new TextEncoder().encode(`synthetic ${name}`) });
      const oldFile = await upload('old-attachment.txt');
      const oldOrphan = await upload('old-orphan.txt');
      const keptByNewPost = await upload('old-but-attached.txt');
      const newOrphan = await upload('new-orphan.txt');

      const oldRoot = await posts.createPost({ actor: admin, channelId, message: 'old root', fileIds: [oldFile.id] });
      await posts.patchPost(oldRoot.id, { message: 'old root edited' }, admin);
      await reactions.add({ actor: admin, postId: oldRoot.id, emojiName: 'thumbsup' });
      const oldReplyToOldRoot = await posts.createPost({ actor: admin, channelId, message: 'old reply in an old thread', rootId: oldRoot.id });
      const activeOldRoot = await posts.createPost({ actor: admin, channelId, message: 'old root, active thread' });
      const newReplyToOldRoot = await posts.createPost({ actor: admin, channelId, message: 'new reply', rootId: activeOldRoot.id });
      const newRoot = await posts.createPost({ actor: admin, channelId, message: 'new root', fileIds: [keptByNewPost.id] });
      const oldReplyToNewRoot = await posts.createPost({ actor: admin, channelId, message: 'old reply', rootId: newRoot.id });
      const oldPostElsewhere = await posts.createPost({ actor: admin, channelId: otherChannelId, message: 'old elsewhere' });

      await ageRecords(server, [oldFile.id, oldOrphan.id, keptByNewPost.id, oldRoot.id, oldReplyToOldRoot.id, activeOldRoot.id, oldReplyToNewRoot.id, oldPostElsewhere.id], 40);
      expect(server.store.read((state) => state.posts.find((post) => post.id === newRoot.id)?.replyCount)).toBe(1);

      // Without a limit nothing is removed.
      expect(await server.services.retention.sweep()).toMatchObject({ channels: 0, posts: 0, files: 0 });

      const patch = await server.app.request(`/api/v4/channels/${channelId}/patch`, {
        method: 'PUT',
        headers: bearer(token),
        body: JSON.stringify({ retention_days: 30 })
      });
      expect(patch.status).toBe(200);

      const events: { event: string; data: Record<string, unknown> }[] = [];
      server.services.hub.attach({ send: (frame: string) => events.push(JSON.parse(frame) as { event: string; data: Record<string, unknown> }), close: () => undefined } as never, admin.id);
      const result = await server.services.retention.sweep();
      expect(result).toMatchObject({ channels: 1, posts: 2, files: 2 });

      const state = server.store.read((current) => current);
      const postIds = state.posts.map((post) => post.id);
      // Threads expire as a unit, by their newest post: an old thread goes whole, an active one stays whole.
      expect(postIds).not.toContain(oldRoot.id);
      expect(postIds).not.toContain(oldReplyToOldRoot.id);
      expect(postIds).toEqual(expect.arrayContaining([activeOldRoot.id, newReplyToOldRoot.id, newRoot.id, oldReplyToNewRoot.id, oldPostElsewhere.id]));
      expect(state.posts.find((post) => post.id === newRoot.id)?.replyCount).toBe(1);
      expect(events.filter((event) => event.event === 'post_deleted').map((event) => event.data.post_id).sort()).toEqual([oldRoot.id, oldReplyToOldRoot.id].sort());
      expect(state.postEditHistory.some((entry) => entry.postId === oldRoot.id)).toBe(false);
      expect(state.reactions.some((reaction) => reaction.postId === oldRoot.id)).toBe(false);

      const fileIds = state.files.map((file) => file.id);
      expect(fileIds).not.toContain(oldFile.id);
      expect(fileIds).not.toContain(oldOrphan.id);
      expect(fileIds).toEqual(expect.arrayContaining([keptByNewPost.id, newOrphan.id]));
      expect(await fileExists(server, oldFile)).toBe(false);
      expect(await fileExists(server, oldOrphan)).toBe(false);
      expect(await fileExists(server, keptByNewPost)).toBe(true);
      expect(await fileExists(server, newOrphan)).toBe(true);

      const audit = state.auditLogs.find((entry) => entry.action === 'channel.retention_purged');
      expect(audit).toMatchObject({ actorUserId: null, targetId: channelId, metadata: { retention_days: 30, posts: 2, files: 2 } });

      // A second sweep finds nothing left to purge.
      expect(await server.services.retention.sweep()).toMatchObject({ channels: 0, posts: 0, files: 0 });
    } finally {
      await server.store.close();
    }
  });

  it('ignores limits outside the accepted range and rejects them at the API', async () => {
    const server = await createTestServer({ ORPHAN_UPLOAD_GRACE_HOURS: '0' });
    try {
      const token = await login(server);
      const channelId = await firstChannelId(server.app, token);
      for (const retention_days of [0, -1, 1.5, 36_501]) {
        const response = await server.app.request(`/api/v4/channels/${channelId}/patch`, {
          method: 'PUT',
          headers: bearer(token),
          body: JSON.stringify({ retention_days })
        });
        expect(response.status, String(retention_days)).toBe(400);
      }
      const admin = adminUser(server);
      const post = await server.services.posts.createPost({ actor: admin, channelId, message: 'kept' });
      await ageRecords(server, [post.id], 400);
      await server.store.write((state) => {
        const channel = state.channels.find((candidate) => candidate.id === channelId);
        if (channel !== undefined) channel.retentionDays = 0;
      });
      expect(await server.services.retention.sweep()).toMatchObject({ channels: 0, posts: 0, files: 0 });
      expect(server.store.read((state) => state.posts.some((candidate) => candidate.id === post.id))).toBe(true);
    } finally {
      await server.store.close();
    }
  });
});

describe('channel retention settings', () => {
  it('stores the admin policy form value as the enforced channel limit', async () => {
    const server = await createTestServer({ ORPHAN_UPLOAD_GRACE_HOURS: '0' });
    try {
      const token = await login(server);
      const channelId = await firstChannelId(server.app, token);
      const put = (body: object) =>
        server.app.request(`/api/v4/channels/${channelId}/agent-policy`, { method: 'PUT', headers: bearer(token), body: JSON.stringify(body) });
      const retentionDays = () => server.store.read((state) => state.channels.find((channel) => channel.id === channelId)?.retentionDays);

      expect((await put({ mention_required: true, retention_days: 14 })).status).toBe(200);
      expect(retentionDays()).toBe(14);
      const policy = (await (await server.app.request(`/api/v4/channels/${channelId}/agent-policy`, { headers: bearer(token) })).json()) as Record<string, unknown>;
      expect(policy).toMatchObject({ mention_required: true, retention_days: 14 });
      expect(server.store.read((state) => state.channels.find((channel) => channel.id === channelId)?.agentPolicy)).not.toHaveProperty('retention_days');

      // Omitting the field keeps the limit; null clears it; invalid values are rejected.
      expect((await put({ mention_required: false })).status).toBe(200);
      expect(retentionDays()).toBe(14);
      expect((await put({ retention_days: 0 })).status).toBe(400);
      expect((await put({ retention_days: '30' })).status).toBe(400);
      expect(retentionDays()).toBe(14);
      expect((await put({ retention_days: null })).status).toBe(200);
      expect(retentionDays()).toBeNull();
    } finally {
      await server.store.close();
    }
  });

  it('moves a legacy policy value onto the channel at startup', async () => {
    const server = await createTestServer({ ORPHAN_UPLOAD_GRACE_HOURS: '0' });
    try {
      const token = await login(server);
      const channelId = await firstChannelId(server.app, token);
      await server.store.write((state) => {
        const channel = state.channels.find((candidate) => candidate.id === channelId);
        if (channel !== undefined) channel.agentPolicy = { mention_required: true, retention_days: 7 };
      });
      await server.services.channels.migrateLegacyRetention();
      const channel = server.store.read((state) => state.channels.find((candidate) => candidate.id === channelId));
      expect(channel?.retentionDays).toBe(7);
      expect(channel?.agentPolicy).toEqual({ mention_required: true });
    } finally {
      await server.store.close();
    }
  });
});

describe('post sync and search', () => {
  it('returns every change since a timestamp, with deletions as redacted tombstones', async () => {
    const server = await createTestServer({ ORPHAN_UPLOAD_GRACE_HOURS: '0' });
    try {
      const token = await login(server);
      const channelId = await firstChannelId(server.app, token);
      const admin = adminUser(server);
      const since = Date.now() - 1;
      const created: string[] = [];
      for (let index = 0; index < 70; index += 1) {
        created.push((await server.services.posts.createPost({ actor: admin, channelId, message: `sync ${index}` })).id);
      }
      const doomed = created[0] ?? '';
      await server.services.posts.deletePost(doomed, admin);

      const response = await server.app.request(`/api/v4/channels/${channelId}/posts?since=${since}&per_page=60`, { headers: bearer(token) });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { order: string[]; posts: Record<string, { delete_at: number; message: string; file_ids: string[] }> };
      expect(body.order).toEqual(expect.arrayContaining(created));
      const tombstone = body.posts[doomed];
      expect(tombstone?.delete_at).toBeGreaterThan(0);
      expect(tombstone?.message).toBe('');
      expect(tombstone?.file_ids).toEqual([]);

      // The ordinary listing still hides deleted posts.
      const page = (await (await server.app.request(`/api/v4/channels/${channelId}/posts?per_page=200`, { headers: bearer(token) })).json()) as { order: string[] };
      expect(page.order).not.toContain(doomed);
    } finally {
      await server.store.close();
    }
  });

  it('returns the newest matches when a search has more than 100 hits', async () => {
    const server = await createTestServer({ ORPHAN_UPLOAD_GRACE_HOURS: '0' });
    try {
      const token = await login(server);
      const channelId = await firstChannelId(server.app, token);
      const admin = adminUser(server);
      const ids: string[] = [];
      for (let index = 0; index < 105; index += 1) {
        ids.push((await server.services.posts.createPost({ actor: admin, channelId, message: `needle ${index}` })).id);
      }
      await server.store.write((state) => {
        ids.forEach((id, index) => {
          const post = state.posts.find((candidate) => candidate.id === id);
          if (post !== undefined) post.createAt = 1_000_000 + index;
        });
      });
      const response = await server.app.request('/api/v4/posts/search', { method: 'POST', headers: bearer(token), body: JSON.stringify({ terms: 'needle' }) });
      const body = (await response.json()) as { order: string[] };
      expect(body.order).toHaveLength(100);
      expect(body.order).toContain(ids[104]);
      expect(body.order).not.toContain(ids[0]);
    } finally {
      await server.store.close();
    }
  });
});

describe('agent policy simulator', () => {
  it('reports enforced channel rules instead of always allowing', async () => {
    const server = await createTestServer({ ORPHAN_UPLOAD_GRACE_HOURS: '0' });
    try {
      const token = await login(server);
      const channelId = await firstChannelId(server.app, token);
      const simulate = async (body: object) =>
        (await (await server.app.request('/api/v4/admin/policy-simulator', { method: 'POST', headers: bearer(token), body: JSON.stringify(body) })).json()) as {
          allowed: boolean;
          reasons: string[];
          affected_user_ids: string[];
          visible_channel_ids: string[];
        };
      const admin = adminUser(server);

      const noChannel = await simulate({});
      expect(noChannel.allowed).toBe(false);
      expect(noChannel.reasons).toContain('No channel selected');

      const missing = await simulate({ channel_id: 'x'.repeat(26) });
      expect(missing.allowed).toBe(false);

      const unknownAgent = await simulate({ channel_id: channelId, agent_id: 'nobody' });
      expect(unknownAgent.allowed).toBe(false);
      expect(unknownAgent.reasons).toContain('Agent is not registered');

      const asAdmin = await simulate({ channel_id: channelId, user_id: admin.id });
      expect(asAdmin.allowed).toBe(true);
      expect(asAdmin.visible_channel_ids).toEqual([channelId]);
      expect(asAdmin.affected_user_ids).toContain(admin.id);
    } finally {
      await server.store.close();
    }
  });
});

describe('retention limit changes', () => {
  it('lets only system admins set a channel retention limit and audits each change', async () => {
    const server = await createTestServer({ ORPHAN_UPLOAD_GRACE_HOURS: '0' });
    try {
      const token = await login(server);
      const team = server.store.read((state) => state.teams[0]);
      const creator = await server.services.users.createUser({ username: 'channelowner', email: 'channelowner@example.test', password: 'SyntheticPassword123!', role: 'system_user', actorUserId: null });
      await server.services.teams.addUserToTeam(team?.id ?? '', creator.id, 'team_user');
      const signIn = await server.app.request('/api/v4/users/login', { method: 'POST', headers: server.baseHeaders, body: JSON.stringify({ login_id: 'channelowner', password: 'SyntheticPassword123!' }) });
      const creatorToken = signIn.headers.get('Token') ?? '';
      const created = await server.app.request('/api/v4/channels', { method: 'POST', headers: bearer(creatorToken), body: JSON.stringify({ team_id: team?.id, name: 'owned-channel', display_name: 'Owned', type: 'O' }) });
      expect(created.status).toBe(201);
      const channelId = ((await created.json()) as { id: string }).id;
      const patch = (as: string, body: unknown) => server.app.request(`/api/v4/channels/${channelId}/patch`, { method: 'PUT', headers: bearer(as), body: JSON.stringify(body) });

      // The creator is channel_admin and may still rename the channel, but not set a retention limit.
      expect((await patch(creatorToken, { display_name: 'Renamed' })).status).toBe(200);
      expect((await patch(creatorToken, { retention_days: 1 })).status).toBe(403);
      expect(server.store.read((state) => state.channels.find((channel) => channel.id === channelId)?.retentionDays)).toBeNull();

      expect((await patch(token, { retention_days: 30 })).status).toBe(200);
      expect((await patch(token, { retention_days: 30 })).status).toBe(200);
      expect((await patch(token, { retention_days: null })).status).toBe(200);
      const changes = server.store.read((state) => state.auditLogs.filter((entry) => entry.action === 'channel.retention_changed' && entry.targetId === channelId).map((entry) => entry.metadata));
      expect(changes).toEqual([
        { old_retention_days: 30, new_retention_days: null },
        { old_retention_days: null, new_retention_days: 30 }
      ]);
    } finally {
      await server.store.close();
    }
  });
});

describe('changes since a timestamp', () => {
  it('keeps the most recent changes when capped, including edits of old posts', async () => {
    const server = await createTestServer({ ORPHAN_UPLOAD_GRACE_HOURS: '0' });
    try {
      const token = await login(server);
      const channelId = await firstChannelId(server.app, token);
      const admin = adminUser(server);
      const old = await server.services.posts.createPost({ actor: admin, channelId, message: 'old post' });
      await ageRecords(server, [old.id], 2);
      const since = Date.now() - DAY_MS;
      await server.services.posts.createPost({ actor: admin, channelId, message: 'new one' });
      await server.services.posts.createPost({ actor: admin, channelId, message: 'new two' });
      await new Promise((resolve) => setTimeout(resolve, 5));
      await server.services.posts.patchPost(old.id, { message: 'old post, edited just now' }, admin);
      const changes = server.services.posts.channelChangesSince(channelId, admin, since, 2);
      expect(changes.map((post) => post.message)).toContain('old post, edited just now');
      expect(changes).toHaveLength(2);
    } finally {
      await server.store.close();
    }
  });
});

