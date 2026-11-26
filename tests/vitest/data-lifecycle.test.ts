import { describe, expect, it } from 'vitest';

import type { FileInfoRecord, UserRecord } from '../../src/server/domain.js';
import { bearer, createTestServer, firstChannelId, login, type TestServer } from './helpers.js';

const DAY_MS = 86_400_000;

function user(server: TestServer, username: string): UserRecord {
  const found = server.store.read((state) => state.users.find((candidate) => candidate.username === username));
  if (found === undefined) throw new Error(`missing ${username}`);
  return found;
}

async function fileExists(server: TestServer, file: FileInfoRecord): Promise<boolean> {
  try {
    await server.services.files.readFile(file);
    return true;
  } catch {
    return false;
  }
}

async function age(server: TestServer, ids: string[], days: number, field: 'createAt' | 'deleteAt' = 'createAt'): Promise<void> {
  await server.store.write((state) => {
    for (const record of [...state.posts, ...state.files]) if (ids.includes(record.id)) record[field] = Date.now() - days * DAY_MS;
  });
}

async function member(server: TestServer, channelId: string, username: string): Promise<{ user: UserRecord; token: string }> {
  const created = await server.services.users.createUser({ username, email: `${username}@example.test`, password: 'SyntheticPassword123!', role: 'system_user', actorUserId: null });
  const team = server.store.read((state) => state.teams[0]);
  if (team === undefined) throw new Error('missing team');
  await server.services.teams.addUserToTeam(team.id, created.id, 'team_user');
  await server.services.channels.addUserToChannel(channelId, created.id, '');
  const response = await server.app.request('/api/v4/users/login', { method: 'POST', headers: server.baseHeaders, body: JSON.stringify({ login_id: username, password: 'SyntheticPassword123!' }) });
  return { user: created, token: response.headers.get('Token') ?? '' };
}

const text = (value: string) => new TextEncoder().encode(value);

describe('attachment and deleted-content collection', () => {
  it('stops serving a deleted post’s attachments and removes their bytes at the next sweep', async () => {
    const server = await createTestServer();
    try {
      const token = await login(server);
      const channelId = await firstChannelId(server.app, token);
      const admin = user(server, 'admin');
      const file = await server.services.files.storeFile({ userId: admin.id, channelId, name: 'note.txt', mimeType: 'text/plain', bytes: text('synthetic attachment') });
      const post = await server.services.posts.createPost({ actor: admin, channelId, message: 'with file', fileIds: [file.id] });
      expect((await server.app.request(`/api/v4/files/${file.id}`, { headers: bearer(token) })).status).toBe(200);

      expect((await server.app.request(`/api/v4/posts/${post.id}`, { method: 'DELETE', headers: bearer(token) })).status).toBe(200);
      expect((await server.app.request(`/api/v4/files/${file.id}`, { headers: bearer(token) })).status).toBe(404);
      expect(await fileExists(server, file)).toBe(true);

      const result = await server.services.retention.sweep();
      expect(result).toMatchObject({ unreferencedFiles: 1, redactedPosts: 0 });
      expect(await fileExists(server, file)).toBe(false);
      expect(server.store.read((state) => state.files.some((candidate) => candidate.id === file.id))).toBe(false);
      expect(server.store.read((state) => state.auditLogs.find((entry) => entry.action === 'content.unreferenced_purged')?.metadata)).toMatchObject({ files: 1 });
      // Without a deleted-post limit the text stays for moderation review.
      expect(server.store.read((state) => state.posts.find((candidate) => candidate.id === post.id)?.message)).toBe('with file');
    } finally {
      await server.store.close();
    }
  });

  it('removes uploads no post references only after the grace period', async () => {
    const server = await createTestServer({ ORPHAN_UPLOAD_GRACE_HOURS: '168' });
    try {
      const token = await login(server);
      const channelId = await firstChannelId(server.app, token);
      const admin = user(server, 'admin');
      const upload = (name: string) => server.services.files.storeFile({ userId: admin.id, channelId, name, mimeType: 'text/plain', bytes: text(name) });
      const fresh = await upload('fresh-draft.txt');
      const stale = await upload('stale-draft.txt');
      const attached = await upload('attached.txt');
      await server.services.posts.createPost({ actor: admin, channelId, message: 'kept', fileIds: [attached.id] });
      await age(server, [stale.id, attached.id], 8);

      expect(await server.services.retention.sweep()).toMatchObject({ unreferencedFiles: 1 });
      expect(await fileExists(server, stale)).toBe(false);
      expect(await fileExists(server, fresh)).toBe(true);
      expect(await fileExists(server, attached)).toBe(true);
    } finally {
      await server.store.close();
    }

    const keepAll = await createTestServer({ ORPHAN_UPLOAD_GRACE_HOURS: '0' });
    try {
      const token = await login(keepAll);
      const channelId = await firstChannelId(keepAll.app, token);
      const stale = await keepAll.services.files.storeFile({ userId: user(keepAll, 'admin').id, channelId, name: 'kept.txt', mimeType: 'text/plain', bytes: text('kept') });
      await age(keepAll, [stale.id], 400);
      expect(await keepAll.services.retention.sweep()).toMatchObject({ unreferencedFiles: 0 });
      expect(await fileExists(keepAll, stale)).toBe(true);
    } finally {
      await keepAll.store.close();
    }
  });

  it('clears the text of long-deleted posts when DELETED_POST_PURGE_DAYS is set', async () => {
    const server = await createTestServer({ DELETED_POST_PURGE_DAYS: '30' });
    try {
      const token = await login(server);
      const channelId = await firstChannelId(server.app, token);
      const admin = user(server, 'admin');
      const old = await server.services.posts.createPost({ actor: admin, channelId, message: 'deleted long ago' });
      await server.services.posts.patchPost(old.id, { message: 'deleted long ago, edited' }, admin);
      const recent = await server.services.posts.createPost({ actor: admin, channelId, message: 'deleted recently' });
      await server.services.posts.deletePost(old.id, admin);
      await server.services.posts.deletePost(recent.id, admin);
      await age(server, [old.id], 31, 'deleteAt');

      expect(await server.services.retention.sweep()).toMatchObject({ redactedPosts: 1 });
      const state = server.store.read((current) => current);
      expect(state.posts.find((post) => post.id === old.id)).toMatchObject({ message: '', props: {}, fileIds: [] });
      expect(state.postEditHistory.some((entry) => entry.postId === old.id)).toBe(false);
      expect(state.posts.find((post) => post.id === recent.id)?.message).toBe('deleted recently');
      expect(await server.services.retention.sweep()).toMatchObject({ redactedPosts: 0 });
    } finally {
      await server.store.close();
    }
  });
});

