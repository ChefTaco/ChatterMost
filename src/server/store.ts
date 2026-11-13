import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';

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
    metrics: emptyMetrics()
  };
}

export class JsonStore {
  private state: StoreState = createEmptyState();
  private readonly filePath: string | null;
  private writeQueue: Promise<void> = Promise.resolve();

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
    return reader(this.state);
  }

  public incrementMetric(name: MetricName): void {
    this.state.metrics[name] += 1;
  }

  public async write<T>(writer: (state: StoreState) => T): Promise<T> {
    if (this.readOnly) throw new Error('Writes are disabled in preflight mode');
    const operation = this.writeQueue.then(async () => {
      const current = this.state;
      const baselineMetrics = { ...current.metrics };
      const draft = structuredClone(current);
      const result = writer(draft);
      await this.persist(draft);
      mergeConcurrentMetricIncrements(draft, current.metrics, baselineMetrics);
      this.state = draft;
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
    if (!this.readOnly) await this.persist(this.state);
  }

  private async persist(state: StoreState = this.state): Promise<void> {
    if (this.filePath === null) {
      return;
    }

    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const tempPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(tempPath, JSON.stringify(state, null, 2), { flag: 'wx', mode: 0o600 });
      await rename(tempPath, this.filePath);
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
    return reader(this.state);
  }

  public incrementMetric(name: MetricName): void {
    this.state.metrics[name] += 1;
  }

  public async write<T>(writer: (state: StoreState) => T): Promise<T> {
    if (this.readOnly) throw new Error('Writes are disabled in preflight mode');
    const operation = this.writeQueue.then(async () => {
      const current = this.state;
      const baselineMetrics = { ...current.metrics };
      const draft = structuredClone(current);
      const result = writer(draft);
      await this.persist(draft);
      mergeConcurrentMetricIncrements(draft, current.metrics, baselineMetrics);
      this.state = draft;
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
    if (!this.readOnly) await this.persist(this.state);
    await this.prisma.$disconnect();
  }

  private async persist(state: StoreState = this.state): Promise<void> {
    await this.prisma.$executeRawUnsafe('INSERT INTO "RuntimeState" ("key", "value", "update_at") VALUES ($1, $2::jsonb, $3) ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "update_at" = EXCLUDED."update_at"', 'default', JSON.stringify(state), nowMs());
  }
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
    supervisionPolicy: input.supervisionPolicy ?? empty.supervisionPolicy,
    supervisionEvents: input.supervisionEvents ?? empty.supervisionEvents,
    agentIdentities: input.agentIdentities ?? empty.agentIdentities,
    agentConversationBindings: input.agentConversationBindings ?? empty.agentConversationBindings,
    incomingWebhooks: input.incomingWebhooks ?? empty.incomingWebhooks,
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

export type StateStore = Pick<JsonStore, 'initialize' | 'read' | 'incrementMetric' | 'write' | 'close'>;
