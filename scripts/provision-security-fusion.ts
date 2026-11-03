import { randomUUID } from 'node:crypto';
import { chmod, lstat, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';

import { parse } from 'dotenv';
import { z } from 'zod';

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

type Fetch = typeof fetch;
const PingSchema = z.object({
  status: z.literal('OK'),
  build_number: z.string().startsWith('chattermost-'),
  compatibility_profile: z.string().startsWith('mattermost-v'),
});
const TeamListSchema = z.array(z.object({ id: z.string().min(1) }));
const ChannelSchema = z.object({ id: z.string().min(1), name: z.string().min(1) });
const BotListSchema = z.array(z.object({
  user_id: z.string().min(1),
  username: z.string().min(1),
}));
const CreatedBotSchema = z.object({
  token: z.string().min(1),
  bot: z.object({ user_id: z.string().min(1) }),
});
const BotIdentitySchema = z.object({
  id: z.string().min(1),
  is_bot: z.literal(true),
});

export type ProvisionSecurityFusionOptions = {
  baseUrl: string;
  username: string;
  password: string;
  outputPath: string;
  fetchImpl?: Fetch;
};

function isLoopback(hostname: string): boolean {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  if (hostname === '::1') return true;
  return isIP(hostname) === 4 && hostname.startsWith('127.');
}

export function validateProvisioningBaseUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.username || url.password) {
    throw new Error('CHAT_SERVER_URL must not contain embedded credentials');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('CHAT_SERVER_URL must be an origin without a path, query, or fragment');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
    throw new Error('CHAT_SERVER_URL must use HTTPS outside loopback');
  }
  return url;
}

async function readBoundedJson<T>(response: Response, path: string): Promise<T> {
  const advertisedLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(advertisedLength) && advertisedLength > MAX_RESPONSE_BYTES) {
    throw new Error(`${path} response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }
  if (response.body === null) throw new Error(`${path} returned an empty response`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error(`${path} response exceeds ${MAX_RESPONSE_BYTES} bytes`);
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(combined)) as T;
  } catch {
    throw new Error(`${path} returned invalid JSON`);
  }
}

async function request(
  baseUrl: URL,
  fetchImpl: Fetch,
  path: string,
  init: RequestInit = {},
  token?: string
): Promise<{ response: Response; body: unknown }> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body) headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetchImpl(new URL(path, baseUrl), {
    ...init,
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return { response, body: await readBoundedJson<unknown>(response, path) };
}

async function readExistingCredential(outputPath: string): Promise<string | null> {
  try {
    const stats = await lstat(outputPath);
    if (!stats.isFile() || (stats.mode & 0o077) !== 0) {
      throw new Error('Existing Security Fusion credential must be a regular mode-600 file');
    }
    const values = parse(await readFile(outputPath, 'utf8'));
    return values.SECURITY_FUSION_CHATTERMOST_BOT_TOKEN || null;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writePrivateCredential(outputPath: string, contents: string): Promise<void> {
  const temporary = `${outputPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, outputPath);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function provisionSecurityFusion(options: ProvisionSecurityFusionOptions): Promise<void> {
  const baseUrl = validateProvisioningBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const ping = PingSchema.safeParse((await request(
    baseUrl,
    fetchImpl,
    '/api/v4/system/ping'
  )).body);
  if (!ping.success) {
    throw new Error('target identity is not the expected ChatterMost compatibility service');
  }

  const login = await request(baseUrl, fetchImpl, '/api/v4/users/login', {
    method: 'POST',
    body: JSON.stringify({ login_id: options.username, password: options.password }),
  });
  const adminToken = login.response.headers.get('token');
  if (!adminToken) throw new Error('admin login did not return a token');

  const teams = TeamListSchema.parse(
    (await request(baseUrl, fetchImpl, '/api/v4/users/me/teams', {}, adminToken)).body
  );
  const team = teams[0];
  if (!team) throw new Error('no ChatterMost team is available');
  const channels = z.array(ChannelSchema).parse((await request(
    baseUrl,
    fetchImpl,
    `/api/v4/users/me/teams/${team.id}/channels`,
    {},
    adminToken
  )).body);
  let channel = channels.find((item) => item.name === 'security-fusion');
  channel ??= ChannelSchema.parse((await request(baseUrl, fetchImpl, '/api/v4/channels', {
    method: 'POST',
    body: JSON.stringify({
      team_id: team.id,
      name: 'security-fusion',
      display_name: 'Security Fusion',
      type: 'P',
      purpose: 'Private, idempotent Magnus Security Fusion case transitions.',
    }),
  }, adminToken)).body);

  const bots = BotListSchema.parse((await request(
    baseUrl,
    fetchImpl,
    '/admin/bots',
    {},
    adminToken
  )).body);
  const existing = bots.find((bot) => bot.username === 'magnus-security');
  let botUserId: string;
  let botToken: string;
  if (existing) {
    const existingToken = await readExistingCredential(options.outputPath);
    if (!existingToken) {
      throw new Error(
        'magnus-security already exists but its credential output is unavailable; refusing implicit token rotation'
      );
    }
    const botIdentity = BotIdentitySchema.parse((await request(
      baseUrl,
      fetchImpl,
      '/api/v4/users/me',
      {},
      existingToken
    )).body);
    if (botIdentity.id !== existing.user_id) {
      throw new Error('preserved Magnus bot credential does not match the expected bot identity');
    }
    botUserId = existing.user_id;
    botToken = existingToken;
  } else {
    const created = CreatedBotSchema.parse((await request(
      baseUrl,
      fetchImpl,
      '/admin/bots',
      {
        method: 'POST',
        body: JSON.stringify({ username: 'magnus-security', display_name: 'Magnus Security' }),
      },
      adminToken
    )).body);
    botUserId = created.bot.user_id;
    botToken = created.token;
  }

  await request(baseUrl, fetchImpl, `/api/v4/channels/${channel.id}/members`, {
    method: 'POST',
    body: JSON.stringify({ user_id: botUserId }),
  }, adminToken);

  await writePrivateCredential(
    options.outputPath,
    `SECURITY_FUSION_CHATTERMOST_CHANNEL_ID=${channel.id}\nSECURITY_FUSION_CHATTERMOST_BOT_TOKEN=${botToken}\n`,
  );
}

async function main(): Promise<void> {
  const baseUrl = process.env.CHAT_SERVER_URL ?? '';
  const username = process.env.CHAT_SERVER_ADMIN_USERNAME ?? process.env.ADMIN_USERNAME ?? '';
  const password = process.env.CHAT_SERVER_ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD ?? '';
  const outputPath = process.env.SECURITY_FUSION_CREDENTIAL_OUTPUT ?? '';
  if (!baseUrl || !username || !password || !outputPath) {
    throw new Error('CHAT_SERVER_URL, admin credentials, and SECURITY_FUSION_CREDENTIAL_OUTPUT are required');
  }
  await provisionSecurityFusion({ baseUrl, username, password, outputPath });
  console.log(
    'Provisioned private security-fusion channel and @magnus-security; credentials preserved with mode 0600'
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
