import { expect, type APIRequestContext } from '@playwright/test';
import NodeWebSocket from 'ws';

// A real browser always attaches an Origin header on same-origin writes. The
// API request fixture accumulates the session cookie across calls, so setup
// requests that authenticate by cookie must present a same-origin Origin for
// the server's CSRF protection to accept them, exactly as a browser client does.
export const webOrigin = 'http://127.0.0.1:8097';
export const websocketUrl = 'ws://127.0.0.1:8097/api/v4/websocket';

export type WebSocketFrame = Record<string, unknown> & {
  event?: string;
  data?: Record<string, unknown>;
};

// Opens a bearer-token WebSocket as the official apps do and resolves with the first
// frame that matches. The returned socket is already subscribed when `ready` resolves.
export function waitForFrame(
  token: string,
  match: (frame: WebSocketFrame) => boolean,
  timeoutMs = 10_000
): { ready: Promise<void>; frame: Promise<WebSocketFrame> } {
  const socket = new NodeWebSocket(websocketUrl, { headers: { Authorization: `Bearer ${token}` } });
  let markReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });
  const frame = new Promise<WebSocketFrame>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error('WebSocket frame timeout'));
    }, timeoutMs);
    socket.on('message', (data) => {
      const text = Array.isArray(data)
        ? Buffer.concat(data).toString('utf8')
        : Buffer.from(data as ArrayBuffer).toString('utf8');
      const parsed = JSON.parse(text) as WebSocketFrame;
      if (parsed.event === 'hello') markReady();
      if (match(parsed)) {
        clearTimeout(timeout);
        socket.close();
        resolve(parsed);
      }
    });
    socket.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
  return { ready, frame };
}

export async function adminToken(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/v4/users/login', {
    headers: { Origin: webOrigin },
    data: { login_id: 'admin', password: 'AdminChangeMe123!' }
  });
  expect(response.ok()).toBeTruthy();
  const token = response.headers().token;
  if (token === undefined) {
    throw new Error('missing admin token');
  }
  return token;
}

export async function defaultChannelId(request: APIRequestContext, token: string): Promise<string> {
  const teams = await request.get('/api/v4/users/me/teams', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const teamBody = (await teams.json()) as { id: string }[];
  const team = teamBody[0];
  if (team === undefined) {
    throw new Error('missing default team');
  }
  const channels = await request.get(`/api/v4/users/me/teams/${team.id}/channels`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const channelBody = (await channels.json()) as { id: string }[];
  const channel = channelBody[0];
  if (channel === undefined) {
    throw new Error('missing default channel');
  }
  return channel.id;
}

export async function createInvite(request: APIRequestContext, token: string): Promise<string> {
  const response = await request.post('/admin/invites', {
    headers: { Authorization: `Bearer ${token}` },
    data: { max_uses: 1, expires_in_hours: 24 }
  });
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { code: string };
  return body.code;
}

export async function createUserViaInvite(
  request: APIRequestContext,
  token: string,
  username: string
): Promise<string> {
  const invite = await createInvite(request, token);
  const response = await request.post('/api/v4/users', {
    headers: { Origin: webOrigin },
    data: {
      invite_code: invite,
      username,
      email: `${username}@example.test`,
      password: `${username}Password123!`
    }
  });
  expect(response.ok()).toBeTruthy();
  const login = await request.post('/api/v4/users/login', {
    headers: { Origin: webOrigin },
    data: { login_id: username, password: `${username}Password123!` }
  });
  const userToken = login.headers().token;
  if (userToken === undefined) {
    throw new Error('missing user token');
  }
  return userToken;
}

// Mattermost frames carry posts and reactions as JSON strings inside `data`.
export function frameText(frame: WebSocketFrame, key: string): string {
  const value = frame.data?.[key];
  return typeof value === 'string' ? value : JSON.stringify(value ?? '');
}
