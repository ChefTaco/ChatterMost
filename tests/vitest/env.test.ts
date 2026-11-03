import { chmod, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { assertPrivateEnvFile, loadEnv } from '../../src/server/env.js';

const productionEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://chattermost_app:unique-password@127.0.0.1:55432/chattermost?schema=public',
  SERVER_URL: 'https://chat.example.test',
  PORT: '19065',
  COOKIE_SECRET: 'unique-production-cookie-secret-2026',
  TOKEN_HASH_SECRET: 'unique-production-token-hash-secret-2026',
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD: 'UniqueProductionAdminPassword-2026!',
  ADMIN_EMAIL: 'admin@example.test',
  ENABLE_DEV_DEFAULTS: 'false'
} satisfies Record<string, string>;

describe('env loader', () => {
  it('rejects group/world readable env files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'chattermost-env-'));
    const envFile = path.join(root, '.env');
    await writeFile(envFile, 'DATABASE_URL=x\n', { mode: 0o644 });
    await chmod(envFile, 0o644);
    expect(() => assertPrivateEnvFile(envFile)).toThrow(/chmod 600/u);
  });

  it('rejects a symlinked env file before loading credentials', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'chattermost-env-link-'));
    const target = path.join(root, 'runtime.env');
    const envFile = path.join(root, '.env');
    await writeFile(target, 'COOKIE_SECRET=synthetic-secret\n', { mode: 0o600 });
    await symlink(target, envFile);
    expect(() => loadEnv({ envFile, overrides: productionEnv })).toThrow(/regular file/u);
  });

  it('rejects ambiguous booleans and out-of-range ports', () => {
    expect(() =>
      loadEnv({
        enforceFileMode: false,
        overrides: { NODE_ENV: 'test', ENABLE_TELEMETRY: 'truthy' }
      })
    ).toThrow();
    expect(() =>
      loadEnv({
        enforceFileMode: false,
        overrides: { NODE_ENV: 'test', PORT: '65536' }
      })
    ).toThrow();
  });

  it('fails closed when nonexistent Redis WebSocket fanout is requested', () => {
    expect(() =>
      loadEnv({
        enforceFileMode: false,
        overrides: { NODE_ENV: 'test', ENABLE_DEV_DEFAULTS: 'true', ENABLE_REDIS_FANOUT: 'true' }
      })
    ).toThrow(/not implemented/u);
  });

  it('forbids development defaults in production even when explicit secrets are present', () => {
    expect(() =>
      loadEnv({
        envFile: '/nonexistent/chattermost-production.env',
        enforceFileMode: false,
        overrides: { ...productionEnv, ENABLE_DEV_DEFAULTS: 'true' }
      })
    ).toThrow(/ENABLE_DEV_DEFAULTS is forbidden in production/u);
  });

  it.each([
    ['COOKIE_SECRET', 'dev-cookie-secret-change-before-production'],
    ['COOKIE_SECRET', 'replace-with-at-least-32-random-characters'],
    ['TOKEN_HASH_SECRET', 'replace-with-a-separate-token-hash-secret'],
    ['ADMIN_PASSWORD', 'AdminChangeMe123!'],
    ['ADMIN_PASSWORD', 'replace-with-a-long-admin-password']
  ] as const)('rejects repository-known production value for %s', (name, value) => {
    expect(() =>
      loadEnv({
        envFile: '/nonexistent/chattermost-production.env',
        enforceFileMode: false,
        overrides: { ...productionEnv, [name]: value }
      })
    ).toThrow(/repository-known development or example value/u);
  });

  it('keeps explicitly enabled defaults available outside production', () => {
    const env = loadEnv({
      envFile: '/nonexistent/chattermost-development.env',
      enforceFileMode: false,
      overrides: {
        NODE_ENV: 'development',
        ENABLE_DEV_DEFAULTS: 'true',
        DATABASE_URL: undefined,
        SERVER_URL: undefined,
        CHAT_SERVER_URL: undefined,
        PORT: undefined,
        CHAT_SERVER_PORT: undefined,
        COOKIE_SECRET: undefined,
        TOKEN_HASH_SECRET: undefined,
        ADMIN_USERNAME: undefined,
        CHAT_SERVER_ADMIN_USERNAME: undefined,
        ADMIN_PASSWORD: undefined,
        CHAT_SERVER_ADMIN_PASSWORD: undefined,
        ADMIN_EMAIL: undefined
      }
    });
    expect(env.COOKIE_SECRET).toBe('dev-cookie-secret-change-before-production');
    expect(env.ADMIN_PASSWORD).toBe('AdminChangeMe123!');
  });
});
