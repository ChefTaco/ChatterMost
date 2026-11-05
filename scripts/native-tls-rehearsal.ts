#!/usr/bin/env node
// Developer-only proof of the real native listener; no installed service is used.
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  chmodSync,
  openSync,
  closeSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { request as httpsRequest, Agent } from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import { z } from 'zod';
import { randomBytes, createHash } from 'node:crypto';
import WebSocket, { type RawData } from 'ws';
const Entity = z.object({ id: z.string() });
const Event = z.object({ event: z.string(), data: z.record(z.string(), z.unknown()).optional() });
const Store = z.object({ users: z.array(z.object({ id: z.string(), passwordHash: z.string() })) });
const location = resolve(import.meta.dirname, '..'),
  root = existsSync(join(location, 'package.json')) ? location : resolve(location, '..'),
  index = process.argv.indexOf('--output');
assert(index >= 0 && process.argv[index + 1], '--output NEW_PRIVATE_DIRECTORY is required');
const outputArgument = process.argv[index + 1];
assert(outputArgument);
const output = resolve(outputArgument);
assert(!existsSync(output));
mkdirSync(output, { recursive: true, mode: 0o700 });
chmodSync(output, 0o700);
const put = (path: string, value: unknown): void => {
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  chmodSync(path, 0o600);
};
const run = (command: string, args: string[]): string =>
  execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const socket = createServer().listen(0, '127.0.0.1');
await new Promise<void>((done) => socket.once('listening', done));
const address = socket.address();
assert(address && typeof address !== 'string');
const port = address.port;
await new Promise<void>((done) => socket.close(() => done()));
const certificate = join(output, 'server.crt'),
  privateKey = join(output, 'server.key'),
  initialId = randomBytes(13).toString('hex'),
  password = randomBytes(32).toString('hex');
run('openssl', [
  'req',
  '-x509',
  '-newkey',
  'rsa:2048',
  '-nodes',
  '-keyout',
  privateKey,
  '-out',
  certificate,
  '-subj',
  '/CN=localhost',
  '-addext',
  'subjectAltName=DNS:localhost',
  '-days',
  '2'
]);
chmodSync(privateKey, 0o600);
const ca = readFileSync(certificate),
  envFile = join(output, 'runtime.env'),
  store = join(output, 'store.json');
