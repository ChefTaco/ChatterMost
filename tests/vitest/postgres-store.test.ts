import { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { createServerApp } from '../../src/server/app.js';
import { loadEnv } from '../../src/server/env.js';

const postgresUrl = process.env.CHATTERMOST_POSTGRES_TEST_URL;

describe('Postgres runtime store', () => {
  it.runIf(postgresUrl !== undefined)('persists runtime state across app instances', async () => {
    if (postgresUrl === undefined) {
      throw new Error('CHATTERMOST_POSTGRES_TEST_URL is required');
    }
    const prisma = new PrismaClient({ datasources: { db: { url: postgresUrl } } });
    await prisma.$executeRawUnsafe(
      'CREATE TABLE IF NOT EXISTS "RuntimeState" ("key" TEXT PRIMARY KEY, "value" JSONB NOT NULL, "update_at" BIGINT NOT NULL)'
    );
    await prisma.$executeRawUnsafe('DELETE FROM "RuntimeState" WHERE "key" = $1', 'default');
    await prisma.$disconnect();

    const env = loadEnv({
      enforceFileMode: false,
      overrides: {
        NODE_ENV: 'test',
        ENABLE_DEV_DEFAULTS: 'true',
        SERVER_URL: 'http://localhost:8065',
        ADMIN_PASSWORD: 'AdminChangeMe123!',
        COOKIE_SECRET: 'postgres-store-cookie-secret-with-enough-entropy',
        FILE_STORAGE_PATH: './data/postgres-test-files',
        PROFILE_IMAGE_STORAGE_PATH: './data/postgres-test-profile-images',
        DATABASE_URL: postgresUrl,
        STORE_BACKEND: 'postgres',
        ADMIN_USERNAME: 'pgtest',
        ADMIN_EMAIL: 'pgtest@example.test',
        HERMES_BOT_TOKEN: 'pgtest-hermes-token'
      }
    });
    const first = await createServerApp(env);
    const admin = first.services.users.findByUsername('pgtest');
    if (admin === null) {
      throw new Error('missing pgtest admin');
    }
    const channel = first.services.channels.listForUser(admin.id)[0];
    if (channel === undefined) {
      throw new Error('missing pgtest channel');
    }
    const post = await first.services.posts.createPost({
      actor: admin,
      channelId: channel.id,
      message: 'postgres persistence proof'
    });
    await first.store.close();

    const second = await createServerApp(env);
    const reloadedAdmin = second.services.users.findByUsername('pgtest');
    expect(reloadedAdmin?.id).toBe(admin.id);
    expect(
      second.services.posts
        .listChannelPosts(channel.id, admin)
        .some((candidate) => candidate.id === post.id && candidate.message === 'postgres persistence proof')
    ).toBe(true);
    await second.store.close();

    const beforePreflight = await prismaState(postgresUrl);
    const preflight = await createServerApp({
      ...env,
      PREFLIGHT_MODE: true,
      DATABASE_URL: withReadOnlyTransactions(postgresUrl)
    });
    expect((await preflight.app.request('/api/v4/system/ping')).status).toBe(200);
    expect((await preflight.app.request('/api/v4/users', { method: 'POST', body: '{}' })).status).toBe(503);
    const preflightAdmin = preflight.services.users.findByUsername('pgtest');
    if (preflightAdmin === null) throw new Error('missing preflight admin');
    await expect(preflight.services.users.patchUser(preflightAdmin.id, { nickname: 'must-not-persist' }, preflightAdmin)).rejects.toThrow(
      'Writes are disabled in preflight mode'
    );
    await preflight.store.close();
    expect(await prismaState(postgresUrl)).toBe(beforePreflight);

    const restored = await createServerApp({
      ...env, PREFLIGHT_MODE: true, HIVE_REHEARSAL: true, AUTHENTICATED_REHEARSAL: true,
      DATABASE_URL: withReadOnlyTransactions(postgresUrl)
    });
    const restoredLogin = await restored.app.request('/api/v4/users/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login_id: 'pgtest', password: env.ADMIN_PASSWORD })
    });
    expect(restoredLogin.status).toBe(200);
    const restoredHeaders = { Authorization: `Bearer ${restoredLogin.headers.get('Token')}` };
    expect((await restored.app.request(`/api/v4/posts/${post.id}`, { headers: restoredHeaders })).status).toBe(200);
    expect((await restored.app.request('/api/v4/posts', { method: 'POST', headers: restoredHeaders, body: '{}' })).status).toBe(503);
    await restored.store.close(); await restored.abuseControl.close();
    expect(await prismaState(postgresUrl)).toBe(beforePreflight);
  });
});

async function prismaState(databaseUrl: string): Promise<string> {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const rows = await prisma.$queryRawUnsafe<{ value: unknown }[]>('SELECT "value" FROM "RuntimeState" WHERE "key" = $1', 'default');
  await prisma.$disconnect();
  return JSON.stringify(rows[0]?.value);
}

function withReadOnlyTransactions(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('options', '-c default_transaction_read_only=on');
  return url.toString();
}
