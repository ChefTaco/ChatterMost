import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseArgs, readExport, readToken, sendBatches, toBatches } from '../../scripts/import-mattermost-export.mjs';
import { bearer, createTestServer, login, type TestServer } from './helpers.js';

type Thread = { import_id: string; user?: string; message: string; create_at?: number; channel_id?: string; direct_members?: string[]; replies: { import_id: string; user?: string; message: string }[] };
type Parsed = { channels: unknown[]; threads: Thread[]; summary: { posts: number; replies: number; direct_posts: number; reactions: number; lost: Record<string, number> } };
type Batch = { channels: unknown[]; posts: Thread[] };
type Totals = Record<string, number> & { unmapped_users: string[] };

const T0 = Date.UTC(2024, 0, 2, 3, 4, 5);

async function exportFile(lines: unknown[]): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chattermost-import-'));
  const file = path.join(dir, 'export.jsonl');
  await writeFile(file, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
  return file;
}

async function setup(): Promise<{ server: TestServer; token: string; teamName: string; send: (batches: Batch[], dryRun: boolean) => Promise<Totals> }> {
  const server = await createTestServer();
  const token = await login(server);
  const team = server.store.read((state) => state.teams[0]);
  if (team === undefined) throw new Error('missing team');
  for (const username of ['alice', 'bob']) {
    const user = await server.services.users.createUser({ username, email: `${username}@example.test`, password: 'SyntheticPassword123!', role: 'system_user', actorUserId: null });
    await server.services.teams.addUserToTeam(team.id, user.id, 'team_user');
  }
  const fetchImpl = (url: URL, init: RequestInit) => server.app.request(url.pathname, init);
  const send = (batches: Batch[], dryRun: boolean) => sendBatches(new URL('http://localhost:8065/api/v4/import/mattermost'), token, batches, dryRun, fetchImpl) as Promise<Totals>;
  return { server, token, teamName: team.name, send };
}

function bulkExport(teamName: string): unknown[] {
  return [
    { type: 'version', version: 1 },
    { type: 'team', team: { name: teamName, display_name: 'Team', type: 'O' } },
    { type: 'user', user: { username: 'alice', email: 'alice@example.test' } },
    { type: 'channel', channel: { team: teamName, name: 'imported-general', display_name: 'Imported general', type: 'O', header: 'h', purpose: 'p' } },
    {
      type: 'post',
      post: {
        team: teamName,
        channel: 'imported-general',
        user: 'alice',
        message: 'root from alice',
        create_at: T0,
        reactions: [{ user: 'bob', emoji_name: 'thumbsup', create_at: T0 + 5 }, { user: 'ghost', emoji_name: 'smile', create_at: T0 + 6 }],
        replies: [
          { user: 'bob', message: 'reply from bob', create_at: T0 + 1000 },
          { user: 'carol', message: 'reply from a departed user', create_at: T0 + 2000 }
        ],
        attachments: [{ path: 'data/a.png' }],
        flagged_by: ['alice']
      }
    },
    { type: 'post', post: { team: teamName, channel: 'imported-general', user: 'bob', message: 'second root', create_at: T0 + 3000 } },
    { type: 'direct_post', direct_post: { channel_members: ['alice', 'bob'], user: 'bob', message: 'private hello', create_at: T0 + 4000 } },
    { type: 'direct_post', direct_post: { channel_members: ['alice', 'carol'], user: 'carol', message: 'cannot map', create_at: T0 + 5000 } }
  ];
}

