import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createServerApp, type ServerApp } from '../../src/server/app.js';
import { loadEnv } from '../../src/server/env.js';

export type TestServer = ServerApp & {
  baseHeaders: HeadersInit;
};

export async function createTestServer(overrides: Record<string, string | undefined> = {}): Promise<TestServer> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chattermost-test-'));
  const env = loadEnv({
    enforceFileMode: false,
    overrides: {
      NODE_ENV: 'test',
      ENABLE_DEV_DEFAULTS: 'true',
      SERVER_URL: 'http://localhost:8065',
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'AdminChangeMe123!',
      ADMIN_EMAIL: 'admin@example.test',
      COOKIE_SECRET: 'test-cookie-secret-with-enough-entropy',
      FILE_STORAGE_PATH: path.join(root, 'files'),
      PROFILE_IMAGE_STORAGE_PATH: path.join(root, 'profile-images'),
      HERMES_BOT_TOKEN: 'test-hermes-token',
      RATE_LIMIT_LOGIN_SOURCE_MAX: '1000',
      RATE_LIMIT_LOGIN_ACCOUNT_MAX: '1000',
      ...overrides
    }
  });
  const server = await createServerApp(env, { storePath: null });
  return { ...server, baseHeaders: { 'Content-Type': 'application/json' } };
}

export async function login(server: Pick<TestServer, 'app' | 'baseHeaders'>): Promise<string> {
  const response = await server.app.request('/api/v4/users/login', {
    method: 'POST',
    headers: server.baseHeaders,
    body: JSON.stringify({ login_id: 'admin', password: 'AdminChangeMe123!' })
  });
  const token = response.headers.get('Token');
  if (token === null) {
    throw new Error('missing token');
  }
  return token;
}

export function bearer(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export async function firstChannelId(app: Pick<ServerApp['app'], 'request'>, token: string): Promise<string> {
  const teamsResponse = await app.request('/api/v4/users/me/teams', { headers: bearer(token) });
  const teams = (await teamsResponse.json()) as { id: string }[];
  const team = teams[0];
  if (team === undefined) {
    throw new Error('missing team');
  }
  const channelsResponse = await app.request(`/api/v4/users/me/teams/${team.id}/channels`, {
    headers: bearer(token)
  });
  const channels = (await channelsResponse.json()) as { id: string }[];
  const channel = channels[0];
  if (channel === undefined) {
    throw new Error('missing channel');
  }
  return channel.id;
}
