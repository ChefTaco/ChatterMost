import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';
import { validatedHiveAdminAccountReceipts } from './hive-admin-accounts.js';

import { createId, nowMs } from '../shared/mattermost.js';
import type { AuditLogRecord, MetricsRecord, StoreState } from './domain.js';

type MetricName = keyof MetricsRecord;
const metricNames = ['httpRequests', 'errors', 'websocketConnections', 'messagesPosted', 'reactionsAdded', 'filesUploaded', 'moderationActions', 'hermesBotMessages'] as const satisfies readonly MetricName[];

function emptyMetrics(): StoreState['metrics'] {
  return {
    httpRequests: 0,
    errors: 0,
    websocketConnections: 0,
    messagesPosted: 0,
    reactionsAdded: 0,
    filesUploaded: 0,
    moderationActions: 0,
    hermesBotMessages: 0
  };
}

export function createEmptyState(): StoreState {
  const now = nowMs();
  return {
    users: [],
    profileImages: [],
    sessions: [],
    personalAccessTokens: [],
    inviteCodes: [],
    teams: [],
    teamMembers: [],
    channels: [],
    channelMembers: [],
    posts: [],
    postEditHistory: [],
    reactions: [],
    customEmoji: [],
    files: [],
    preferences: [],
    statuses: [],
    bots: [],
    slashCommands: [],
    serverConfig: {},
    privacySettings: {
      id: createId(),
      showEmailAddress: false,
      showFullName: true,
      teammateNameDisplay: 'username',
      enableDiagnostics: false,
      enableTelemetry: false,
      enableSecurityAlerts: false,
      enableAdminNotices: false,
      enableUserNotices: false,
      enablePublicFileLinks: false,
      enableFileAttachments: true,
      enableCustomEmoji: false,
      enableEmojiPicker: true,
      enableBotAccountCreation: true,
      enableUserAccessTokens: true,
      enablePostSearch: true,
      enableFileSearch: true,
      updateAt: now
    },
    auditSequence: 0,
    auditLogs: [],
    auditOutbox: [],
    botOperationReceipts: [],
    hiveAdminAccountReceipts: [],
    supervisionPolicy: {
      id: createId(),
      mode: 'audit_only',
      blockedTerms: [],
      channelRestrictions: {},
      userRestrictions: {},
      agentRestrictions: {},
      fileRestrictions: {},
      createAt: now,
      updateAt: now
    },
    supervisionEvents: [],
    agentIdentities: [],
    agentConversationBindings: [],
    incomingWebhooks: [],
    outgoingWebhooks: [],
    metrics: emptyMetrics()
  };
}

export class JsonStore {
  private state: StoreState = createEmptyState();
  private readonly filePath: string | null;
  private writeQueue: Promise<void> = Promise.resolve();
  private persistenceHeld = false;

  public constructor(filePath: string | null, private readonly readOnly = false) {
    this.filePath = filePath;
  }

