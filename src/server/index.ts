import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { parse as parseCookie } from 'cookie';
import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import { WebSocketServer, type RawData } from 'ws';

import { createServerApp } from './app.js';
import { loadEnv } from './env.js';
import { isSameWebSocketOrigin } from './security.js';

const env = loadEnv({ envFile: process.env.CHATTERMOST_ENV_FILE ?? '.env' });
const { app, services, store, abuseControl } = await createServerApp(env);
const websocketServer = new WebSocketServer({
  noServer: true,
  maxPayload: 64 * 1024,
  perMessageDeflate: false
});
let shuttingDown = false;
const knownWebSocketActions = new Set(['authentication_challenge', 'ping', 'user_typing', 'get_statuses', 'get_statuses_by_ids']);

const server: ServerType = serve(
  {
    fetch: app.fetch,
    port: env.PORT
  },
  (info) => {
    const address = `http://127.0.0.1:${info.port}`;
    process.stdout.write(
      JSON.stringify({
        level: 'info',
        message: 'chattermost_server_started',
        address,
        server_url: env.SERVER_URL,
        compatibility_profile: env.COMPATIBILITY_PROFILE
      }) + '\n'
    );
  }
);

server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
  if (request.url === undefined) {
    socket.destroy();
    return;
  }
  let requestUrl: URL;
  try {
    requestUrl = new URL(request.url, env.SERVER_URL);
  } catch {
    socket.destroy();
    return;
  }
  if (env.PREFLIGHT_MODE || shuttingDown || requestUrl.pathname !== '/api/v4/websocket') {
    socket.destroy();
    return;
  }

  websocketServer.handleUpgrade(request, socket, head, (websocket) => {
    const auth = authenticateUpgrade(request);
    const traceActions = (request.headers['user-agent'] ?? '').includes('Mattermost/');
    let connectionId = '';
    const tracedSocket = {
      send(payload: string) {
        if (traceActions) {
          process.stdout.write(
            JSON.stringify({
              level: 'info',
              message: 'websocket_frame_sent',
              connection_id: connectionId,
              ...parseWebSocketFrameMetadata(payload)
            }) + '\n'
          );
        }
        websocket.send(payload);
      }
    };
    const requestedSequence = Number(requestUrl.searchParams.get('sequence_number'));
    const requestedConnectionId = requestUrl.searchParams.get('connection_id');
    const attachOptions = {
      ...(requestedConnectionId ? { connectionId: requestedConnectionId } : {}),
      ...(Number.isSafeInteger(requestedSequence) && requestedSequence >= 0 ? { eventSeq: requestedSequence } : {})
    };
    const connection = services.hub.attach(tracedSocket, auth?.user.id ?? null, attachOptions);
    connectionId = connection.id;
    const socketContext = {
      connection_id: connection.id,
      authenticated_on_upgrade: auth !== null,
      remote_address: request.socket.remoteAddress ?? '',
      client_kind: traceActions ? 'mattermost-compatible' : 'other',
      // A query string can contain credentials supplied by a client. Log only
      // the route path, never the full WebSocket URL.
      request_path: requestUrl.pathname
    };
    process.stdout.write(JSON.stringify({ level: 'info', message: 'websocket_opened', ...socketContext }) + '\n');
    websocket.on('message', (data) => {
      if (traceActions) {
        const message = parseWebSocketMessageMetadata(rawDataToString(data));
        process.stdout.write(
          JSON.stringify({
            level: 'info',
            message: 'websocket_action',
            ...socketContext,
            ...message
          }) + '\n'
        );
      }
      void services.hub
        .handleClientMessage(connection.id, rawDataToString(data), (token) => services.sessions.authenticateToken(token), services.statuses)
        .catch((error: unknown) => {
          process.stdout.write(
            JSON.stringify({
              level: 'warn',
              message: 'websocket_action_failed',
              ...socketContext,
              error: error instanceof Error ? error.message : 'Unknown WebSocket action error'
            }) + '\n'
          );
          websocket.close(1011, 'WebSocket action failed');
        });
    });
    websocket.on('close', (code) => {
      process.stdout.write(
        JSON.stringify({
          level: 'info',
          message: 'websocket_closed',
          ...socketContext,
          close_code: code
        }) + '\n'
      );
      services.hub.detach(connection.id);
    });
    websocket.on('error', (error) => {
      process.stdout.write(
        JSON.stringify({
          level: 'warn',
          message: 'websocket_error',
          ...socketContext,
          error: error.message
        }) + '\n'
      );
    });
  });
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void shutdown(signal).catch((error: unknown) => {
      process.stdout.write(
        JSON.stringify({
          level: 'error',
          message: 'chattermost_server_stop_failed',
          signal,
          error: error instanceof Error ? error.message : 'Unknown shutdown error'
        }) + '\n'
      );
      process.exitCode = 1;
    });
  });
}

