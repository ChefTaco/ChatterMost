import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, get } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { probeTls } from '../../scripts/probe-tls.js';

const directory = mkdtempSync(join(tmpdir(), 'chat-probe-tls-'));
function certificate(name: string): { key: Buffer; cert: Buffer } {
  const key = join(directory, name + '.key'), cert = join(directory, name + '.crt');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:192.0.2.42'], { stdio: 'ignore' });
  return { key: readFileSync(key), cert: readFileSync(cert) };
}
const trusted = certificate('trusted'), untrusted = certificate('untrusted');
const server = createServer(trusted, (_request, response) => response.end('healthy'));
const sockets = new WebSocketServer({ server });
let port: number;
sockets.on('connection', socket => socket.send('hello'));
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  await new Promise<void>(resolve => sockets.close(() => resolve()));
  await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)));
  rmSync(directory, { recursive: true, force: true });
});
function httpsProbe(identity: string, ca = trusted.cert): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const request = get({ hostname: '127.0.0.1', port, ...probeTls(ca, identity) }, response => {
      response.resume(); response.once('end', () => resolve(response.statusCode));
    });
    request.once('error', reject);
  });
}
function websocketProbe(identity: string, ca = trusted.cert): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`wss://127.0.0.1:${port}`, probeTls(ca, identity));
    socket.once('message', data => { socket.close(); resolve((Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer)).toString('utf8')); });
    socket.once('error', reject);
  });
}
describe('local container readiness TLS', () => {
  for (const identity of ['localhost', '192.0.2.42']) {
    it(`verifies HTTPS and WebSocket product identity ${identity} over loopback`, async () => {
      expect(await httpsProbe(identity)).toBe(200);
      expect(await websocketProbe(identity)).toBe('hello');
    });
  }
  for (const identity of ['wrong.example.test', '192.0.2.43']) {
    it(`rejects a mismatched certificate for ${identity}`, async () => {
      await expect(httpsProbe(identity)).rejects.toThrow(/certificate|altname/u);
      await expect(websocketProbe(identity)).rejects.toThrow(/certificate|altname/u);
    });
  }
  it('rejects an untrusted CA for both transports', async () => {
    await expect(httpsProbe('192.0.2.42', untrusted.cert)).rejects.toThrow(/certificate/u);
    await expect(websocketProbe('192.0.2.42', untrusted.cert)).rejects.toThrow(/certificate/u);
  });
});
