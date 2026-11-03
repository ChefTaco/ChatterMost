import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { AuditLogService } from '../../src/server/services.js';
import { JsonStore } from '../../src/server/store.js';

describe('JsonStore resilience', () => {
  it('does not follow a planted predictable temporary-file symlink', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'chattermost-store-symlink-'));
    const storePath = path.join(root, 'state.json');
    const sentinel = path.join(root, 'sentinel');
    await writeFile(sentinel, 'synthetic sentinel');
    await symlink(sentinel, `${storePath}.${process.pid}.tmp`);
    const store = new JsonStore(storePath);
    await store.initialize();
    expect(await readFile(sentinel, 'utf8')).toBe('synthetic sentinel');
    await store.close();
    await rm(root, { recursive: true });
  });

  it('does not expose partial mutations when a writer throws', async () => {
    const store = new JsonStore(null);
    await store.initialize();

    await expect(
      store.write((state) => {
        state.metrics.errors += 1;
        throw new Error('writer failed');
      })
    ).rejects.toThrow('writer failed');

    expect(store.read((state) => state.metrics.errors)).toBe(0);
  });

  it('rolls back the in-memory draft when persistence fails', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'chattermost-store-failure-'));
    const storePath = path.join(root, 'state.json');
    const store = new JsonStore(storePath);
    await store.initialize();
    await rm(root, { recursive: true });
    await writeFile(root, 'blocks recreation of the state directory');

    await expect(
      store.write((state) => {
        state.metrics.errors += 1;
      })
    ).rejects.toThrow();
    expect(store.read((state) => state.metrics.errors)).toBe(0);

    await rm(root, { force: true });
  });

  it('keeps request metrics in memory until a durable write or shutdown flush', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'chattermost-store-metrics-'));
    const storePath = path.join(root, 'state.json');
    const store = new JsonStore(storePath);
    await store.initialize();
    store.incrementMetric('httpRequests');

    const beforeFlush = new JsonStore(storePath);
    await beforeFlush.initialize();
    expect(beforeFlush.read((state) => state.metrics.httpRequests)).toBe(0);

    await store.close();
    const afterFlush = new JsonStore(storePath);
    await afterFlush.initialize();
    expect(afterFlush.read((state) => state.metrics.httpRequests)).toBe(1);

    await rm(root, { recursive: true });
  });

  it('persists monotonic audit export sequences across restarts', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'chattermost-store-audit-sequence-'));
    const storePath = path.join(root, 'state.json');
    const firstStore = new JsonStore(storePath);
    await firstStore.initialize();
    const first = await new AuditLogService(firstStore).record({ action: 'first.event' });
    await firstStore.close();

    const secondStore = new JsonStore(storePath);
    await secondStore.initialize();
    const second = await new AuditLogService(secondStore).record({ action: 'second.event' });
    expect(second.exportSequence).toBe(first.exportSequence + 1);
    expect(secondStore.read((state) => state.auditSequence)).toBe(second.exportSequence);
    await secondStore.close();
    await rm(root, { recursive: true });
  });

  it('recovers and publishes a durable audit outbox operation exactly once after restart', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'chattermost-store-audit-outbox-'));
    const storePath = path.join(root, 'state.json');
    const operationId = 'auditoperation00000000000000';
    const firstStore = new JsonStore(storePath);
    await firstStore.initialize();
    const firstAudit = new AuditLogService(firstStore);
    await firstStore.write((state) => {
      state.metrics.errors += 1;
      firstAudit.enqueue(state, { action: 'bot.identity_updated', targetId: 'bot-user-id' }, operationId);
    });
    await firstStore.close();

    const secondStore = new JsonStore(storePath);
    await secondStore.initialize();
    const secondAudit = new AuditLogService(secondStore);
    expect(secondAudit.operation(operationId)).toMatchObject({ publishedAt: 0 });
    expect(secondStore.read((state) => state.metrics.errors)).toBe(1);
    await secondAudit.publishPending();
    await secondAudit.publishPending();
    expect(secondAudit.operation(operationId)?.publishedAt).toBeGreaterThan(0);
    expect(secondAudit.list().filter((entry) => entry.id === operationId)).toHaveLength(1);
    await secondStore.close();
    await rm(root, { recursive: true });
  });
});