async function shutdown(signal: 'SIGTERM' | 'SIGINT'): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write(JSON.stringify({ level: 'info', message: 'chattermost_server_stopping', signal }) + '\n');
  for (const websocket of websocketServer.clients) {
    websocket.close(1001, 'Server shutting down');
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
  await store.close();
  await abuseControl.close();
  process.stdout.write(JSON.stringify({ level: 'info', message: 'chattermost_server_stopped', signal }) + '\n');
}

function authenticateUpgrade(request: IncomingMessage) {
  const authorization = request.headers.authorization;
  const bearer = authorization?.match(/^Bearer\s+(.+)$/iu)?.[1];
  if (bearer !== undefined) {
    return services.sessions.authenticateToken(bearer);
  }
  const cookieHeader = request.headers.cookie;
  if (cookieHeader === undefined) {
    return null;
  }
  // Cookie-authenticated upgrades are only honored from a same-origin browser
  // context. This prevents Cross-Site WebSocket Hijacking, where a malicious
  // page opens a socket that rides the victim's session cookie.
  if (!isSameWebSocketOrigin(request.headers.origin, env.SERVER_URL)) {
    return null;
  }
  const cookies = parseCookie(cookieHeader);
  const token = cookies[env.SESSION_COOKIE_NAME] ?? cookies.MMSID;
  return token === undefined ? null : services.sessions.authenticateToken(token);
}

function rawDataToString(data: RawData): string {
  if (typeof data === 'string') {
    return data;
  }
  if (Buffer.isBuffer(data)) {
    return data.toString('utf8');
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8');
  }
  return Buffer.from(data).toString('utf8');
}

function parseWebSocketMessageMetadata(raw: string): { action: string; seq: number | null } {
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { action: 'invalid', seq: null };
    }
    const frame = value as Record<string, unknown>;
    return {
      action: typeof frame.action === 'string' && knownWebSocketActions.has(frame.action) ? frame.action : 'other',
      seq: typeof frame.seq === 'number' ? frame.seq : null
    };
  } catch {
    return { action: 'invalid', seq: null };
  }
}

function parseWebSocketFrameMetadata(raw: string): {
  frame_type: string;
  event: string | null;
  seq: number | null;
  seq_reply: number | null;
  status: string | null;
} {
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('invalid frame');
    }
    const frame = value as Record<string, unknown>;
    return {
      frame_type: typeof frame.event === 'string' ? 'event' : 'response',
      event: typeof frame.event === 'string' ? frame.event : null,
      seq: typeof frame.seq === 'number' ? frame.seq : null,
      seq_reply: typeof frame.seq_reply === 'number' ? frame.seq_reply : null,
      status: typeof frame.status === 'string' ? frame.status : null
    };
  } catch {
    return {
      frame_type: 'invalid',
      event: null,
      seq: null,
      seq_reply: null,
      status: null
    };
  }
}