describe('Mattermost export import CLI', () => {
  it('refuses a token on the command line and reads it from the environment or a private file', async () => {
    expect(() => parseArgs(['--file', 'x.jsonl', '--token', 'secret'])).toThrow(/no longer accepted/u);
    expect(() => parseArgs(['--token=secret'])).toThrow(/no longer accepted/u);
    await expect(readToken({ tokenFile: '' }, { CHATTERMOST_IMPORT_TOKEN: ' from-env ' })).resolves.toBe('from-env');
    await expect(readToken({ tokenFile: '' }, {})).rejects.toThrow(/CHATTERMOST_IMPORT_TOKEN/u);
    const dir = await mkdtemp(path.join(os.tmpdir(), 'chattermost-token-'));
    const tokenFile = path.join(dir, 'token');
    await writeFile(tokenFile, 'from-file\n', { mode: 0o644 });
    await chmod(tokenFile, 0o644);
    await expect(readToken({ tokenFile }, {})).rejects.toThrow(/chmod 600/u);
    await chmod(tokenFile, 0o600);
    await expect(readToken({ tokenFile }, {})).resolves.toBe('from-file');
  });

  it('keeps authors, timestamps, threads and reactions and counts what it cannot carry', async () => {
    const parsed = (await readExport(await exportFile(bulkExport('team')))) as Parsed;
    expect(parsed.summary).toMatchObject({ posts: 2, replies: 2, direct_posts: 2, reactions: 2 });
    expect(parsed.summary.lost).toMatchObject({ attachments: 1, flagged: 1, users: 1, teams: 1 });
    const [root] = parsed.threads;
    expect(root).toMatchObject({ user: 'alice', create_at: T0, channel_id: 'imported-general' });
    expect(root?.replies.map((reply) => reply.user)).toEqual(['bob', 'carol']);
    const again = (await readExport(await exportFile(bulkExport('team')))) as Parsed;
    expect(again.threads.map((thread) => thread.import_id)).toEqual(parsed.threads.map((thread) => thread.import_id));
  });

  it('nests flat replies that name their root by ID', async () => {
    const parsed = (await readExport(
      await exportFile([
        { type: 'post', post: { id: 'reply1', root_id: 'root1', channel: 'c', user: 'bob', message: 'reply', create_at: T0 + 1 } },
        { type: 'post', post: { id: 'root1', channel: 'c', user: 'alice', message: 'root', create_at: T0 } }
      ])
    )) as Parsed;
    expect(parsed.threads).toHaveLength(1);
    expect(parsed.threads[0]?.import_id).toBe('mm:root1');
    expect(parsed.threads[0]?.replies.map((reply) => reply.import_id)).toEqual(['mm:reply1']);
    expect(parsed.summary).toMatchObject({ posts: 1, replies: 1 });
  });

  it('splits batches by size without splitting a thread', () => {
    const thread = (index: number): Thread => ({ import_id: `k${index}`, message: 'x'.repeat(600), channel_id: 'c', replies: [{ import_id: `k${index}/r`, message: 'y'.repeat(600) }] });
    const batches = toBatches({ channels: [{ name: 'c' }], threads: Array.from({ length: 10 }, (_, index) => thread(index)) }, 4096) as Batch[];
    expect(batches.length).toBeGreaterThan(2);
    expect(batches[0]?.channels).toHaveLength(1);
    expect(batches.slice(1).every((batch) => batch.channels.length === 0)).toBe(true);
    expect(batches.flatMap((batch) => batch.posts.map((post) => post.import_id))).toEqual(Array.from({ length: 10 }, (_, index) => `k${index}`));
  });
});

