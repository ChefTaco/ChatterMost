import { expect, it } from 'vitest';
import {
  chatBrowserResponseSchema,
  chatBrowserRoutes,
  mattermostUserSchema
} from '../../src/shared/browser-chat.js';
import { bearer, createTestServer, login } from './helpers.js';
it('owned conversation routes exist and validate actual native responses', async () => {
  const server = await createTestServer(),
    token = await login(server);
  try {
    for (const route of chatBrowserRoutes) {
      const path = '/api/v4' + route.path.replace(/\{([^}]+)\}/gu, ':$1');
      expect(
        server.app.routes.some((r) => r.method === route.method && r.path === path),
        route.method + ' ' + path
      ).toBe(true);
    }
    for (const path of ['/users/me', '/users/me/teams', '/commands', '/emoji']) {
      const response = await server.app.request('/api/v4' + path, { headers: bearer(token) });
      expect(response.status).toBe(200);
      expect(chatBrowserResponseSchema(path).safeParse(await response.json()).success, path).toBe(
        true
      );
    }
    expect(() => chatBrowserResponseSchema('/unknown')).toThrow();
    expect(() => chatBrowserResponseSchema('//example.com/users/me')).toThrow();
    expect(mattermostUserSchema.safeParse({ id: 'invalid' }).success).toBe(false);
  } finally {
    await server.store.close();
  }
});

import { readFileSync } from 'node:fs';
import { buildBrowserChatOpenApi } from '../../src/shared/browser-chat.js';
import type {
  MattermostUser,
  MattermostChannel,
  MattermostPost,
  MattermostFileInfo
} from '../../src/shared/mattermost.js';
import {
  mattermostChannelSchema,
  mattermostPostSchema,
  mattermostFileInfoSchema
} from '../../src/shared/browser-chat.js';
import type { z } from 'zod';
it('keeps generated OpenAPI current and schema outputs compatible with native mapper types', () => {
  const compatibility: {
    user: z.ZodType<MattermostUser>;
    channel: z.ZodType<MattermostChannel>;
    post: z.ZodType<MattermostPost>;
    file: z.ZodType<MattermostFileInfo>;
  } = {
    user: mattermostUserSchema,
    channel: mattermostChannelSchema,
    post: mattermostPostSchema,
    file: mattermostFileInfoSchema
  };
  expect(compatibility.user).toBe(mattermostUserSchema);
  expect(
    JSON.parse(readFileSync(new URL('../../docs/openapi-browser.json', import.meta.url), 'utf8'))
  ).toEqual(buildBrowserChatOpenApi());
});

it('validates actual conversation writes, pin/delete DTOs and uploads rather than assuming status acknowledgments', async () => {
  const server = await createTestServer(),
    token = await login(server);
  try {
    const call = async (path: string, method = 'GET', body?: object) => {
      const response = await server.app.request('/api/v4' + path, {
        method,
        headers: bearer(token),
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      expect(response.ok, path).toBe(true);
      return chatBrowserResponseSchema(path, method).parse(await response.json());
    };
    const teams = (await call('/users/me/teams')) as { id: string }[];
    const channel = (await call('/channels', 'POST', {
      team_id: teams[0]?.id,
      name: 'wire-contract',
      display_name: 'Wire Contract',
      type: 'O'
    })) as { id: string };
    const post = (await call('/posts', 'POST', {
      channel_id: channel.id,
      message: 'Synthetic wire response'
    })) as { id: string };
    await call('/posts/' + post.id + '/pin', 'POST');
    await call('/posts/' + post.id + '/unpin', 'POST');
    await call('/posts/' + post.id + '/patch', 'PUT', { message: 'Synthetic edited response' });
    await call('/posts/' + post.id, 'DELETE');
    await call('/channels/' + channel.id, 'DELETE');
  } finally {
    await server.store.close();
  }
});
