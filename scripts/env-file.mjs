#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { appendFile, chmod, readFile, rename, rm, writeFile } from 'node:fs/promises';

import { parse } from 'dotenv';

const [command, ...args] = process.argv.slice(2);

function serializeValue(value) {
  if (value.includes('\n') || value.includes('\r') || value.includes('\0')) {
    throw new Error('Environment values must not contain newline, carriage-return, or NUL characters');
  }
  return JSON.stringify(value);
}

function serialize(values) {
  return Object.entries(values).map(([name, value]) => `${name}=${serializeValue(String(value))}`).join('\n') + '\n';
}

async function readValues(file) {
  const raw = await readFile(file, 'utf8');
  const values = {};
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const equalsAt = trimmed.indexOf('=');
    if (equalsAt < 1) continue;
    const name = trimmed.slice(0, equalsAt).trim();
    const encoded = trimmed.slice(equalsAt + 1).trim();
    if (encoded.startsWith('"')) {
      try {
        values[name] = JSON.parse(encoded);
        continue;
      } catch {
        // Preserve compatibility with legacy dotenv quoting.
      }
    }
    values[name] = parse(`${name}=${encoded}`)[name];
  }
  return values;
}

async function writePrivate(file, contents) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, { flag: 'wx', mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

function runtimeValues() {
  const values = {
    NODE_ENV: 'production',
    PORT: process.env.DEPLOY_RUNTIME_PORT,
    SERVER_URL: process.env.CHAT_SERVER_URL,
    DATABASE_URL: `postgresql://chattermost_app:${process.env.DEPLOY_POSTGRES_PASSWORD}@127.0.0.1:55432/chattermost?schema=public`,
    POSTGRES_PASSWORD: process.env.DEPLOY_POSTGRES_PASSWORD,
    COOKIE_SECRET: process.env.DEPLOY_COOKIE_SECRET,
    TOKEN_HASH_SECRET: process.env.DEPLOY_TOKEN_HASH_SECRET,
    ADMIN_USERNAME: process.env.CHAT_SERVER_ADMIN_USERNAME,
    ADMIN_PASSWORD: process.env.CHAT_SERVER_ADMIN_PASSWORD,
    ADMIN_EMAIL: process.env.CHAT_SERVER_ADMIN_EMAIL ?? 'admin@localhost.test',
    SESSION_COOKIE_NAME: 'MMSID',
    SESSION_DAYS: '30',
    HERMES_BOT_USERNAME: process.env.HERMES_BOT_USERNAME ?? 'hermes',
    HERMES_BOT_DISPLAY_NAME: process.env.HERMES_BOT_DISPLAY_NAME ?? 'Hermes Agent',
    HERMES_BOT_TOKEN: process.env.HERMES_BOT_TOKEN ?? '',
    HERMES_ALLOWED_USER_IDS: process.env.HERMES_ALLOWED_USER_IDS ?? '',
    FILE_STORAGE_PATH: `${process.env.CHAT_SERVER_DEPLOY_PATH}/shared/files`,
    PROFILE_IMAGE_STORAGE_PATH: `${process.env.CHAT_SERVER_DEPLOY_PATH}/shared/profile-images`,
    STORE_BACKEND: 'postgres',
    STORE_PATH: `${process.env.CHAT_SERVER_DEPLOY_PATH}/shared/chattermost-store.json`,
    ENABLE_TELEMETRY: 'false',
    ENABLE_DIAGNOSTICS: 'false',
    ENABLE_SECURITY_ALERT_CHECKS: 'false',
    ENABLE_PUBLIC_FILE_LINKS: 'false',
    ENABLE_REDIS_FANOUT: 'false',
    ENABLE_DISTRIBUTED_RATE_LIMIT: 'true',
    REDIS_URL: 'redis://127.0.0.1:6379',
    COMPATIBILITY_SERVER_VERSION: '11.8.0',
    COMPATIBILITY_PROFILE: 'mattermost-v11.8',
    BUILD_NUMBER: 'chattermost-0.1.0',
    BUILD_HASH: process.env.DEPLOY_BUILD_HASH,
    BUILD_DATE: process.env.DEPLOY_BUILD_DATE,
    RELEASE_ID: process.env.DEPLOY_RELEASE_ID,
    ALLOW_VERSION_ADVERTISEMENT: 'true',
    TRUSTED_PROXIES: process.env.CHAT_SERVER_TRUSTED_PROXIES ?? '127.0.0.1/32,::1/128',
    RATE_LIMIT_MAX_KEYS: process.env.CHAT_SERVER_RATE_LIMIT_MAX_KEYS ?? '10000',
    RATE_LIMIT_LOGIN_SOURCE_MAX: process.env.CHAT_SERVER_RATE_LIMIT_LOGIN_SOURCE_MAX ?? '20',
    RATE_LIMIT_LOGIN_ACCOUNT_MAX: process.env.CHAT_SERVER_RATE_LIMIT_LOGIN_ACCOUNT_MAX ?? '20',
    ENABLE_DEV_DEFAULTS: 'false'
  };
  if (process.env.SECURITY_FUSION_SERVICE_TOKEN_HASH) {
    values.SECURITY_FUSION_SERVICE_TOKEN_HASH = process.env.SECURITY_FUSION_SERVICE_TOKEN_HASH;
  }
  if (process.env.HIVEXUI_URL) {
    values.HIVEXUI_URL = process.env.HIVEXUI_URL;
  }
  return values;
}

switch (command) {
  case 'emit-nul': {
    const [file] = args;
    if (file === undefined) throw new Error('emit-nul requires a file');
    for (const [name, value] of Object.entries(await readValues(file))) {
      process.stdout.write(`${name}\0${value}\0`);
    }
    break;
  }
  case 'render-runtime': {
    const [file] = args;
    if (file === undefined) throw new Error('render-runtime requires an output file');
    await writePrivate(file, serialize(runtimeValues()));
    break;
  }
  case 'get': {
    const [file, name] = args;
    if (file === undefined || name === undefined) throw new Error('get requires a file and name');
    const value = (await readValues(file))[name];
    if (value === undefined) process.exitCode = 42;
    else process.stdout.write(value);
    break;
  }
  case 'rewrite-rotation': {
    const [source, destination] = args;
    if (source === undefined || destination === undefined) throw new Error('rewrite-rotation requires source and destination files');
    const values = await readValues(source);
    for (const [name, environmentName] of Object.entries({
      POSTGRES_PASSWORD: 'ROTATE_POSTGRES_PASSWORD',
      COOKIE_SECRET: 'ROTATE_COOKIE_SECRET',
      TOKEN_HASH_SECRET: 'ROTATE_TOKEN_HASH_SECRET'
    })) {
      const replacement = process.env[environmentName];
      if (replacement !== undefined) values[name] = replacement;
    }
    values.DATABASE_URL = `postgresql://chattermost_app:${values.POSTGRES_PASSWORD}@127.0.0.1:55432/chattermost?schema=public`;
    await writePrivate(destination, serialize(values));
    break;
  }
  case 'copy-with': {
    const [source, destination, ...pairs] = args;
    const [name, value] = pairs;
    if (source === undefined || destination === undefined || name === undefined || value === undefined) throw new Error('copy-with requires source, destination, name, and value');
    const values = await readValues(source);
    if (pairs.length % 2 !== 0) throw new Error('copy-with requires name/value pairs');
    for (let index = 0; index < pairs.length; index += 2) {
      const pairName = pairs[index];
      const pairValue = pairs[index + 1];
      if (pairName === undefined || pairValue === undefined) throw new Error('copy-with requires name/value pairs');
      values[pairName] = pairValue;
    }
    await writePrivate(destination, serialize(values));
    break;
  }
  case 'render-preflight': {
    const [source, destination, port] = args;
    if (source === undefined || destination === undefined || port === undefined) throw new Error('render-preflight requires source, destination, and port');
    const values = await readValues(source);
    const databaseUrl = new URL(values.DATABASE_URL);
    databaseUrl.searchParams.set('options', '-c default_transaction_read_only=on');
    values.DATABASE_URL = databaseUrl.toString();
    values.PORT = port;
    values.PREFLIGHT_MODE = 'true';
    values.ENABLE_REDIS_FANOUT = 'false';
    values.ENABLE_DISTRIBUTED_RATE_LIMIT = 'false';
    await writePrivate(destination, serialize(values));
    break;
  }
  case 'digest': {
    const [file] = args;
    if (file === undefined) throw new Error('digest requires a file');
    process.stdout.write(createHash('sha256').update(await readFile(file)).digest('hex'));
    break;
  }
  case 'fingerprint': {
    const [file, name] = args;
    if (file === undefined || name === undefined) throw new Error('fingerprint requires a file and name');
    const value = (await readValues(file))[name];
    if (value === undefined) throw new Error(`Missing ${name}`);
    process.stdout.write(createHash('sha256').update(value).digest('hex').slice(0, 16));
    break;
  }
  case 'append-ledger': {
    const [file] = args;
    if (file === undefined) throw new Error('append-ledger requires a file');
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const record = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    await appendFile(file, JSON.stringify({ recorded_at: new Date().toISOString(), ...record }) + '\n', { mode: 0o600 });
    await chmod(file, 0o600);
    break;
  }
  default:
    throw new Error(`Unknown env-file command: ${command ?? '<missing>'}`);
}
