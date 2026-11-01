import { statSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';
import { parse as parseDotenv } from 'dotenv';

const Boolish = z.union([z.boolean(), z.enum(['0', '1', 'false', 'true', 'no', 'yes', 'off', 'on'])]).transform((value) => (typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'on'].includes(value)));

const DEV_COOKIE_SECRET = 'dev-cookie-secret-change-before-production';
const DEV_ADMIN_PASSWORD = 'AdminChangeMe123!';
const EXAMPLE_COOKIE_SECRET = 'replace-with-at-least-32-random-characters';
const EXAMPLE_TOKEN_HASH_SECRET = 'replace-with-a-separate-token-hash-secret';
const EXAMPLE_ADMIN_PASSWORD = 'replace-with-a-long-admin-password';

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  SERVER_URL: z.url(),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8065),
  COOKIE_SECRET: z.string().min(24),
  TOKEN_HASH_SECRET: z.string().min(24),
  SECURITY_FUSION_SERVICE_TOKEN_HASH: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.string().regex(/^[a-f0-9]{64}$/u).optional()
  ),
  ADMIN_USERNAME: z.string().min(2),
  ADMIN_PASSWORD: z.string().min(10),
  ADMIN_EMAIL: z.email(),
  ADMIN_FORCE_PASSWORD_RESET: Boolish.default(false),
  SESSION_COOKIE_NAME: z.string().min(1).default('MMSID'),
  SESSION_DAYS: z.coerce.number().int().positive().default(30),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HERMES_BOT_USERNAME: z.string().min(1).default('hermes'),
  HERMES_BOT_DISPLAY_NAME: z.string().min(1).default('Hermes Agent'),
  HERMES_BOT_TOKEN: z.string().optional().default(''),
  HERMES_ALLOWED_USER_IDS: z.string().optional().default(''),
  FILE_STORAGE_PATH: z.string().min(1).default('./data/files'),
  PROFILE_IMAGE_STORAGE_PATH: z.string().min(1).default('./data/profile-images'),
  STORE_BACKEND: z.enum(['json', 'postgres']).default('json'),
  STORE_PATH: z.string().min(1).default('./data/chattermost-store.json'),
  ENABLE_TELEMETRY: Boolish.default(false),
  ENABLE_DIAGNOSTICS: Boolish.default(false),
  ENABLE_SECURITY_ALERT_CHECKS: Boolish.default(false),
  ENABLE_PUBLIC_FILE_LINKS: Boolish.default(false),
  ENABLE_REDIS_FANOUT: Boolish.default(false),
  ENABLE_DISTRIBUTED_RATE_LIMIT: Boolish.default(false),
  REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379'),
  COMPATIBILITY_SERVER_VERSION: z.string().default('11.8.0'),
  COMPATIBILITY_PROFILE: z.string().default('mattermost-v11.8'),
  BUILD_NUMBER: z.string().default('chattermost-0.1.0'),
  BUILD_HASH: z.string().default('local'),
  BUILD_DATE: z.string().default(new Date(0).toISOString()),
  RELEASE_ID: z.string().default('local'),
  ALLOW_VERSION_ADVERTISEMENT: Boolish.default(false),
  TRUSTED_PROXIES: z.string().default(''),
  RATE_LIMIT_MAX_KEYS: z.coerce.number().int().min(100).max(100_000).default(10_000),
  RATE_LIMIT_LOGIN_SOURCE_MAX: z.coerce.number().int().min(1).max(10_000).default(20),
  RATE_LIMIT_LOGIN_ACCOUNT_MAX: z.coerce.number().int().min(1).max(10_000).default(20),
  PREFLIGHT_MODE: Boolish.default(false),
  ENABLE_DEV_DEFAULTS: Boolish.default(false)
}).superRefine((value, context) => {
  if (value.ENABLE_REDIS_FANOUT) {
    context.addIssue({
      code: 'custom',
      path: ['ENABLE_REDIS_FANOUT'],
      message: 'Redis WebSocket fanout is not implemented; ENABLE_REDIS_FANOUT must remain false'
    });
  }
  if (value.NODE_ENV !== 'production') return;
  if (value.ENABLE_DEV_DEFAULTS) {
    context.addIssue({
      code: 'custom',
      path: ['ENABLE_DEV_DEFAULTS'],
      message: 'ENABLE_DEV_DEFAULTS is forbidden in production'
    });
  }
  for (const [path, unsafe, message] of [
    ['COOKIE_SECRET', new Set([DEV_COOKIE_SECRET, EXAMPLE_COOKIE_SECRET]), 'COOKIE_SECRET must not use a repository-known development or example value'],
    ['TOKEN_HASH_SECRET', new Set([DEV_COOKIE_SECRET, EXAMPLE_TOKEN_HASH_SECRET]), 'TOKEN_HASH_SECRET must not use a repository-known development or example value'],
    ['ADMIN_PASSWORD', new Set([DEV_ADMIN_PASSWORD, EXAMPLE_ADMIN_PASSWORD]), 'ADMIN_PASSWORD must not use a repository-known development or example value']
  ] as const) {
    if (unsafe.has(value[path])) {
      context.addIssue({ code: 'custom', path: [path], message });
    }
  }
});