  public async initialize(): Promise<void> {
    if (this.filePath === null) {
      this.state = createEmptyState();
      return;
    }

    try {
      const raw = await readFile(this.filePath, 'utf8');
      this.state = hydrateState(JSON.parse(raw) as Partial<StoreState>);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        if (this.readOnly) throw new Error('Read-only preflight requires an existing JSON store', { cause: error });
        this.state = createEmptyState();
        await this.persist();
        return;
      }
      throw error;
    }
  }

  public read<T>(reader: (state: Readonly<StoreState>) => T): T {
    if (this.persistenceHeld) throw new Error('Runtime persistence is uncertain; preserve retained storage and restart after review');
    return reader(this.state);
  }

  public incrementMetric(name: MetricName): void {
    this.state.metrics[name] += 1;
  }

  /** Readiness: refuses once a failed write has made persistence uncertain. */
  public health(): Promise<void> {
    if (this.persistenceHeld) return Promise.reject(new Error('persistence_held'));
    return Promise.resolve();
  }

  public async write<T>(writer: (state: StoreState) => T): Promise<T> {
    if (this.readOnly) throw new Error('Writes are disabled in preflight mode');
    const operation = this.writeQueue.then(async () => {
      if (this.persistenceHeld) throw new Error('Runtime persistence is uncertain; no subsequent writes are permitted');
      const current = this.state;
      const baselineMetrics = { ...current.metrics };
      const { draft, commit } = createDraft(current);
      const result = writer(draft);
      const { next } = commit();
      try { await this.persist(next); } catch (error) { this.persistenceHeld = true; throw error; }
      mergeConcurrentMetricIncrements(next, current.metrics, baselineMetrics);
      this.state = next;
      return result;
    });
    this.writeQueue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  public async close(): Promise<void> {
    await this.writeQueue;
    if (!this.readOnly && !this.persistenceHeld) await this.persist(this.state);
  }

  private async persist(state: StoreState = this.state): Promise<void> {
    if (this.filePath === null) {
      return;
    }

    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const tempPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(tempPath, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
      const staged = await open(tempPath, 'r+');
      try { await staged.sync(); } finally { await staged.close(); }
      await rename(tempPath, this.filePath);
      const directory = await open(path.dirname(this.filePath), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } finally {
      await rm(tempPath, { force: true });
    }
  }
}

type RuntimeStateRow = {
  value: unknown;
};

export class PostgresStore {
  private state: StoreState = createEmptyState();
  private readonly prisma: PrismaClient;
  private writeQueue: Promise<void> = Promise.resolve();
  private persistenceHeld = false;
  private wholeDocumentPending = true;

  public constructor(databaseUrl: string, private readonly readOnly = false) {
    this.prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } }
    });
  }

  public async initialize(): Promise<void> {
    if (!this.readOnly) {
      await this.prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS "RuntimeState" ("key" TEXT PRIMARY KEY, "value" JSONB NOT NULL, "update_at" BIGINT NOT NULL)');
    }
    const rows = await this.prisma.$queryRawUnsafe<RuntimeStateRow[]>('SELECT "value" FROM "RuntimeState" WHERE "key" = $1 LIMIT 1', 'default');
    const row = rows[0];
    if (row === undefined) {
      if (this.readOnly) throw new Error('Read-only preflight requires an existing RuntimeState row');
      this.state = createEmptyState();
      await this.persist();
      return;
    }
    this.state = hydrateState(row.value as Partial<StoreState>);
  }

  public read<T>(reader: (state: Readonly<StoreState>) => T): T {
    if (this.persistenceHeld) throw new Error('Runtime persistence is uncertain; preserve retained storage and restart after review');
    return reader(this.state);
  }

  public incrementMetric(name: MetricName): void {
    this.state.metrics[name] += 1;
  }

  /** Readiness: persistence is trusted and the database answers. */
  public async health(): Promise<void> {
    if (this.persistenceHeld) throw new Error('persistence_held');
    await this.prisma.$queryRawUnsafe('SELECT 1');
  }

  public async write<T>(writer: (state: StoreState) => T): Promise<T> {
    if (this.readOnly) throw new Error('Writes are disabled in preflight mode');
    const operation = this.writeQueue.then(async () => {
      if (this.persistenceHeld) throw new Error('Runtime persistence is uncertain; no subsequent writes are permitted');
      const current = this.state;
      const baselineMetrics = { ...current.metrics };
      const { draft, commit } = createDraft(current);
      const result = writer(draft);
      const { next, touched } = commit();
      try {
        // The first write stores the whole hydrated document; later writes send only what changed.
        if (this.wholeDocumentPending) await this.persist(next);
        else await this.persistFields(next, touched);
        this.wholeDocumentPending = false;
      } catch (error) {
        this.persistenceHeld = true;
        throw error;
      }
      mergeConcurrentMetricIncrements(next, current.metrics, baselineMetrics);
      this.state = next;
      return result;
    });
    this.writeQueue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  public async close(): Promise<void> {
    await this.writeQueue;
    if (!this.readOnly && !this.persistenceHeld) await this.persist(this.state);
    await this.prisma.$disconnect();
  }

  private async persist(state: StoreState = this.state): Promise<void> {
    await this.prisma.$executeRawUnsafe('INSERT INTO "RuntimeState" ("key", "value", "update_at") VALUES ($1, $2::jsonb, $3) ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "update_at" = EXCLUDED."update_at"', 'default', JSON.stringify(state), nowMs());
  }

  /**
   * Replaces only the named top-level fields of the stored document, in one statement, so the
   * row is never left half-written. Falls back to a whole-document write if the row is missing.
   */
  private async persistFields(state: StoreState, fields: ReadonlySet<keyof StoreState>): Promise<void> {
    const patch: Partial<Record<keyof StoreState, unknown>> = {};
    for (const field of fields) patch[field] = state[field];
    const updated = await this.prisma.$executeRawUnsafe('UPDATE "RuntimeState" SET "value" = "value" || $2::jsonb, "update_at" = $3 WHERE "key" = $1', 'default', JSON.stringify(patch), nowMs());
    if (updated !== 1) await this.persist(state);
  }
}

/**
 * A copy-on-write draft of `current` for one write. Each top-level field is cloned the first time
 * the writer reads or assigns it, so a write that touches a few collections no longer copies the
 * whole state, and the original is never mutated. `commit` returns the next state (untouched fields
 * shared with `current`) and the fields the writer touched, which are all that need persisting.
 * Metrics are always copied up front: concurrent increments are merged into them after the write.
 */
