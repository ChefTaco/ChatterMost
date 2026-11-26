import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { PostRecord, StoreState } from '../../src/server/domain.js';
import { createDraft, createEmptyState, JsonStore } from '../../src/server/store.js';

function syntheticPost(index: number): PostRecord {
  return {
    id: `post${String(index).padStart(22, '0')}`,
    createAt: 1_700_000_000_000 + index,
    updateAt: 1_700_000_000_000 + index,
    editAt: 0,
    deleteAt: 0,
    isPinned: false,
    userId: 'u'.repeat(26),
    channelId: 'c'.repeat(26),
    rootId: '',
    originalId: '',
    message: `synthetic message ${index} with some ordinary chat text`,
    type: '',
    props: {},
    hashtags: '',
    fileIds: [],
    pendingPostId: '',
    replyCount: 0,
    lastReplyAt: 0,
    metadata: { embeds: [], emojis: [], files: [], has_reactions: false, mentions: [] },
    lifecycleState: 'approved'
  };
}

describe('copy-on-write store drafts', () => {
  it('clones only the fields a write touches and never mutates the previous state', () => {
    const current: StoreState = createEmptyState();
    current.posts.push(syntheticPost(1));
    const { draft, commit } = createDraft(current);
    draft.preferences.push({ id: 'p', userId: 'u', category: 'c', name: 'n', value: 'v', createAt: 1, updateAt: 1 });
    draft.auditSequence += 1;
    const { next, touched } = commit();
    expect([...touched].sort()).toEqual(['auditSequence', 'metrics', 'preferences']);
    expect(next.posts).toBe(current.posts);
    expect(next.users).toBe(current.users);
    expect(next.preferences).not.toBe(current.preferences);
    expect(current.preferences).toHaveLength(0);
    expect(current.auditSequence).toBe(0);
    expect(next.auditSequence).toBe(1);

    const second = createDraft(next);
    const post = second.draft.posts[0];
    if (post === undefined) throw new Error('missing post');
    post.message = 'edited';
    const edited = second.commit().next;
    expect(edited.posts[0]?.message).toBe('edited');
    expect(next.posts[0]?.message).toBe('synthetic message 1 with some ordinary chat text');
  });

  it('refuses fields that are not part of the state document', () => {
    const { draft } = createDraft(createEmptyState());
    expect(() => {
      (draft as unknown as Record<string, unknown>).notAField = [];
    }).toThrow(TypeError);
  });
});

describe('store write cost with a large history (regression guard)', () => {
  it('keeps writes that do not touch posts independent of 100,000 stored posts', async () => {
    const store = new JsonStore(null);
    await store.initialize();
    await store.write((state) => {
      for (let index = 0; index < 100_000; index += 1) state.posts.push(syntheticPost(index));
    });
    const posts = store.read((state) => state.posts);

    const started = performance.now();
    for (let index = 0; index < 200; index += 1) {
      await store.write((state) => {
        state.auditSequence += 1;
        state.statuses.push({ user_id: `user${index}`, status: 'online', manual: false, last_activity_at: index });
      });
    }
    const elapsed = performance.now() - started;
    // Copying 100k posts for each of these writes took tens of milliseconds apiece; now they share it.
    expect(store.read((state) => state.posts)).toBe(posts);
    expect(elapsed).toBeLessThan(5_000);

    await store.write((state) => {
      state.posts.push(syntheticPost(100_000));
    });
    expect(store.read((state) => state.posts.length)).toBe(100_001);
    expect(posts).toHaveLength(100_000);
  }, 60_000);

  it('writes the JSON store compactly', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'chattermost-store-'));
    const file = path.join(dir, 'store.json');
    const store = new JsonStore(file);
    await store.initialize();
    await store.write((state) => {
      for (let index = 0; index < 100; index += 1) state.posts.push(syntheticPost(index));
    });
    await store.close();
    const raw = await readFile(file, 'utf8');
    expect(raw).not.toContain('\n');
    const reopened = new JsonStore(file);
    await reopened.initialize();
    expect(reopened.read((state) => state.posts.length)).toBe(100);
    await reopened.close();
  });
});
