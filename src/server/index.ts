import { rehearsalSocketActionAllowed } from './rehearsal.js';
import { configuredBrowserOrigins } from './oathweave.js';
import { guardedSocketSender, authenticateSocketUpgrade } from './bound-socket.js';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import { WebSocketServer, type RawData } from 'ws';
import { createServer } from 'node:https';

import { createServerApp } from './app.js';
import { loadEnv } from './env.js';
import { listenerTls } from './listener.js';

const env = loadEnv({ envFile: process.env.CHATTERMOST_ENV_FILE ?? '.env' });
const tls = listenerTls(env);
const { app, services, store, abuseControl } = await createServerApp(env);
const websocketServer = new WebSocketServer({
  noServer: true,
  maxPayload: 64 * 1024,
  perMessageDeflate: false
});
let shuttingDown = false;
// A client that never authenticates must not hold a connection open indefinitely.
const WEBSOCKET_AUTHENTICATION_DEADLINE_MS = 30_000;
// Idle connections receive nothing, so a sweep closes those whose credential stopped working.
const WEBSOCKET_AUTHORIZATION_SWEEP_MS = 15_000;
const authorizationSweep = setInterval(() => {
  services.hub.closeUnauthorized();
}, WEBSOCKET_AUTHORIZATION_SWEEP_MS);
authorizationSweep.unref();
const knownWebSocketActions = new Set(['authentication_challenge', 'ping', 'user_typing', 'get_statuses', 'get_statuses_by_ids']);

const server: ServerType = serve(
  {
    fetch: app.fetch,
    port: env.PORT,
    hostname: env.BIND_HOST,
    ...(tls === undefined ? {} : { createServer, serverOptions: tls })
  },
  (info) => {
    const address = `${tls === undefined ? 'http' : 'https'}://localhost:${info.port}`;
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
  void handleUpgradeRequest(request,socket,head).catch(()=>socket.destroy());
});
async function handleUpgradeRequest(request: IncomingMessage, socket: Duplex, head: Buffer):Promise<void> {
  if (env.PREFLIGHT_MODE && !env.AUTHENTICATED_REHEARSAL) {
    socket.destroy();
    return;
  }
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
  if ((env.PREFLIGHT_MODE && !env.AUTHENTICATED_REHEARSAL) || shuttingDown || requestUrl.pathname !== '/api/v4/websocket') {
    socket.destroy();
    return;
  }

  let auth: Awaited<ReturnType<typeof authenticateUpgrade>>;
  try {auth=await authenticateUpgrade(request);} catch {socket.destroy();return;}
  if(shuttingDown){socket.destroy();return;}
  websocketServer.handleUpgrade(request, socket, head, (websocket) => {
    const bound=Boolean(auth?.sessionId && services.sessions.requiresOnlineValidation(auth.sessionId));
    const validate=async()=>{
      const current=await authenticateUpgrade(request);
      return Boolean(current && current.sessionId===auth?.sessionId && current.user.id===auth?.user.id);
    };
    const traceActions = (request.headers['user-agent'] ?? '').includes('Mattermost/');
    let connectionId = '';
    const emit=(payload:string)=>{
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
    };
    const send=bound?guardedSocketSender({send:emit,close:(code,reason)=>websocket.close(code,reason)},validate):emit;
    const tracedSocket={send,close:(code:number,reason:string)=>websocket.close(code,reason)};
    const requestedSequence = Number(requestUrl.searchParams.get('sequence_number'));
    const requestedConnectionId = requestUrl.searchParams.get('connection_id');
    const attachOptions = {
      ...(requestedConnectionId ? { connectionId: requestedConnectionId } : {}),
      ...(Number.isSafeInteger(requestedSequence) && requestedSequence >= 0 ? { eventSeq: requestedSequence } : {}),
      ...(auth?.stillValid === undefined ? {} : { authorized: auth.stillValid })
    };
    const connection = services.hub.attach(tracedSocket, auth?.user.id ?? null, attachOptions);
    connectionId = connection.id;
    const authenticationDeadline = setTimeout(() => {
      if (connection.userId === null) websocket.close(1008, 'Authentication required');
    }, WEBSOCKET_AUTHENTICATION_DEADLINE_MS);
    authenticationDeadline.unref();
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
      void Promise.resolve().then(async()=>{
        if (env.AUTHENTICATED_REHEARSAL && !rehearsalSocketActionAllowed(rawDataToString(data))) { websocket.close(1008, 'Read-only rehearsal'); return; }
        if(bound && !(await validate())){websocket.close(1008,'Session expired');return;}
        await services.hub.handleClientMessage(connection.id, rawDataToString(data), (token) => services.sessions.authenticateToken(token), services.statuses);
      })
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
      clearTimeout(authenticationDeadline);
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
}

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
  clearInterval(authorizationSweep);
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

async function authenticateUpgrade(request: IncomingMessage) {
  return authenticateSocketUpgrade(request.headers,env.SERVER_URL,env.SESSION_COOKIE_NAME,token=>services.sessions.authenticateWebSession(token),configuredBrowserOrigins(env));
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