export type AppEnv = z.infer<typeof EnvSchema>;

export type LoadEnvOptions = {
  envFile?: string;
  overrides?: Record<string, string | undefined>;
  enforceFileMode?: boolean;
};

export function loadEnv(options: LoadEnvOptions = {}): AppEnv {
  const envFile = options.envFile ?? '.env';
  const fileValues = parseEnvFile(envFile);
  const merged = {
    ...process.env,
    ...fileValues,
    ...options.overrides
  };

  const mapped = mapDeployEnv(merged);
  const shouldUseDevDefaults = mapped.NODE_ENV !== 'production'
    && (mapped.ENABLE_DEV_DEFAULTS === 'true' || mapped.NODE_ENV === 'test' || !mapped.DATABASE_URL);

  const withDefaults = shouldUseDevDefaults ? applyDevDefaults(mapped) : mapped;
  const withDerivedSecrets = {
    ...withDefaults,
    TOKEN_HASH_SECRET: withDefaults.TOKEN_HASH_SECRET ?? withDefaults.COOKIE_SECRET
  };

  if (options.enforceFileMode !== false && existsSync(envFile)) {
    assertPrivateEnvFile(envFile);
  }

  return EnvSchema.parse(withDerivedSecrets);
}

export function assertPrivateEnvFile(envFile: string): void {
  const stats = statSync(envFile);
  if ((stats.mode & 0o077) !== 0) {
    throw new Error(`${envFile} must be chmod 600; current mode exposes group/world bits`);
  }
}

export function redactSecret(value: string): string {
  if (value.length <= 8) {
    return '<redacted>';
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function parseEnvFile(envFile: string): Record<string, string> {
  if (!existsSync(envFile)) {
    return {};
  }

  const raw = readFileSync(envFile, 'utf8');
  const values: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }
    const equalsAt = trimmed.indexOf('=');
    if (equalsAt === -1) {
      continue;
    }
    const key = trimmed.slice(0, equalsAt).trim();
    const rawValue = trimmed.slice(equalsAt + 1).trim();
    values[key] = parseEnvValue(key, rawValue);
  }
  return values;
}

function parseEnvValue(key: string, value: string): string {
  if (value.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === 'string') return parsed;
    } catch {
      // Fall through for legacy shell/dotenv quoting that is not a JSON string.
    }
  }
  return parseDotenv(`${key}=${value}`)[key] ?? '';
}

function mapDeployEnv(values: Record<string, string | undefined>): Record<string, string | undefined> {
  const mapped = { ...values };
  mapped.SERVER_URL = mapped.SERVER_URL ?? mapped.CHAT_SERVER_URL;
  mapped.PORT = mapped.PORT ?? mapped.CHAT_SERVER_PORT;
  mapped.ADMIN_USERNAME = mapped.ADMIN_USERNAME ?? mapped.CHAT_SERVER_ADMIN_USERNAME;
  mapped.ADMIN_PASSWORD = mapped.ADMIN_PASSWORD ?? mapped.CHAT_SERVER_ADMIN_PASSWORD;
  mapped.NODE_ENV = mapped.NODE_ENV ?? 'development';
  return mapped;
}

function applyDevDefaults(values: Record<string, string | undefined>): Record<string, string | undefined> {
  const serverUrl = values.SERVER_URL ?? 'http://localhost:8065';
  const adminUsername = values.ADMIN_USERNAME ?? 'admin';
  const inferredPort = new URL(serverUrl).port || '8065';
  return {
    ...values,
    DATABASE_URL: values.DATABASE_URL ?? 'postgresql://chattermost_app:dev-password@localhost:55432/chattermost?schema=public',
    SERVER_URL: serverUrl,
    PORT: values.PORT ?? inferredPort,
    COOKIE_SECRET: values.COOKIE_SECRET ?? DEV_COOKIE_SECRET,
    ADMIN_USERNAME: adminUsername,
    ADMIN_PASSWORD: values.ADMIN_PASSWORD ?? DEV_ADMIN_PASSWORD,
    ADMIN_EMAIL: values.ADMIN_EMAIL ?? `${adminUsername}@localhost.test`,
    NODE_ENV: values.NODE_ENV ?? 'development',
    ENABLE_DEV_DEFAULTS: 'true'
  };
}

export function resolveDataPath(value: string): string {
  return path.resolve(process.cwd(), value);
}
