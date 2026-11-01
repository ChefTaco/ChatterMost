import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  provisionSecurityFusion,
  validateProvisioningBaseUrl,
} from '../../scripts/provision-security-fusion.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

describe('Security Fusion provisioning', () => {
  it('requires HTTPS outside loopback and rejects embedded credentials', () => {
    expect(() => validateProvisioningBaseUrl('http://chat.example.test')).toThrow('must use HTTPS');
    expect(() => validateProvisioningBaseUrl('https://user:secret@chat.example.test')).toThrow('embedded credentials');
    expect(validateProvisioningBaseUrl('http://127.0.0.1:8065').origin).toBe('http://127.0.0.1:8065');
    expect(validateProvisioningBaseUrl('https://chat.example.test').origin).toBe('https://chat.example.test');
  });

  it('preserves an existing Magnus bot token during idempotent reconciliation', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'security-fusion-provision-'));
    const outputPath = path.join(root, 'magnus.env');
    await writeFile(
      outputPath,
      'SECURITY_FUSION_CHATTERMOST_CHANNEL_ID=old-channel\nSECURITY_FUSION_CHATTERMOST_BOT_TOKEN=preserved-token\n',
      { mode: 0o600 }
    );
    const responses = [
      jsonResponse({ status: 'OK', build_number: 'chattermost-0.1.0', compatibility_profile: 'mattermost-v11.8' }),
      jsonResponse({}, { headers: { token: 'admin-token' } }),
      jsonResponse([{ id: 'team-id' }]),
      jsonResponse([{ id: 'channel-id', name: 'security-fusion' }]),
      jsonResponse([{ user_id: 'bot-user-id', username: 'magnus-security' }]),
      jsonResponse({ id: 'bot-user-id', is_bot: true }),
      jsonResponse({ channel_id: 'channel-id', user_id: 'bot-user-id' }),
    ];
    const requestedPaths: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      requestedPaths.push(new URL(input instanceof Request ? input.url : input).pathname);
      const response = responses.shift();
      if (!response) throw new Error('unexpected request');
      return response;
    }) as unknown as typeof fetch;

    await provisionSecurityFusion({
      baseUrl: 'https://chat.example.test',
      username: 'admin',
      password: 'password',
      outputPath,
      fetchImpl,
    });

    expect(requestedPaths).not.toContain('/admin/bots/bot-user-id/regenerate-token');
    expect(await readFile(outputPath, 'utf8')).toContain('SECURITY_FUSION_CHATTERMOST_BOT_TOKEN=preserved-token');
  });

  it('refuses implicit rotation when the existing credential is unavailable', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'security-fusion-provision-'));
    const responses = [
      jsonResponse({ status: 'OK', build_number: 'chattermost-0.1.0', compatibility_profile: 'mattermost-v11.8' }),
      jsonResponse({}, { headers: { token: 'admin-token' } }),
      jsonResponse([{ id: 'team-id' }]),
      jsonResponse([{ id: 'channel-id', name: 'security-fusion' }]),
      jsonResponse([{ user_id: 'bot-user-id', username: 'magnus-security' }]),
    ];
    const fetchImpl = vi.fn(async () => {
      const response = responses.shift();
      if (!response) throw new Error('unexpected request');
      return response;
    }) as unknown as typeof fetch;

    await expect(provisionSecurityFusion({
      baseUrl: 'https://chat.example.test',
      username: 'admin',
      password: 'password',
      outputPath: path.join(root, 'missing.env'),
      fetchImpl,
    })).rejects.toThrow('refusing implicit token rotation');
  });

  it('rejects an unexpected target identity before sending credentials', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      status: 'OK',
      build_number: 'other-service',
      compatibility_profile: 'mattermost-v11.8',
    })) as unknown as typeof fetch;
    await expect(provisionSecurityFusion({
      baseUrl: 'https://chat.example.test',
      username: 'admin',
      password: 'password',
      outputPath: '/unused',
      fetchImpl,
    })).rejects.toThrow('target identity');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects an oversized identity response before sending credentials', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, {
      headers: { 'content-length': String(1024 * 1024 + 1) },
    })) as unknown as typeof fetch;
    await expect(provisionSecurityFusion({
      baseUrl: 'https://chat.example.test',
      username: 'admin',
      password: 'password',
      outputPath: '/unused',
      fetchImpl,
    })).rejects.toThrow('response exceeds');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
