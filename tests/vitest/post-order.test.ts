import { describe, expect, it } from 'vitest';

import { bearer, createTestServer, firstChannelId, login } from './helpers.js';

type PostList = { order: string[]; posts: Record<string, { create_at: number }>; next_post_id: string; prev_post_id: string };

describe('post list wire order', () => {
  it('sends order newest first with upstream paging cursors', async () => {
    const server = await createTestServer();
    try {
      const token = await login(server);
      const channelId = await firstChannelId(server.app, token);
      const existing = ((await (await server.app.request(`/api/v4/channels/${channelId}/posts?per_page=200`, { headers: bearer(token) })).json()) as PostList).order.length;
      expect(existing).toBe(0);
      const created: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        const response = await server.app.request('/api/v4/posts', { method: 'POST', headers: bearer(token), body: JSON.stringify({ channel_id: channelId, message: `order ${index}` }) });
        created.push(((await response.json()) as { id: string }).id);
      }
      const get = async (query: string) => (await (await server.app.request(`/api/v4/channels/${channelId}/posts?${query}`, { headers: bearer(token) })).json()) as PostList;
      const newestFirst = [...created].reverse();

      const all = await get('per_page=60');
      expect(all.order).toEqual(newestFirst);
      expect(all).toMatchObject({ next_post_id: '', prev_post_id: '' });

      const first = await get('page=0&per_page=2');
      expect(first.order).toEqual(newestFirst.slice(0, 2));
      expect(first).toMatchObject({ next_post_id: '', prev_post_id: created[3] });

      const back = await get(`before=${first.prev_post_id}&per_page=2`);
      expect(back.order).toEqual([created[2], created[1]]);
      expect(back).toMatchObject({ next_post_id: created[2], prev_post_id: created[1] });

      const oldest = await get(`before=${back.prev_post_id}&per_page=2`);
      expect(oldest.order).toEqual([created[0]]);
      expect(oldest).toMatchObject({ next_post_id: created[0], prev_post_id: '' });

      const forward = await get(`after=${created[0]}&per_page=2`);
      expect(forward.order).toEqual([created[2], created[1]]);
      expect(forward).toMatchObject({ next_post_id: created[2], prev_post_id: created[1] });

      const thread = (await (await server.app.request(`/api/v4/posts/${created[0]}/thread`, { headers: bearer(token) })).json()) as PostList;
      expect(thread.order).toEqual([created[0]]);

      const search = (await (await server.app.request('/api/v4/posts/search', { method: 'POST', headers: bearer(token), body: JSON.stringify({ terms: 'order' }) })).json()) as PostList;
      expect(search.order).toEqual(newestFirst);
    } finally {
      await server.store.close();
    }
  });
});