describe('thread deletion', () => {
  type Event = { event: string; data: Record<string, unknown> };
  function listen(server: TestServer, userId: string): Event[] {
    const events: Event[] = [];
    server.services.hub.attach({ send: (frame: string) => events.push(JSON.parse(frame) as Event), close: () => undefined } as never, userId);
    return events;
  }
  const deletedIds = (events: Event[]) => events.filter((event) => event.event === 'post_deleted').map((event) => event.data.post_id as string).sort();

  it('deletes the replies and their attachments when the root’s author deletes the root', async () => {
    const server = await createTestServer();
    try {
      const adminToken = await login(server);
      const channelId = await firstChannelId(server.app, adminToken);
      const author = await member(server, channelId, 'thread-author');
      const other = await member(server, channelId, 'thread-replier');
      const posts = server.services.posts;
      const root = await posts.createPost({ actor: author.user, channelId, message: 'root' });
      const replyFile = await server.services.files.storeFile({ userId: other.user.id, channelId, name: 'reply.txt', mimeType: 'text/plain', bytes: text('reply attachment') });
      const ownReply = await posts.createPost({ actor: author.user, channelId, message: 'own reply', rootId: root.id });
      const otherReply = await posts.createPost({ actor: other.user, channelId, message: 'other reply', fileIds: [replyFile.id], rootId: root.id });
      const heldReply = await posts.createPost({ actor: author.user, channelId, message: 'held reply', rootId: root.id });
      await server.store.write((state) => {
        const held = state.posts.find((post) => post.id === heldReply.id);
        if (held !== undefined) held.lifecycleState = 'quarantined';
      });
      const otherThread = await posts.createPost({ actor: other.user, channelId, message: 'another root' });
      const otherThreadReply = await posts.createPost({ actor: author.user, channelId, message: 'reply elsewhere', rootId: otherThread.id });
      const events = listen(server, other.user.id);

      expect((await server.app.request(`/api/v4/posts/${root.id}`, { method: 'DELETE', headers: bearer(author.token) })).status).toBe(200);

      const state = server.store.read((current) => current);
      for (const id of [root.id, ownReply.id, otherReply.id, heldReply.id]) {
        expect(state.posts.find((post) => post.id === id)).toMatchObject({ deleteBy: author.user.id, lifecycleState: 'deleted' });
        expect(state.posts.find((post) => post.id === id)?.deleteAt).toBeGreaterThan(0);
      }
      for (const id of [otherThread.id, otherThreadReply.id]) expect(state.posts.find((post) => post.id === id)?.deleteAt).toBe(0);
      // A held reply's deletion is only announced to its author and admins.
      expect(deletedIds(events)).toEqual([root.id, ownReply.id, otherReply.id].sort());
      const replyEvent = events.find((event) => event.event === 'post_deleted' && event.data.post_id === otherReply.id);
      expect(JSON.parse(replyEvent?.data.post as string)).toMatchObject({ id: otherReply.id, root_id: root.id, message: '' });
      expect(state.auditLogs.find((entry) => entry.action === 'post.deleted' && entry.targetId === root.id)).toMatchObject({ actorUserId: author.user.id, metadata: { deleted_replies: 3 } });

      expect((await server.app.request(`/api/v4/posts/${otherReply.id}`, { headers: bearer(other.token) })).status).toBe(404);
      expect((await server.app.request(`/api/v4/posts/${root.id}/thread`, { headers: bearer(other.token) })).status).toBe(404);
      expect((await server.app.request(`/api/v4/files/${replyFile.id}`, { headers: bearer(other.token) })).status).toBe(404);
      expect(await server.services.retention.sweep()).toMatchObject({ unreferencedFiles: 1 });
      expect(await fileExists(server, replyFile)).toBe(false);
    } finally {
      await server.store.close();
    }
  });

  it('lets an admin delete a member’s thread, while a reply’s author removes only their reply', async () => {
    const server = await createTestServer();
    try {
      const adminToken = await login(server);
      const channelId = await firstChannelId(server.app, adminToken);
      const author = await member(server, channelId, 'root-owner');
      const replier = await member(server, channelId, 'reply-owner');
      const posts = server.services.posts;
      const root = await posts.createPost({ actor: author.user, channelId, message: 'root' });
      const reply = await posts.createPost({ actor: replier.user, channelId, message: 'reply', rootId: root.id });
      const sibling = await posts.createPost({ actor: author.user, channelId, message: 'sibling', rootId: root.id });

      // A reply's author cannot remove someone else's thread.
      expect((await server.app.request(`/api/v4/posts/${root.id}`, { method: 'DELETE', headers: bearer(replier.token) })).status).toBe(403);
      // Deleting a reply leaves its root and the other replies alone.
      expect((await server.app.request(`/api/v4/posts/${reply.id}`, { method: 'DELETE', headers: bearer(replier.token) })).status).toBe(200);
      let state = server.store.read((current) => current);
      expect(state.posts.find((post) => post.id === root.id)?.deleteAt).toBe(0);
      expect(state.posts.find((post) => post.id === sibling.id)?.deleteAt).toBe(0);
      expect(state.auditLogs.find((entry) => entry.action === 'post.deleted' && entry.targetId === reply.id)?.metadata).toEqual({});

      const events = listen(server, author.user.id);
      expect((await server.app.request(`/api/v4/posts/${root.id}`, { method: 'DELETE', headers: bearer(adminToken) })).status).toBe(200);
      state = server.store.read((current) => current);
      const admin = user(server, 'admin');
      expect(state.posts.find((post) => post.id === sibling.id)).toMatchObject({ deleteBy: admin.id, lifecycleState: 'deleted' });
      // The reply deleted earlier keeps its own deletion record.
      expect(state.posts.find((post) => post.id === reply.id)?.deleteBy).toBe(replier.user.id);
      expect(deletedIds(events)).toEqual([root.id, sibling.id].sort());
      expect(state.auditLogs.find((entry) => entry.action === 'post.deleted' && entry.targetId === root.id)).toMatchObject({ actorUserId: admin.id, metadata: { deleted_replies: 1 } });
    } finally {
      await server.store.close();
    }
  });
});