describe('Mattermost export import API', () => {
  it('imports a batch with export authors, timestamps and threads in one write, and resumes without duplicates', async () => {
    const { server, teamName, send } = await setup();
    try {
      const parsed = (await readExport(await exportFile(bulkExport(teamName)))) as Parsed;
      const batches = toBatches(parsed) as Batch[];
      const postsBefore = server.store.read((state) => state.posts.length);

      const dry = await send(batches, true);
      expect(dry).toMatchObject({ created_channels: 1, imported_posts: 3, imported_replies: 2, imported_reactions: 1, lost_reactions: 1, lost_direct_posts: 1 });
      expect(dry.unmapped_users).toEqual(['carol']);
      expect(server.store.read((state) => state.posts.length)).toBe(postsBefore);
      expect(server.store.read((state) => state.channels.some((channel) => channel.name === 'imported-general'))).toBe(false);

      const applied = await send(batches, false);
      expect(applied).toMatchObject({ created_channels: 1, created_direct_channels: 1, imported_posts: 3, imported_replies: 2, memberships_added: 2 });

      const state = server.store.read((current) => current);
      const userId = (name: string) => state.users.find((user) => user.username === name)?.id;
      const channel = state.channels.find((candidate) => candidate.name === 'imported-general');
      const root = state.posts.find((post) => post.message === 'root from alice');
      const reply = state.posts.find((post) => post.message === 'reply from bob');
      const orphan = state.posts.find((post) => post.message === 'reply from a departed user');
      expect(root).toMatchObject({ userId: userId('alice'), createAt: T0, updateAt: T0 + 2000, channelId: channel?.id, rootId: '', replyCount: 2, lastReplyAt: T0 + 2000 });
      expect(reply).toMatchObject({ userId: userId('bob'), createAt: T0 + 1000, rootId: root?.id });
      expect(orphan).toMatchObject({ userId: userId('admin'), rootId: root?.id, props: { imported_username: 'carol' } });
      expect(channel?.lastPostAt).toBe(T0 + 3000);
      expect(state.reactions.filter((reaction) => reaction.postId === root?.id).map((reaction) => reaction.emojiName)).toEqual(['thumbsup']);
      const direct = state.posts.find((post) => post.message === 'private hello');
      expect(state.channels.find((candidate) => candidate.id === direct?.channelId)?.type).toBe('D');
      expect(state.channelMembers.some((member) => member.channelId === channel?.id && member.userId === userId('bob'))).toBe(true);
      expect(state.auditLogs.find((entry) => entry.action === 'import.mattermost_archive')?.metadata).toMatchObject({ posts: 3, replies: 2 });

      const postsAfter = state.posts.length;
      const rerun = await send(toBatches((await readExport(await exportFile(bulkExport(teamName)))) as Parsed) as Batch[], false);
      expect(rerun).toMatchObject({ created_channels: 0, imported_posts: 0, imported_replies: 0, skipped_duplicates: 5 });
      expect(server.store.read((current) => current.posts.length)).toBe(postsAfter);
    } finally {
      await server.store.close();
    }
  });

  it('leaves nothing from a failing batch behind', async () => {
    const { server, teamName, send } = await setup();
    try {
      const batches: Batch[] = [
        { channels: [{ team: teamName, name: 'atomic', display_name: 'Atomic' }], posts: [{ import_id: 'a1', user: 'alice', message: 'first batch', create_at: T0, channel_id: 'atomic', replies: [] }] },
        {
          channels: [],
          posts: [
            { import_id: 'b1', user: 'alice', message: 'second batch ok', create_at: T0, channel_id: 'atomic', replies: [] },
            { import_id: 'b2', user: 'alice', message: 'second batch bad', create_at: T0, channel_id: 'no-such-channel', replies: [] }
          ]
        }
      ];
      await expect(send(batches, false)).rejects.toThrow(/Batch 2 of 2 failed with HTTP 400[\s\S]*rerun the same command to resume/u);
      const messages = server.store.read((state) => state.posts.map((post) => post.message));
      expect(messages).toContain('first batch');
      expect(messages).not.toContain('second batch ok');
    } finally {
      await server.store.close();
    }
  });

  it('accepts import batches above the general JSON body limit and rejects future timestamps', async () => {
    const { server, token, teamName } = await setup();
    try {
      const posts = Array.from({ length: 200 }, (_, index) => ({ import_id: `big${index}`, user: 'alice', message: 'z'.repeat(8000), create_at: T0 + index, channel_id: 'big', team: teamName }));
      const body = JSON.stringify({ dry_run: false, channels: [{ team: teamName, name: 'big', display_name: 'Big' }], posts });
      expect(Buffer.byteLength(body)).toBeGreaterThan(1024 * 1024);
      const response = await server.app.request('/api/v4/import/mattermost', { method: 'POST', headers: bearer(token), body });
      expect(response.status).toBe(200);
      expect(((await response.json()) as { imported_posts: number }).imported_posts).toBe(200);

      const future = await server.app.request('/api/v4/import/mattermost', {
        method: 'POST',
        headers: bearer(token),
        body: JSON.stringify({ dry_run: false, posts: [{ user: 'alice', message: 'later', create_at: Date.now() + 86_400_000, channel_id: 'big', team: teamName }] })
      });
      expect(future.status).toBe(400);

      const elsewhere = await server.app.request('/api/v4/users/me/preferences', { method: 'PUT', headers: bearer(token), body: JSON.stringify([{ category: 'x', name: 'y', value: 'v'.repeat(1024 * 1024 + 10) }]) });
      expect(elsewhere.status).toBe(413);
    } finally {
      await server.store.close();
    }
  });

  it('still accepts the earlier payload shape', async () => {
    const { server, token } = await setup();
    try {
      const channelName = 'legacy-import';
      const first = await server.app.request('/api/v4/import/mattermost', {
        method: 'POST',
        headers: bearer(token),
        body: JSON.stringify({ dry_run: false, channels: [{ name: channelName, display_name: 'Legacy' }], posts: [{ channel_id: channelName, message: 'legacy root' }] })
      });
      expect(first.status).toBe(200);
      expect(await first.json()).toMatchObject({ imported_channels: 1, imported_posts: 1, planned_channels: 1, planned_posts: 1 });
      const root = server.store.read((state) => state.posts.find((post) => post.message === 'legacy root'));
      const reply = await server.app.request('/api/v4/import/mattermost', {
        method: 'POST',
        headers: bearer(token),
        body: JSON.stringify({ dry_run: false, posts: [{ channel_id: root?.channelId, message: 'legacy reply', root_id: root?.id }] })
      });
      expect(reply.status).toBe(200);
      expect(server.store.read((state) => state.posts.find((post) => post.message === 'legacy reply')?.rootId)).toBe(root?.id);
    } finally {
      await server.store.close();
    }
  });
});
