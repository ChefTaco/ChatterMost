#!/usr/bin/env tsx
import WebSocket, { type RawData } from 'ws';

type UserResponse = { id: string; username: string };
type ChannelResponse = { id: string };
type PostResponse = { id: string; user_id: string; message: string; create_at: number; root_id: string };
type CommandResponse = { response_type: string; text: string; post_id: string; create_at: number };
type ApiOptions<TBody = unknown> = {
  method?: string;
  token?: string;
  headers?: HeadersInit;
  body?: TBody;
};
type WebSocketFrame = {
  event?: string;
  status?: string;
  seq_reply?: number;
  data?: {
    channel_id?: string;
    post?: string;
  };
};

const baseUrl = requiredEnv('CHAT_SERVER_URL').replace(/\/+$/u, '');
const adminUsername = requiredEnv('CHAT_SERVER_ADMIN_USERNAME');
const adminPassword = requiredEnv('CHAT_SERVER_ADMIN_PASSWORD');
const botUsername = process.env.CHAT_SERVER_SMOKE_BOT_USERNAME ?? process.env.HERMES_BOT_USERNAME ?? 'hermes';
const smokeLoginId = process.env.CHAT_SERVER_SMOKE_LOGIN_ID ?? adminUsername;
const smokePassword = process.env.CHAT_SERVER_SMOKE_PASSWORD ?? adminPassword;
const message = process.env.CHAT_SERVER_SMOKE_MESSAGE ?? `Hermes DM smoke ${new Date().toISOString()}`;
const useCommandExecute = message.startsWith('/');
const timeoutMs = Number(process.env.CHAT_SERVER_SMOKE_TIMEOUT_MS ?? '90000');
// Exact upstream adapter response text used for interoperability.
const homeChannelNoticePrefix = '📬 No home channel is set for Mattermost.';
const correlation = `CHATTERMOST_SMOKE_${crypto.randomUUID().replaceAll('-', '').toUpperCase()}`;

const userToken = await login(smokeLoginId, smokePassword);
const me = await api<UserResponse>('/api/v4/users/me', { token: userToken });
const bot = await api<UserResponse>(`/api/v4/users/username/${encodeURIComponent(botUsername)}`, { token: userToken });
const channel = await api<ChannelResponse>('/api/v4/channels/direct', {
  method: 'POST',
  token: userToken,
  body: [bot.id]
});

let submitted: { id: string; create_at: number };
let reply: PostResponse;
if (useCommandExecute) {
  const correlatedCommand = `${message} Respond with exactly ${correlation} and do not call tools or modify state.`;
  const commandPost: { value?: CommandResponse } = {};
  const commandStream = waitForHermesReply({
    token: userToken,
    channelId: channel.id,
    botUserId: bot.id,
    matches: (candidate) =>
      commandPost.value !== undefined &&
      candidate.create_at >= commandPost.value.create_at &&
      candidate.message.includes(correlation)
  });
  await commandStream.ready;
  commandPost.value = await api<CommandResponse>('/api/v4/commands/execute', {
      method: 'POST',
      token: userToken,
      body: { channel_id: channel.id, command: correlatedCommand }
    });
  submitted = { id: commandPost.value.post_id, create_at: commandPost.value.create_at };
  reply = await commandStream.reply;
} else {
  const correlatedMessage = `${message}\n\nReply with exactly ${correlation}.`;
  const messagePost: { value?: PostResponse } = {};
  const messageStream = waitForHermesReply({
    token: userToken,
    channelId: channel.id,
    botUserId: bot.id,
    matches: (candidate) =>
      messagePost.value !== undefined &&
      candidate.create_at >= messagePost.value.create_at &&
      candidate.message.includes(correlation)
  });
  await messageStream.ready;
  messagePost.value = await api<PostResponse>('/api/v4/posts', {
      method: 'POST',
      token: userToken,
      body: { channel_id: channel.id, message: correlatedMessage }
    });
  submitted = messagePost.value;
  reply = await messageStream.reply;
}

console.log(
  JSON.stringify(
    {
      status: 'ok',
      user: me.username,
      user_id: me.id,
      bot_username: bot.username,
      bot_user_id: bot.id,
      channel_id: channel.id,
      transport: useCommandExecute ? 'commands_execute' : 'posts',
      sent_post_id: submitted.id,
      sent_create_at: submitted.create_at,
      reply_post_id: reply.id,
      reply_create_at: reply.create_at,
      reply_root_id: reply.root_id,
      reply_user_id: reply.user_id,
      reply_preview: reply.message.slice(0, 120)
    },
    null,
    2
  )
);

async function login(loginId: string, loginPassword: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v4/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl },
    body: JSON.stringify({ login_id: loginId, password: loginPassword })
  });
  if (!response.ok) {
    throw new Error(`Login failed for ${loginId}: ${response.status}`);
  }
  const token = response.headers.get('token');
  if (token === null) {
    throw new Error(`Login for ${loginId} did not return a token`);
  }
  return token;
}

async function api<TResponse, TBody = unknown>(path: string, options: ApiOptions<TBody> = {}): Promise<TResponse> {
  const headers = new Headers(options.headers);
  if (options.token !== undefined) {
    headers.set('Authorization', `Bearer ${options.token}`);
  }
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
  });
  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as TResponse;
}

function waitForHermesReply(input: {
  token: string;
  channelId: string;
  botUserId: string;
  matches: (post: PostResponse) => boolean;
}): { ready: Promise<void>; reply: Promise<PostResponse> } {
  const websocketUrl = `${baseUrl.replace(/^http/u, 'ws')}/api/v4/websocket`;
  let resolveReady: (() => void) | undefined;
  let rejectReady: ((error: Error) => void) | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const reply = new Promise<PostResponse>((resolve, reject) => {
    const socket = new WebSocket(websocketUrl);
    const timer = setTimeout(() => {
      socket.close();
      const error = new Error(`Timed out after ${timeoutMs}ms waiting for a correlated @${botUsername} reply in ${input.channelId}; verify that ${smokeLoginId} is included in MATTERMOST_ALLOWED_USERS`);
      rejectReady?.(error);
      reject(error);
    }, timeoutMs);
    socket.once('open', () => {
      socket.send(JSON.stringify({ seq: 1, action: 'authentication_challenge', data: { token: input.token } }));
    });
    socket.on('message', (raw) => {
      const frame = JSON.parse(rawDataToString(raw)) as WebSocketFrame;
      if (frame.status === 'OK' && frame.seq_reply === 1) {
        resolveReady?.();
        return;
      }
      if (frame.event !== 'posted' || frame.data?.channel_id !== input.channelId || frame.data.post === undefined) {
        return;
      }
      const post = JSON.parse(frame.data.post) as PostResponse;
      if (post.user_id !== input.botUserId || post.message.startsWith(homeChannelNoticePrefix) || !input.matches(post)) {
        return;
      }
      clearTimeout(timer);
      socket.close();
      resolve(post);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      rejectReady?.(error);
      reject(error);
    });
  });
  return { ready, reply };
}

function rawDataToString(raw: RawData): string {
  if (typeof raw === 'string') {
    return raw;
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString('utf8');
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw).toString('utf8');
  }
  return raw.toString('utf8');
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}
