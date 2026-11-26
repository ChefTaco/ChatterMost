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

describe('channel retention', () => {
  it('purges posts, history, reactions and files older than the channel limit and audits it', async () => {
    const server = await createTestServer();
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
      const newReplyToOldRoot = await posts.createPost({ actor: admin, channelId, message: 'new reply', rootId: oldRoot.id });
      const newRoot = await posts.createPost({ actor: admin, channelId, message: 'new root', fileIds: [keptByNewPost.id] });
      const oldReplyToNewRoot = await posts.createPost({ actor: admin, channelId, message: 'old reply', rootId: newRoot.id });
      const oldPostElsewhere = await posts.createPost({ actor: admin, channelId: otherChannelId, message: 'old elsewhere' });

      await ageRecords(server, [oldFile.id, oldOrphan.id, keptByNewPost.id, oldRoot.id, oldReplyToNewRoot.id, oldPostElsewhere.id], 40);
      expect(server.store.read((state) => state.posts.find((post) => post.id === newRoot.id)?.replyCount)).toBe(1);

      // Without a limit nothing is removed.
      expect(await server.services.retention.sweep()).toEqual({ channels: 0, posts: 0, files: 0 });

      const patch = await server.app.request(`/api/v4/channels/${channelId}/patch`, {
        method: 'PUT',
        headers: bearer(token),
        body: JSON.stringify({ retention_days: 30 })
      });
      expect(patch.status).toBe(200);

      const result = await server.services.retention.sweep();
      expect(result).toEqual({ channels: 1, posts: 2, files: 2 });

      const state = server.store.read((current) => current);
      const postIds = state.posts.map((post) => post.id);
      expect(postIds).not.toContain(oldRoot.id);
      expect(postIds).not.toContain(oldReplyToNewRoot.id);
      expect(postIds).toEqual(expect.arrayContaining([newReplyToOldRoot.id, newRoot.id, oldPostElsewhere.id]));
      expect(state.posts.find((post) => post.id === newRoot.id)?.replyCount).toBe(0);
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
      expect(await server.services.retention.sweep()).toEqual({ channels: 0, posts: 0, files: 0 });
    } finally {
      await server.store.close();
    }
  });

  it('ignores limits outside the accepted range and rejects them at the API', async () => {
    const server = await createTestServer();
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
      expect(await server.services.retention.sweep()).toEqual({ channels: 0, posts: 0, files: 0 });
      expect(server.store.read((state) => state.posts.some((candidate) => candidate.id === post.id))).toBe(true);
    } finally {
      await server.store.close();
    }
  });
});

describe('channel retention settings', () => {
  it('stores the admin policy form value as the enforced channel limit', async () => {
    const server = await createTestServer();
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
    const server = await createTestServer();
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
    const server = await createTestServer();
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
    const server = await createTestServer();
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
    const server = await createTestServer();
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
