import { isDeepStrictEqual } from 'node:util';

import type { StoreState, MetricsRecord } from './domain.js';
import type { StateStore } from './store.js';

const authPaths = new Set(['/api/v4/users/login/type', '/api/v4/users/login', '/api/v4/auth/oathweave/session', '/api/v4/users/logout']);

/** Only authentication may mutate volatile state in an isolated restore. */
export function rehearsalRequestAllowed(method: string, pathname: string): boolean {
  return method === 'GET' || method === 'HEAD' || (method === 'POST' && authPaths.has(pathname));
}

export function rehearsalSocketActionAllowed(raw: string): boolean {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && 'action' in value &&
      ['authentication_challenge', 'ping', 'get_statuses', 'get_statuses_by_ids'].includes(String(value.action));
  } catch { return false; }
}

/** The source is opened read-only. No callback ever receives its live state. */
export class AuthenticatedRehearsalStore implements StateStore {
  private state!: StoreState;
  private queue: Promise<void> = Promise.resolve();
  public constructor(private readonly source: StateStore) {}
  public async initialize(): Promise<void> {
    await this.source.initialize();
    this.state = this.source.read(state => structuredClone(state));
    // Captured sessions from the source installation cannot authorize a clone.
    this.state.sessions = [];
  }
  public read<T>(reader: (state: Readonly<StoreState>) => T): T { return reader(this.state); }
  public incrementMetric(name: keyof MetricsRecord): void { this.state.metrics[name] += 1; }
  public write<T>(writer: (state: StoreState) => T): Promise<T> {
    const operation = this.queue.then(() => {
      const draft = structuredClone(this.state);
      const result = writer(draft);
      for (const key of Object.keys(draft) as (keyof StoreState)[]) {
        if (!['sessions', 'auditLogs', 'auditSequence'].includes(key) && !isDeepStrictEqual(draft[key], this.state[key])) {
          throw new Error('Durable mutations are disabled in authenticated rehearsal');
        }
      }
      this.state = draft;
      return result;
    });
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }
  public async close(): Promise<void> { await this.queue; await this.source.close(); }
}
