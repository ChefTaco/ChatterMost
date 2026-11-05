import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, chmod, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createHttpsServer, request } from 'node:https';
import { describe, expect, it } from 'vitest';
import { listenerTls } from '../../src/server/listener.js';
import { loadEnv } from '../../src/server/env.js';
import { createTestServer } from './helpers.js';

const execute = promisify(execFile);
describe('native TLS and fresh identity bootstrap', () => {
  it('serves verified HTTPS and refuses exposed or symlinked private keys', async () => {
    const root = await mkdtemp(join(tmpdir(), 'chat-native-tls-'));
    const certificate = join(root, 'server.crt'),
      key = join(root, 'server.key');
    try {
      await execute('openssl', [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        key,
        '-out',
        certificate,
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost',
        '-days',
        '2'
      ]);
      await chmod(key, 0o600);
      const tls = listenerTls({ TLS_CERT_PATH: certificate, TLS_KEY_PATH: key });
      if (tls === undefined) throw new Error('Expected TLS configuration');
      const server = createHttpsServer(tls, (_request, response) => response.end('verified'));
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const address = server.address();
        if (address === null || typeof address === 'string')
          throw new Error('Expected TCP listener');
        const response = await new Promise<string>((resolve, reject) => {
          const req = request(
            {
              hostname: '127.0.0.1',
              port: address.port,
              servername: 'localhost',
              ca: undefined,
              rejectUnauthorized: true
            },
            () => reject(new Error('Untrusted certificate was accepted'))
          );
          req.once('error', (error) => resolve(error.message));
          req.end();
        });
        expect(response).toMatch(/certificate/u);
        const ca = await readFile(certificate);
        const body = await new Promise<string>((resolve, reject) => {
          const req = request(
            { hostname: '127.0.0.1', port: address.port, servername: 'localhost', ca },
            (response) => {
              let text = '';
              response.on('data', (chunk: Buffer) => {
                text += chunk.toString();
              });
              response.on('end', () => resolve(text));
            }
          );
          req.once('error', reject);
          req.end();
        });
        expect(body).toBe('verified');
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
      }
      await chmod(key, 0o644);
      expect(() => listenerTls({ TLS_CERT_PATH: certificate, TLS_KEY_PATH: key })).toThrow(
        'owner-only'
      );
      await chmod(key, 0o600);
      await symlink(key, join(root, 'linked.key'));
      expect(() =>
        listenerTls({ TLS_CERT_PATH: certificate, TLS_KEY_PATH: join(root, 'linked.key') })
      ).toThrow('regular files');
      expect(() => listenerTls({ TLS_CERT_PATH: certificate })).toThrow('configured together');
      expect(listenerTls({})).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('pins a fresh administrator ID and repeats without changing the account or password', async () => {
    const initialId = 'syntheticadmin' + '0'.repeat(12);
    const server = await createTestServer({ ADMIN_INITIAL_ID: initialId });
    try {
      const account = server.services.users.findByUsername('admin');
      expect(account?.id).toBe(initialId);
      const hash = account?.passwordHash;
      expect((await server.services.users.ensureAdminFromEnv()).id).toBe(initialId);
      expect(server.services.users.findByUsername('admin')?.passwordHash).toBe(hash);
      expect(
        server.store.read((state) => state.users.filter((user) => user.id === initialId))
      ).toHaveLength(1);
      await server.store.write((state) => {
        const user = state.users.find((candidate) => candidate.id === initialId);
        if (user) user.id = 'differentadmin' + '0'.repeat(12);
      });
      await expect(server.services.users.ensureAdminFromEnv()).rejects.toThrow(
        'differs from the existing account'
      );
    } finally {
      await server.store.close();
      await server.abuseControl.close();
    }
  });

  it('refuses a new initial administrator over existing accounts and rejects malformed bootstrap IDs', async () => {
    const initialId = 'syntheticadmin' + '0'.repeat(12);
    const server = await createTestServer({ ADMIN_INITIAL_ID: initialId });
    try {
      await server.store.write((state) => {
        const user = state.users.find((candidate) => candidate.id === initialId);
        if (user) user.username = 'existing-operator';
      });
      await expect(server.services.users.ensureAdminFromEnv()).rejects.toThrow(
        'empty account store'
      );
      expect(
        server.store.read((state) => state.users.filter((user) => user.username === 'admin'))
      ).toHaveLength(0);
      expect(() =>
        loadEnv({
          enforceFileMode: false,
          overrides: { NODE_ENV: 'test', ADMIN_INITIAL_ID: 'not-a-product-id' }
        })
      ).toThrow();
      expect(() =>
        loadEnv({
          enforceFileMode: false,
          overrides: { NODE_ENV: 'test', TLS_CERT_PATH: '/opt/chat/server.crt', TLS_KEY_PATH: '' }
        })
      ).toThrow('configured together');
    } finally {
      await server.store.close();
      await server.abuseControl.close();
    }
  });
});
