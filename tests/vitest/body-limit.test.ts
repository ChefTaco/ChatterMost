import { expect, it } from 'vitest';
import { createTestServer } from './helpers.js';

function streamBytes(bytes: Uint8Array, chunkSize = 1): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset === bytes.length) return controller.close();
      const end = Math.min(offset + chunkSize, bytes.length);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    }
  });
}

it('coalesces tiny transfer chunks in the production request-body middleware', async () => {
  const server = await createTestServer();
  server.app.post('/body-limit-fixture', async (c) => {
    const reader = c.req.raw.body?.getReader();
    if (reader === undefined) throw new Error('Missing fixture body');
    let chunks = 0;
    let bytes = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      chunks++;
      bytes += next.value.length;
      expect(next.value.every((byte) => byte === 120)).toBe(true);
    }
    return c.json({ chunks, bytes });
  });
  const response = await server.app.request('/body-limit-fixture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: streamBytes(new Uint8Array(65536).fill(120)),
    duplex: 'half'
  } as RequestInit);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ chunks: 1, bytes: 65536 });
});

it('preserves streamed JSON login and rejects an oversized stream before authentication', async () => {
  const server = await createTestServer();
  const json = new TextEncoder().encode(JSON.stringify({ login_id: 'admin', password: 'AdminChangeMe123!' }));
  const login = await server.app.request('/api/v4/users/login', {
    method: 'POST',
    headers: server.baseHeaders,
    body: streamBytes(json),
    duplex: 'half'
  } as RequestInit);
  expect(login.status).toBe(200);
  expect(login.headers.get('Token')).toBeTruthy();

  const oversized = await server.app.request('/api/v4/users/login', {
    method: 'POST',
    headers: server.baseHeaders,
    body: streamBytes(new Uint8Array(1024 * 1024 + 1), 256),
    duplex: 'half'
  } as RequestInit);
  expect(oversized.status).toBe(413);
  expect(await oversized.json()).toMatchObject({
    id: 'api.context.request_body_too_large.app_error',
    status_code: 413
  });
});