const values: Record<string, string> = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://fixture@localhost/unused_json_store',
  STORE_BACKEND: 'json',
  STORE_PATH: store,
  FILE_STORAGE_PATH: join(output, 'files'),
  PROFILE_IMAGE_STORAGE_PATH: join(output, 'profiles'),
  COOKIE_SECRET: randomBytes(32).toString('hex'),
  TOKEN_HASH_SECRET: randomBytes(32).toString('hex'),
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD: password,
  ADMIN_EMAIL: 'alice@example.test',
  ADMIN_INITIAL_ID: initialId,
  PORT: String(port),
  BIND_HOST: '127.0.0.1',
  SERVER_URL: 'https://localhost:' + String(port),
  TLS_CERT_PATH: certificate,
  TLS_KEY_PATH: privateKey,
  TLS_PROBE_SERVER_NAME: 'localhost',
  ENABLE_TELEMETRY: 'false',
  ENABLE_DEV_DEFAULTS: 'false'
};
function save(): void {
  put(
    envFile,
    Object.entries(values)
      .map(([key, value]) => key + '=' + JSON.stringify(value))
      .join('\n') + '\n'
  );
}
save();
let server: ChildProcess | undefined, websocket: WebSocket | undefined;
const launched: ChildProcess[] = [];
async function stop(): Promise<void> {
  if (websocket) {
    websocket.terminate();
    websocket = undefined;
  }
  if (server) {
    const child = server;
    server = undefined;
    if (child.exitCode === null) child.kill('SIGTERM');
    await new Promise<void>((done) => {
      if (child.exitCode !== null) done();
      else child.once('close', () => done());
    });
  }
}
function start(): void {
  const descriptor = openSync(
    join(output, 'server-' + String(launched.length) + '.log'),
    'wx',
    0o600
  );
  server = spawn(process.execPath, [join(root, 'dist/src/server/index.js')], {
    cwd: root,
    env: { PATH: process.env.PATH, NODE_ENV: 'production', CHATTERMOST_ENV_FILE: envFile },
    stdio: ['ignore', descriptor, descriptor]
  });
  closeSync(descriptor);
  launched.push(server);
}
function request(
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  trust: Buffer = ca
): Promise<{ status: number | undefined; headers: IncomingHttpHeaders; body: unknown }> {
  return new Promise((resolveResponse, reject) => {
    const req = httpsRequest(
      {
        hostname: '127.0.0.1',
        port,
        servername: 'localhost',
        ca: trust,
        path,
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://localhost:' + String(port),
          ...headers
        },
        timeout: 3000
      },
      (response) => {
        let raw = '';
        response.on('data', (chunk: Buffer) => {
          raw += chunk.toString();
        });
        response.on('end', () => {
          try {
            resolveResponse({
              status: response.statusCode,
              headers: response.headers,
              body: raw ? JSON.parse(raw) : null
            });
          } catch {
            reject(Error('Invalid JSON response'));
          }
        });
      }
    );
    req.once('error', reject);
    req.once('timeout', () => req.destroy(Error('TLS proof request timeout')));
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}
async function ready(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    assert(
      server && server.exitCode === null,
      'Native server stopped before readiness; inspect protected evidence'
    );
    try {
      if ((await request('/api/v4/system/ping')).status === 200) return;
    } catch {
      /* Wait for this disposable listener to finish starting. */
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw Error('Native TLS readiness timed out');
}
async function login(): Promise<string> {
  const response = await request('/api/v4/users/login', { login_id: 'admin', password });
  assert.equal(response.status, 200);
  assert.equal(Entity.parse(response.body).id, initialId);
  const token = response.headers.token;
  assert(typeof token === 'string');
  return token;
}
try {
  start();
  await ready();
  await assert.rejects(
    request('/api/v4/system/ping', undefined, {}, Buffer.from('untrusted synthetic authority')),
    'Untrusted TLS peer accepted'
  );
  const token = await login(),
    headers = { Authorization: 'Bearer ' + token };
  const events: z.infer<typeof Event>[] = [];
  websocket = new WebSocket('wss://127.0.0.1:' + String(port) + '/api/v4/websocket', {
    ca,
    agent: new Agent({ ca, servername: 'localhost' }),
    headers
  });
  websocket.on('message', (data: RawData) => {
    const text = Array.isArray(data)
      ? Buffer.concat(data).toString('utf8')
      : Buffer.from(data as ArrayBuffer).toString('utf8');
    events.push(Event.parse(JSON.parse(text)));
  });
  await new Promise<void>((resolveSocket, reject) => {
    const finish = (error?: Error): void => {
      clearInterval(check);
      clearTimeout(timer);
      if (error) reject(error);
      else resolveSocket();
    };
    const timer = setTimeout(() => finish(Error('Authenticated WSS hello timeout')), 5000);
    assert(websocket);
    websocket.once('error', finish);
    const check = setInterval(() => {
      if (events.some((event) => event.event === 'hello')) finish();
    }, 20);
  });
  const teams = await request('/api/v4/users/me/teams', undefined, headers);
  assert.equal(teams.status, 200);
  const [team] = z.array(Entity).min(1).parse(teams.body);
  assert(team);
  const channels = await request(
    '/api/v4/users/me/teams/' + team.id + '/channels',
    undefined,
    headers
  );
  assert.equal(channels.status, 200);
  const [channel] = z.array(Entity).min(1).parse(channels.body);
  assert(channel);
  const post = await request(
    '/api/v4/posts',
    { channel_id: channel.id, message: 'Synthetic verified native TLS and WSS rehearsal' },
    headers
  );
  assert.equal(post.status, 201);
  for (
    let attempt = 0;
    attempt < 100 && !events.some((event) => event.event === 'posted');
    attempt++
  )
    await new Promise((done) => setTimeout(done, 20));
  const posted = events.find((event) => event.event === 'posted');
  assert(posted);
  assert.equal(
    Entity.parse(JSON.parse(z.string().parse(posted.data?.post))).id,
    Entity.parse(post.body).id
  );
  await stop();
  const before = Store.parse(JSON.parse(readFileSync(store, 'utf8'))),
    account = before.users.find((user) => user.id === initialId);
  assert(account);
  const passwordHash = account.passwordHash;
  start();
  await ready();
  const secondToken = await login();
  const retained = await request('/api/v4/posts/' + Entity.parse(post.body).id, undefined, {
    Authorization: 'Bearer ' + secondToken
  });
  assert.equal(retained.status, 200);
  await stop();
  const after = Store.parse(JSON.parse(readFileSync(store, 'utf8')));
  assert.equal(after.users.find((user) => user.id === initialId)?.passwordHash, passwordHash);
  assert.equal(after.users.filter((user) => user.id === initialId).length, 1);
  values.HIVE_REHEARSAL = 'true';
  save();
  const rehearsalDigest = createHash('sha256').update(readFileSync(store)).digest('hex');
  start();
  await ready();
  assert.equal((await request('/api/v4/users/login', { login_id: 'admin', password })).status, 503);
  const readonlySocket = new WebSocket(`wss://127.0.0.1:${String(port)}/api/v4/websocket`, {
    ca,
    agent: new Agent({ ca, servername: 'localhost' }),
    headers: { Authorization: `Bearer ${secondToken}` }
  });
  await new Promise<void>((resolveSocket, reject) => {
    const timer = setTimeout(() => {
      readonlySocket.terminate();
      reject(Error('Rehearsal WebSocket did not refuse upgrade'));
    }, 5000);
    readonlySocket.once('open', () => {
      clearTimeout(timer);
      readonlySocket.terminate();
      reject(Error('Rehearsal accepted a restored session WebSocket'));
    });
    readonlySocket.once('error', () => {
      clearTimeout(timer);
      resolveSocket();
    });
  });
  await stop();
  assert.equal(
    createHash('sha256').update(readFileSync(store)).digest('hex'),
    rehearsalDigest,
    'Rehearsal changed restored storage'
  );
  values.AUTHENTICATED_REHEARSAL = 'true';
  save(); start(); await ready();
  assert.equal((await request('/api/v4/users/me', undefined, {Authorization:'Bearer '+secondToken})).status,401,'Captured source session authorized a clone');
  const volatileToken = await login();
  assert.equal((await request('/api/v4/posts/'+Entity.parse(post.body).id,undefined,{Authorization:'Bearer '+volatileToken})).status,200);
  assert.equal((await request('/api/v4/posts',{channel_id:channel.id,message:'forbidden'}, {Authorization:'Bearer '+volatileToken})).status,503);
  websocket = new WebSocket(`wss://127.0.0.1:${String(port)}/api/v4/websocket`, {ca,agent:new Agent({ca,servername:'localhost'}),headers:{Authorization:'Bearer '+volatileToken}});
  const authSocket=websocket;
  await new Promise<void>((done,reject)=>{
    const timer=setTimeout(()=>reject(Error('Authenticated restore socket read timeout')),5000);
    authSocket.on('error',reject);
    authSocket.on('message',(data:RawData)=>{
      const value:unknown=JSON.parse(rawText(data));
      if(typeof value==='object' && value!==null && 'event' in value && value.event==='hello') authSocket.send(JSON.stringify({seq:1,action:'ping',data:{}}));
      if(typeof value==='object' && value!==null && 'seq_reply' in value && value.seq_reply===1){clearTimeout(timer);done();}
    });
  });
  const refused=new Promise<void>((done,reject)=>{
    const timer=setTimeout(()=>reject(Error('Restore typing action not refused')),5000);
    authSocket.once('close',code=>{clearTimeout(timer);assert.equal(code,1008);done();});
  });
  authSocket.send(JSON.stringify({seq:2,action:'user_typing',data:{channel_id:channel.id}}));
  await refused;
  assert.equal((await request('/api/v4/users/logout',{}, {Authorization:'Bearer '+volatileToken})).status,200);
  assert.equal((await request('/api/v4/users/me',undefined,{Authorization:'Bearer '+volatileToken})).status,401);
  await stop();
  assert.equal(createHash('sha256').update(readFileSync(store)).digest('hex'),rehearsalDigest,'Authenticated restore changed storage bytes');
  delete values.AUTHENTICATED_REHEARSAL;
  delete values.HIVE_REHEARSAL;
  values.ADMIN_INITIAL_ID = randomBytes(13).toString('hex');
  save();
  const digest = createHash('sha256').update(readFileSync(store)).digest('hex');
  start();
  await new Promise<void>((resolveExit, reject) => {
    assert(server);
    const timer = setTimeout(
      () => reject(Error('Mismatched initial ID did not refuse startup')),
      10_000
    );
    server.once('close', (code) => {
      clearTimeout(timer);
      assert.notEqual(code, 0);
      resolveExit();
    });
  });
  assert.equal(
    createHash('sha256').update(readFileSync(store)).digest('hex'),
    digest,
    'Mismatched bootstrap rewrote existing state'
  );
  put(join(output, 'result.json'), {
    schema: 1,
    result: 'passed',
    productionCutover: false,
    checks: [
      'real native TLS listener with verified certificate and rejected untrusted certificate',
      'fresh explicit product administrator ID',
      'native password authentication and authenticated WSS hello',
      'Mattermost-compatible posted event over WSS',
      'restart retains account ID, password hash and posted content',
      'changed bootstrap ID refuses startup without changing saved state',
      'rehearsal preserves storage bytes and denies authentication mutations and WebSockets',
      'explicit authenticated restore allows native HTTPS reads and WSS ping with volatile sessions only; typing and durable mutations refused'
    ]
  });
  console.log(
    'PASS: verified native HTTPS/WSS, explicit fresh identity, restart persistence and existing-account mismatch refusal.'
  );
} finally {
  await stop();
}

function rawText(data: RawData): string {
  return Array.isArray(data) ? Buffer.concat(data).toString('utf8') : Buffer.from(data as ArrayBuffer).toString('utf8');
}