describe('per-user export and erase', () => {
  it('exports everything stored about one account without credentials', async () => {
    const server = await createTestServer();
    try {
      const token = await login(server);
      const channelId = await firstChannelId(server.app, token);
      const alice = await member(server, channelId, 'alice');
      const file = await server.services.files.storeFile({ userId: alice.user.id, channelId, name: 'alice.txt', mimeType: 'text/plain', bytes: text('alice bytes') });
      const post = await server.services.posts.createPost({ actor: alice.user, channelId, message: 'hello from alice', fileIds: [file.id] });
      await server.services.reactions.add({ actor: alice.user, postId: post.id, emojiName: 'wave' });
      await server.services.preferences.set(alice.user.id, [{ category: 'display_settings', name: 'theme', value: 'dark' }], alice.user);

      expect((await server.app.request(`/admin/users/${alice.user.id}/export`, { headers: bearer(alice.token) })).status).toBe(403);
      const response = await server.app.request(`/admin/users/${alice.user.id}/export`, { headers: bearer(token) });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-disposition')).toContain('attachment');
      const raw = await response.text();
      const data = JSON.parse(raw) as { user: { username: string }; posts: { message: string }[]; reactions: { emoji_name: string }[]; files: { id: string; download: string }[]; preferences: unknown[]; sessions: unknown[]; channels: unknown[] };
      expect(data.user.username).toBe('alice');
      expect(data.posts.map((entry) => entry.message)).toEqual(['hello from alice']);
      expect(data.reactions.map((entry) => entry.emoji_name)).toEqual(['wave']);
      expect(data.preferences).toHaveLength(1);
      expect(data.sessions).toHaveLength(1);
      expect(data.channels.length).toBeGreaterThan(0);
      for (const secretField of ['passwordHash', 'password_hash', 'tokenHash', 'token_hash', 'oathweaveContext']) expect(raw).not.toContain(secretField);
      expect(raw).not.toContain(alice.user.passwordHash);

      const download = await server.app.request(data.files[0]?.download ?? '', { headers: bearer(token) });
      expect(download.status).toBe(200);
      expect(await download.text()).toBe('alice bytes');
      expect(server.store.read((state) => state.auditLogs.some((entry) => entry.action === 'admin.user.exported' && entry.targetId === alice.user.id))).toBe(true);
    } finally {
      await server.store.close();
    }
  });

  it('erases an account after confirmation and keeps other people’s threads intact', async () => {
    const server = await createTestServer();
    try {
      const token = await login(server);
      const channelId = await firstChannelId(server.app, token);
      const alice = await member(server, channelId, 'alice');
      const bob = await member(server, channelId, 'bob');
      const file = await server.services.files.storeFile({ userId: alice.user.id, channelId, name: 'alice.txt', mimeType: 'text/plain', bytes: text('alice bytes') });
      const root = await server.services.posts.createPost({ actor: alice.user, channelId, message: 'alice root', fileIds: [file.id] });
      const reply = await server.services.posts.createPost({ actor: bob.user, channelId, message: 'bob reply', rootId: root.id });
      await server.services.reactions.add({ actor: alice.user, postId: reply.id, emojiName: 'thumbsup' });
      const erase = (body: unknown, as = token) => server.app.request(`/admin/users/${alice.user.id}/erase`, { method: 'POST', headers: bearer(as), body: JSON.stringify(body) });

      const dry = await erase({});
      expect(await dry.json()).toMatchObject({ dry_run: true, posts: 1, reactions: 1, files: 1, sessions: 1 });
      expect(server.store.read((state) => state.posts.find((post) => post.id === root.id)?.message)).toBe('alice root');
      expect((await erase({ dry_run: false, confirm: 'not-alice' })).status).toBe(400);
      expect((await erase({ dry_run: false, confirm: 'alice' }, bob.token)).status).toBe(403);
      const self = await server.app.request(`/admin/users/${user(server, 'admin').id}/erase`, { method: 'POST', headers: bearer(token), body: JSON.stringify({ dry_run: false, confirm: 'admin' }) });
      expect(self.status).toBe(403);

      const applied = await erase({ dry_run: false, confirm: 'alice' });
      expect(applied.status).toBe(200);
      const state = server.store.read((current) => current);
      const erased = state.users.find((candidate) => candidate.id === alice.user.id);
      expect(erased?.username).toMatch(/^erased-/u);
      expect(erased?.email).toMatch(/@erased\.invalid$/u);
      expect(erased?.deleteAt).toBeGreaterThan(0);
      expect(state.posts.find((post) => post.id === root.id)).toMatchObject({ message: '', fileIds: [], lifecycleState: 'deleted' });
      expect(state.posts.find((post) => post.id === reply.id)).toMatchObject({ message: 'bob reply', rootId: root.id });
      expect(state.reactions.some((reaction) => reaction.userId === alice.user.id)).toBe(false);
      expect(state.sessions.some((session) => session.userId === alice.user.id)).toBe(false);
      expect(state.channelMembers.some((entry) => entry.userId === alice.user.id)).toBe(false);
      expect(await fileExists(server, file)).toBe(false);
      expect((await server.app.request('/api/v4/users/me', { headers: bearer(alice.token) })).status).toBe(401);
      expect(state.auditLogs.find((entry) => entry.action === 'admin.user.erased')?.metadata).toMatchObject({ posts: 1, files: 1 });
      const relogin = await server.app.request('/api/v4/users/login', { method: 'POST', headers: server.baseHeaders, body: JSON.stringify({ login_id: 'alice', password: 'SyntheticPassword123!' }) });
      expect(relogin.status).toBeGreaterThanOrEqual(400);
      expect(relogin.headers.get('Token')).toBeNull();
    } finally {
      await server.store.close();
    }
  });
});