export function createDraft(current: StoreState): { draft: StoreState; commit: () => { next: StoreState; touched: ReadonlySet<keyof StoreState> } } {
  const touched = new Set<keyof StoreState>(['metrics']);
  const values = new Map<keyof StoreState, unknown>([['metrics', { ...current.metrics }]]);
  const draft = {} as StoreState;
  for (const field of Object.keys(current) as (keyof StoreState)[]) {
    Object.defineProperty(draft, field, {
      enumerable: true,
      configurable: false,
      get: () => {
        if (!values.has(field)) {
          values.set(field, structuredClone(current[field]));
          touched.add(field);
        }
        return values.get(field);
      },
      set: (value: unknown) => {
        values.set(field, value);
        touched.add(field);
      }
    });
  }
  Object.preventExtensions(draft);
  return {
    draft,
    commit: () => {
      const next = { ...current };
      for (const [field, value] of values) (next as Record<keyof StoreState, unknown>)[field] = value;
      return { next, touched };
    }
  };
}

/** Fills collections that older persisted documents lack; both stores read the same document shape. */
function hydrateState(input: Partial<StoreState>): StoreState {
  const empty = createEmptyState();
  const auditLogs = hydrateAuditLogs(input.auditLogs ?? empty.auditLogs);
  return {
    ...empty,
    ...input,
    users: input.users ?? empty.users,
    profileImages: input.profileImages ?? empty.profileImages,
    sessions: input.sessions ?? empty.sessions,
    personalAccessTokens: input.personalAccessTokens ?? empty.personalAccessTokens,
    inviteCodes: input.inviteCodes ?? empty.inviteCodes,
    teams: input.teams ?? empty.teams,
    teamMembers: input.teamMembers ?? empty.teamMembers,
    channels: input.channels ?? empty.channels,
    channelMembers: input.channelMembers ?? empty.channelMembers,
    posts: input.posts ?? empty.posts,
    postEditHistory: input.postEditHistory ?? empty.postEditHistory,
    reactions: input.reactions ?? empty.reactions,
    customEmoji: input.customEmoji ?? empty.customEmoji,
    files: input.files ?? empty.files,
    preferences: input.preferences ?? empty.preferences,
    statuses: input.statuses ?? empty.statuses,
    bots: input.bots ?? empty.bots,
    slashCommands: input.slashCommands ?? empty.slashCommands,
    serverConfig: input.serverConfig ?? empty.serverConfig,
    privacySettings: input.privacySettings ?? empty.privacySettings,
    auditSequence: Math.max(input.auditSequence ?? 0, 0, ...auditLogs.map((record) => record.exportSequence)),
    auditLogs,
    auditOutbox: input.auditOutbox ?? empty.auditOutbox,
    botOperationReceipts: input.botOperationReceipts ?? empty.botOperationReceipts,
    hiveAdminAccountReceipts: validatedHiveAdminAccountReceipts(input.hiveAdminAccountReceipts ?? empty.hiveAdminAccountReceipts),
    supervisionPolicy: input.supervisionPolicy ?? empty.supervisionPolicy,
    supervisionEvents: input.supervisionEvents ?? empty.supervisionEvents,
    agentIdentities: input.agentIdentities ?? empty.agentIdentities,
    agentConversationBindings: input.agentConversationBindings ?? empty.agentConversationBindings,
    incomingWebhooks: input.incomingWebhooks ?? empty.incomingWebhooks,
    outgoingWebhooks: input.outgoingWebhooks ?? empty.outgoingWebhooks,
    metrics: input.metrics ?? empty.metrics
  };
}

function hydrateAuditLogs(records: AuditLogRecord[]): AuditLogRecord[] {
  const legacyCount = records.filter((record) => !Number.isSafeInteger(record.exportSequence) || record.exportSequence < 1).length;
  if (legacyCount === 0) return records;
  const assigned = new Map<string, number>();
  records.slice().reverse().forEach((record, index) => {
    assigned.set(record.id, index + 1);
  });
  return records.map((record) => ({
    ...record,
    exportSequence: Number.isSafeInteger(record.exportSequence) && record.exportSequence > 0
      ? record.exportSequence
      : assigned.get(record.id) ?? 1
  }));
}

function mergeConcurrentMetricIncrements(draft: StoreState, current: Readonly<MetricsRecord>, baseline: Readonly<MetricsRecord>): void {
  for (const name of metricNames) {
    draft.metrics[name] += current[name] - baseline[name];
  }
}

export type StateStore = Pick<JsonStore, 'initialize' | 'read' | 'incrementMetric' | 'write' | 'close' | 'health'>;
