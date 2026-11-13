import { assertNewBotOperation, botOperationDigest, durableBotOperation, recordBotOperation } from './bot-operations.js';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createChatIdentity } from './oathweave.js';
import path from 'node:path';

import { badRequest, conflict, createId, forbidden, notFound, nowMs, unauthorized, type JsonRecord, type MattermostAutocompleteSuggestion, type MattermostChannelType, type MattermostCommandResponse, type MattermostUserStatus, type WebSocketBroadcast, type WebSocketEventEnvelope, type WebSocketResponseFrame } from '../shared/mattermost.js';
import type {
  AgentConversationBindingRecord,
  AgentIdentityRecord,
  AuditLogRecord,
  AuditOutboxRecord,
  BotAccountRecord,
  ChannelMemberRecord,
  ChannelRecord,
  CustomEmojiRecord,
  FileInfoRecord,
  IncomingWebhookRecord,
  InviteCodeRecord,
  PersonalAccessTokenRecord,
  PostEditHistoryRecord,
  PostRecord,
  PreferenceRecord,
  ReactionRecord,
  SessionRecord,
  PrivacySettingsRecord,
  SlashCommandRecord,
  SupervisionEventRecord,
  SupervisionPolicyRecord,
  TeamMemberRecord,
  TeamRecord,
  UserProfileImageRecord,
  UserRecord,
  StoreState
} from './domain.js';
import { websocketFanout } from './capabilities.js';
import type { AppEnv } from './env.js';
import { resolveDataPath } from './env.js';
import { toMattermostFileInfo, toMattermostPost, toMattermostReaction } from './mappers.js';
import { hashPassword, hashSessionToken, hashToken, sanitizeFilename, createSecretToken, verifyPassword } from './security.js';
import type { StateStore } from './store.js';

export type AuthContext = {
  user: UserRecord;
  sessionId: string | null;
  authMethod: 'cookie' | 'bearer' | 'bot' | 'personal_access_token' | 'test';
  /**
   * Re-checks the credential behind this context, for connections that outlive one request.
   * It keeps the credential's hashes, never the credential itself.
   */
  stillValid?: () => boolean;
};

export type LoginResult = {
  user: UserRecord;
  token: string;
  sessionId: string;
  expiresAt: number;
};

export type InviteResult = {
  invite: InviteCodeRecord;
  code: string;
};

export type UploadInput = {
  userId: string;
  channelId: string;
  name: string;
  mimeType: string;
  bytes: Uint8Array;
};

const allowedUploadMimeTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain']);
const auditOutboxRetention = 2000;

export const HERMES_GATEWAY_COMMANDS = [
  { trigger: 'help', description: 'Show available Hermes commands', hint: '' },
  { trigger: 'commands', description: 'Browse all Hermes commands and installed skills', hint: '[page]' },
  { trigger: 'new', description: 'Start a fresh Hermes session', hint: '[name]' },
  { trigger: 'reset', description: 'Reset the current Hermes conversation', hint: '[now]' },
  { trigger: 'status', description: 'Show session, model, token, and context information', hint: '' },
  { trigger: 'model', description: 'Show or switch the session model', hint: '[provider:model]' },
  { trigger: 'reasoning', description: 'Show or change reasoning effort', hint: '[level]' },
  { trigger: 'fast', description: 'Show or change fast mode', hint: '[normal|fast|status]' },
  { trigger: 'usage', description: 'Show token usage and provider limits', hint: '' },
  { trigger: 'stop', description: 'Stop the running Hermes task', hint: '' },
  { trigger: 'tasks', description: 'List recent bot tasks', hint: '' },
  { trigger: 'sources', description: 'Show source IDs from recent research', hint: '' },
  { trigger: 'background', description: 'Run a prompt in the background', hint: '<prompt>' },
  { trigger: 'queue', description: 'Queue a prompt for the next turn', hint: '<prompt>' },
  { trigger: 'steer', description: 'Guide the running task after its next tool call', hint: '<prompt>' },
  { trigger: 'sessions', description: 'Browse saved Hermes sessions', hint: '' },
  { trigger: 'resume', description: 'Resume a named Hermes session', hint: '[name]' },
  { trigger: 'skills', description: 'Search, inspect, install, or manage skills', hint: '[action]' },
  { trigger: 'reload-skills', description: 'Reload installed Hermes skills', hint: '' },
  { trigger: 'reload-mcp', description: 'Reload configured MCP servers', hint: '' },
  { trigger: 'sethome', description: 'Set this conversation as the Hermes home channel', hint: '' },
  { trigger: 'whoami', description: 'Show your Hermes command access level', hint: '' },
  { trigger: 'arxiv', description: 'Run the installed Hermes arXiv skill command', hint: '<prompt>' }
] as const;

export type ServiceBundle = {
  auditLog: AuditLogService;
  privacy: PrivacySettingsService;
  config: ConfigService;
  users: UserService;
  sessions: SessionService;
  auth: AuthService;
  invites: InviteService;
  teams: TeamService;
  channels: ChannelService;
  posts: PostService;
  reactions: ReactionService;
  customEmoji: CustomEmojiService;
  files: FileService;
  profileImages: ProfileImageService;
  preferences: PreferenceService;
  statuses: StatusService;
  bots: BotService;
  supervision: SupervisionService;
  agents: AgentService;
  slashCommands: SlashCommandService;
  hub: WebSocketHub;
};

type HubConnection = {
  id: string;
  userId: string | null;
  eventSeq: number;
  socket: SocketLike;
  /** False once the credential that authenticated this connection stops working. */
  authorized: (() => boolean) | null;
};

export type SocketLike = {
  send(data: string): void;
  close?(code: number, reason: string): void;
};

export type WebSocketAttachOptions = {
  connectionId?: string;
  eventSeq?: number;
  authorized?: () => boolean;
};

export class AuditLogService {
  private publishQueue: Promise<void> = Promise.resolve();
  private retryTimer: NodeJS.Timeout | null = null;
  private retryDelayMs = 1000;

  public constructor(private readonly store: StateStore) {}

  public async record(input: { actorUserId?: string | null; action: string; targetId?: string | null; ip?: string | null; metadata?: JsonRecord }): Promise<AuditLogRecord> {
    return this.store.write((state) => appendAuditLog(state, input));
  }

  public list(limit = 200): AuditLogRecord[] {
    return this.store.read((state) => state.auditLogs.slice(0, limit));
  }

  public enqueue(
    state: StoreState,
    input: { actorUserId?: string | null; action: string; targetId?: string | null; ip?: string | null; metadata?: JsonRecord },
    operationId = createId()
  ): AuditOutboxRecord {
    if (state.auditOutbox.filter((event) => event.publishedAt === 0).length >= auditOutboxRetention) {
      throw new Error('Audit outbox capacity reached');
    }
    if (state.auditOutbox.some((event) => event.operationId === operationId)) {
      throw conflict('Operation ID already exists');
    }
    const event: AuditOutboxRecord = {
      operationId,
      createAt: nowMs(),
      publishedAt: 0,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      targetId: input.targetId ?? null,
      ip: input.ip ?? null,
      metadata: input.metadata ?? {}
    };
    state.auditOutbox.unshift(event);
    compactAuditOutbox(state);
    return event;
  }

  public operation(operationId: string): AuditOutboxRecord | null {
    return this.store.read((state) => state.auditOutbox.find((event) => event.operationId === operationId) ?? null);
  }

  public publishPending(): Promise<void> {
    const operation = this.publishQueue.then(async () => {
      if (!this.store.read((state) => state.auditOutbox.some((event) => event.publishedAt === 0))) {
        return;
      }
      await this.store.write((state) => {
        const pending = state.auditOutbox.filter((event) => event.publishedAt === 0).sort((left, right) => left.createAt - right.createAt);
        for (const event of pending) {
          appendAuditLog(
            state,
            {
              actorUserId: event.actorUserId,
              action: event.action,
              targetId: event.targetId,
              ip: event.ip,
              metadata: { ...event.metadata, operation_id: event.operationId }
            },
            event.operationId
          );
          event.publishedAt = nowMs();
        }
        compactAuditOutbox(state);
      });
    });
    const settled = operation.then(() => {
      this.retryDelayMs = 1000;
      if (this.retryTimer !== null) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
    });
    this.publishQueue = settled.catch(() => undefined);
    return settled;
  }

  public publishPendingSoon(): void {
    void this.publishPending().catch((error: unknown) => {
      process.stderr.write(
        JSON.stringify({
          level: 'error',
          message: 'audit_outbox_publish_failed',
          error_type: error instanceof Error ? error.name : 'UnknownError'
        }) + '\n'
      );
      if (this.retryTimer === null) {
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          this.publishPendingSoon();
        }, this.retryDelayMs);
        this.retryTimer.unref();
        this.retryDelayMs = Math.min(this.retryDelayMs * 2, 60_000);
      }
    });
  }
}

function appendAuditLog(
  state: StoreState,
  input: { actorUserId?: string | null; action: string; targetId?: string | null; ip?: string | null; metadata?: JsonRecord },
  id = createId()
): AuditLogRecord {
  state.auditSequence += 1;
  const entry: AuditLogRecord = {
    id,
    exportSequence: state.auditSequence,
    createAt: nowMs(),
    actorUserId: input.actorUserId ?? null,
    action: input.action,
    targetId: input.targetId ?? null,
    ip: input.ip ?? null,
    metadata: input.metadata ?? {}
  };
  state.auditLogs.unshift(entry);
  state.auditLogs = state.auditLogs.slice(0, 2000);
  if (input.action.includes('moderator') || input.action.includes('supervision')) {
    state.metrics.moderationActions += 1;
  }
  return entry;
}

function compactAuditOutbox(state: StoreState): void {
  const pending = state.auditOutbox.filter((event) => event.publishedAt === 0);
  const published = state.auditOutbox.filter((event) => event.publishedAt > 0).sort((left, right) => right.createAt - left.createAt).slice(0, auditOutboxRetention);
  state.auditOutbox = [...pending, ...published].sort((left, right) => right.createAt - left.createAt);
}

export class PrivacySettingsService {
  public constructor(
    private readonly store: StateStore,
    private readonly auditLog: AuditLogService,
    private readonly hub: WebSocketHub
  ) {}

  public get(): PrivacySettingsRecord {
    return this.store.read((state) => state.privacySettings);
  }

  public async update(patch: Partial<Omit<PrivacySettingsRecord, 'id' | 'updateAt'>>, actorUserId: string): Promise<PrivacySettingsRecord> {
    const updated = await this.store.write((state) => {
      state.privacySettings = {
        ...state.privacySettings,
        ...patch,
        updateAt: nowMs()
      };
      return state.privacySettings;
    });
    await this.auditLog.record({
      actorUserId,
      action: 'admin.setting_changed',
      targetId: 'privacy',
      metadata: { keys: Object.keys(patch) }
    });
    await this.hub.broadcast('config_changed', { settings: this.clientSafeSettings(updated) }, {});
    return updated;
  }

  public clientSafeSettings(settings = this.get()): JsonRecord {
    return {
      ShowEmailAddress: settings.showEmailAddress,
      ShowFullName: settings.showFullName,
      TeammateNameDisplay: settings.teammateNameDisplay,
      EnableDiagnostics: settings.enableDiagnostics,
      EnableTelemetry: settings.enableTelemetry,
      EnableSecurityAlerts: settings.enableSecurityAlerts,
      EnableAdminNotices: settings.enableAdminNotices,
      EnableUserNotices: settings.enableUserNotices,
      EnablePublicFileLinks: settings.enablePublicFileLinks,
      EnableFileAttachments: settings.enableFileAttachments,
      EnableCustomEmoji: settings.enableCustomEmoji,
      EnableEmojiPicker: settings.enableEmojiPicker,
      EnableBotAccountCreation: settings.enableBotAccountCreation,
      EnableUserAccessTokens: settings.enableUserAccessTokens,
      EnablePostSearch: settings.enablePostSearch,
      EnableFileSearch: settings.enableFileSearch
    };
  }
}

export class ConfigService {
  public constructor(
    private readonly store: StateStore,
    private readonly env: AppEnv,
    private readonly privacy: PrivacySettingsService,
    private readonly auditLog: AuditLogService,
    private readonly hub: WebSocketHub
  ) {}

  public clientConfig(): JsonRecord {
    const version = this.env.ALLOW_VERSION_ADVERTISEMENT ? this.env.COMPATIBILITY_SERVER_VERSION : '0.0.0-compatible';
    const diagnosticId = createHash('sha256').update(`chattermost:${this.env.SERVER_URL}`).digest('hex').slice(0, 26);
    return {
      Version: version,
      BuildNumber: this.env.BUILD_NUMBER,
      BuildHash: this.env.BUILD_HASH,
      BuildHashEnterprise: 'none',
      BuildDate: this.env.BUILD_DATE,
      ReleaseId: this.env.RELEASE_ID,
      SiteURL: this.env.SERVER_URL,
      WebsocketURL: this.env.SERVER_URL.replace(/^http/u, 'ws'),
      DiagnosticId: diagnosticId,
      TelemetryId: diagnosticId,
      EnableOpenServer: false,
      EnableUserCreation: false,
      EnableSignUpWithEmail: 'false',
      EnableSignInWithEmail: 'true',
      EnableSignInWithUsername: 'true',
      EnableDiagnostics: this.env.ENABLE_DIAGNOSTICS,
      EnableTelemetry: this.env.ENABLE_TELEMETRY,
      EnableSecurityAlerts: this.env.ENABLE_SECURITY_ALERT_CHECKS,
      EnablePublicLink: this.env.ENABLE_PUBLIC_FILE_LINKS,
      ExperimentalEnablePostMetadata: true,
      FeatureFlagAppsEnabled: false,
      FeatureFlagCustomGroups: false,
      FeatureFlagDataRetention: true,
      FeatureFlagPluginPlaybooks: false,
      CompatibilityProfile: this.env.COMPATIBILITY_PROFILE,
      DesktopCompatibilityProfile: 'mattermost-desktop-compatible',
      EnableLdap: false,
      EnableSaml: false,
      EnableSignUpWithOpenId: false,
      EnableSignUpWithGitLab: false,
      EnableSignUpWithGoogle: false,
      EnablePushNotifications: false,
      PushNotificationServer: '',
      PrivacySettings: this.privacy.clientSafeSettings()
    };
  }

  public fullConfig(): JsonRecord {
    return this.store.read((state) => ({
      ServiceSettings: {
        SiteURL: this.env.SERVER_URL,
        EnableOpenServer: false,
        EnableUserAccessTokens: state.privacySettings.enableUserAccessTokens
      },
      TeamSettings: {
        EnableUserCreation: false,
        MaxUsersPerTeam: 5000
      },
      FileSettings: {
        EnableFileAttachments: state.privacySettings.enableFileAttachments,
        EnablePublicLink: state.privacySettings.enablePublicFileLinks,
        MaxFileSize: 25 * 1024 * 1024,
        AllowedFileTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain']
      },
      PrivacySettings: this.privacy.clientSafeSettings(),
      NativeAgentRegistry: {
        Enabled: true,
        RedisFanoutEnabled: websocketFanout.redisImplemented,
        WebSocketFanoutMode: websocketFanout.mode
      },
      SsoProviders: {
        OIDC: false,
        SAML: false,
        LDAP: false
      },
      PushNotifications: {
        Enabled: false,
        MobileAckEndpoint: '/api/v4/notifications/ack'
      },
      SearchSettings: {
        Strategy: 'postgres-trigram-with-substring-fallback',
        EnableFullTextSearch: true
      },
      ImportSettings: {
        MattermostArchiveEndpoint: '/api/v4/import/mattermost'
      },
      Stored: state.serverConfig
    }));
  }

  public async patchConfig(patch: JsonRecord, actorUserId: string): Promise<JsonRecord> {
    const updated = await this.store.write((state) => {
      state.serverConfig = {
        ...state.serverConfig,
        ...Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, typeof value === 'object' && value !== null && !Array.isArray(value) ? value : { value }]))
      };
      return state.serverConfig;
    });
    await this.auditLog.record({
      actorUserId,
      action: 'admin.config_changed',
      targetId: 'server_config',
      metadata: { keys: Object.keys(patch) }
    });
    await this.hub.broadcast('config_changed', { config: this.clientConfig() }, {});
    return updated;
  }

  public license(): JsonRecord {
    return {
      IsLicensed: 'false',
      IsTrial: 'false',
      SKUShortName: 'compatible-free',
      Company: 'ChatterMost',
      Users: '0'
    };
  }
}

export class UserService {
  public constructor(
    private readonly store: StateStore,
    private readonly env: AppEnv,
    private readonly auditLog: AuditLogService,
    private readonly hub: WebSocketHub
  ) {}

  public findById(id: string): UserRecord | null {
    return this.store.read((state) => state.users.find((user) => user.id === id) ?? null);
  }

  public getById(id: string): UserRecord {
    const user = this.findById(id);
    if (user === null || user.deleteAt > 0) {
      throw notFound('User');
    }
    return user;
  }

  public findByUsername(username: string): UserRecord | null {
    const normalized = username.toLowerCase();
    return this.store.read((state) => state.users.find((user) => user.username.toLowerCase() === normalized) ?? null);
  }

  public findByEmail(email: string): UserRecord | null {
    const normalized = email.toLowerCase();
    return this.store.read((state) => state.users.find((user) => user.email.toLowerCase() === normalized) ?? null);
  }

  public resolveLogin(loginId: string): UserRecord | null {
    return loginId.includes('@') ? this.findByEmail(loginId) : this.findByUsername(loginId);
  }

  public search(term: string, options: { includeEmail?: boolean } = {}): UserRecord[] {
    const needle = term.toLowerCase();
    return this.store.read((state) =>
      state.users
        .filter((user) => user.deleteAt === 0)
        .filter(
          (user) =>
            user.username.toLowerCase().includes(needle) ||
            user.nickname.toLowerCase().includes(needle) ||
            (options.includeEmail === true && user.email.toLowerCase().includes(needle))
        )
        .slice(0, 100)
    );
  }

  public protectedDisplayNames(): string[] {
    return this.store.read((state) =>
      state.users
        .filter((user) => user.deleteAt === 0 && (isAdmin(user) || user.isBot))
        .flatMap((user) => [
          user.username,
          user.nickname,
          [user.firstName, user.lastName].filter((part) => part.length > 0).join(' '),
          user.botDescription
        ])
        .filter((name) => name.trim().length > 0)
    );
  }

  public listAll(actor: UserRecord): UserRecord[] {
    requireAdmin(actor);
    return this.store.read((state) => [...state.users].sort((a, b) => a.username.localeCompare(b.username)));
  }

  public async ensureAdminFromEnv(): Promise<UserRecord> {
    const existing = this.findByUsername(this.env.ADMIN_USERNAME);
    if (existing !== null) {
      if (this.env.ADMIN_INITIAL_ID !== undefined && existing.id !== this.env.ADMIN_INITIAL_ID) {
        throw new Error('Initial administrator ID differs from the existing account; preserve its identity and use explicit account linking');
      }
      if (this.env.ADMIN_FORCE_PASSWORD_RESET) {
        const hash = await hashPassword(this.env.ADMIN_PASSWORD);
        await this.store.write((state) => {
          const user = state.users.find((candidate) => candidate.id === existing.id);
          if (user !== undefined) {
            user.passwordHash = hash;
            user.roles = ensureRole(user.roles, 'system_admin');
            user.updateAt = nowMs();
          }
        });
      }
      return this.getById(existing.id);
    }

    if (this.env.ADMIN_INITIAL_ID !== undefined && this.store.read(state => state.users.length > 0)) {
      throw new Error('An explicit initial administrator ID requires an empty account store; existing accounts require explicit adoption');
    }

    return this.createUser({
      username: this.env.ADMIN_USERNAME,
      email: this.env.ADMIN_EMAIL,
      password: this.env.ADMIN_PASSWORD,
      role: 'system_admin system_user',
      actorUserId: null
    }, this.env.ADMIN_INITIAL_ID);
  }

  public async createUser(input: { username: string; email: string; password: string; role: string; actorUserId: string | null; isBot?: boolean; botDescription?: string }, initialId?: string): Promise<UserRecord> {
    const normalizedUsername = input.username.toLowerCase();
    const normalizedEmail = input.email.toLowerCase();
    const now = nowMs();
    const user: UserRecord = {
      id: initialId ?? createId(),
      createAt: now,
      updateAt: now,
      deleteAt: 0,
      username: normalizedUsername,
      email: normalizedEmail,
      passwordHash: await hashPassword(input.password),
      nickname: '',
      firstName: '',
      lastName: '',
      position: '',
      roles: input.role,
      locale: 'en',
      timezone: { useAutomaticTimezone: 'true', automaticTimezone: '', manualTimezone: '' },
      notifyProps: { desktop: 'default', email: 'true', push: 'mention' },
      lastPictureUpdate: 0,
      isBot: input.isBot ?? false,
      botDescription: input.botDescription ?? '',
      disabledAt: 0
    };
    await this.store.write((state) => {
      // Re-check uniqueness inside the serialized write so two concurrent
      // signups cannot both pass a pre-write check and create duplicates.
      if (state.users.some((candidate) => candidate.username === normalizedUsername)) {
        throw conflict('Username already exists');
      }
      if (state.users.some((candidate) => candidate.email === normalizedEmail)) {
        throw conflict('Email already exists');
      }
      if (state.users.some((candidate) => candidate.id === user.id)) {
        throw conflict('User ID already exists');
      }
      state.users.push(user);
      state.statuses.push({
        user_id: user.id,
        status: 'offline',
        manual: false,
        last_activity_at: now
      });
    });
    await this.auditLog.record({
      actorUserId: input.actorUserId,
      action: input.isBot ? 'bot.created' : 'user.created',
      targetId: user.id
    });
    await this.hub.broadcast('new_user', { user_id: user.id, username: user.username }, {});
    return user;
  }

  public async patchUser(userId: string, patch: Partial<Pick<UserRecord, 'nickname' | 'firstName' | 'lastName' | 'position' | 'locale'>>, actor: UserRecord): Promise<UserRecord> {
    if (actor.id !== userId && !isAdmin(actor)) {
      throw forbidden();
    }
    const updated = await this.store.write((state) => {
      const user = state.users.find((candidate) => candidate.id === userId);
      if (user === undefined) {
        throw notFound('User');
      }
      Object.assign(user, patch, { updateAt: nowMs() });
      return user;
    });
    await this.auditLog.record({ actorUserId: actor.id, action: 'user.updated', targetId: userId });
    await this.hub.broadcast('user_updated', { user_id: userId }, { user_id: userId });
    return updated;
  }

  public async changePassword(userId: string, newPassword: string, actor: UserRecord, currentPassword?: string, currentSessionId?: string | null): Promise<void> {
    if (actor.id !== userId && !isAdmin(actor)) {
      throw forbidden();
    }
    // A non-admin changing their own password must prove knowledge of the
    // current password, so a stolen or riding session cannot silently take
    // over the account. Admin-initiated resets remain exempt.
    if (actor.id === userId && !isAdmin(actor)) {
      const current = this.findById(userId);
      if (current === null) {
        throw notFound('User');
      }
      if (currentPassword === undefined || !(await verifyPassword(currentPassword, current.passwordHash))) {
        throw unauthorized('Current password is incorrect');
      }
    }
    const hash = await hashPassword(newPassword);
    const now = nowMs();
    await this.store.write((state) => {
      const user = state.users.find((candidate) => candidate.id === userId);
      if (user === undefined) {
        throw notFound('User');
      }
      user.passwordHash = hash;
      user.updateAt = now;
      // Invalidate every other live session for this account. An admin reset of
      // a compromised account revokes all of the target's sessions; a
      // self-service change keeps only the caller's current session alive.
      for (const session of state.sessions) {
        if (session.userId === userId && session.revokedAt === 0 && session.id !== currentSessionId) {
          session.revokedAt = now;
        }
      }
    });
    this.hub.closeUnauthorized();
    await this.auditLog.record({
      actorUserId: actor.id,
      action: 'password.changed',
      targetId: userId
    });
  }

  public async setDisabled(userId: string, disabled: boolean, actor: UserRecord): Promise<UserRecord> {
    requireAdmin(actor);
    const now = nowMs();
    const updated = await this.store.write((state) => {
      const user = state.users.find((candidate) => candidate.id === userId);
      if (user === undefined) {
        throw notFound('User');
      }
      user.disabledAt = disabled ? now : 0;
      user.deleteAt = disabled ? now : 0;
      user.updateAt = now;
      if (disabled) {
        for (const session of state.sessions) {
          if (session.userId === userId && session.revokedAt === 0) session.revokedAt = now;
        }
        for (const token of state.personalAccessTokens) {
          if (token.userId === userId && token.deleteAt === 0) {
            token.deleteAt = now;
            token.updateAt = now;
          }
        }
        state.bots = state.bots.filter((bot) => bot.userId !== userId);
        for (const webhook of state.incomingWebhooks) {
          if (webhook.creatorId === userId) webhook.enabled = false;
        }
      }
      return user;
    });
    this.hub.closeUnauthorized();
    await this.auditLog.record({
      actorUserId: actor.id,
      action: disabled ? 'admin.user.deactivated' : 'admin.user.reactivated',
      targetId: userId
    });
    return updated;
  }
}

export class SessionService {
  private readonly identity: ReturnType<typeof createChatIdentity>;
  public constructor(
    private readonly store: StateStore,
    private readonly env: AppEnv,
    private readonly auditLog: AuditLogService,
    private readonly hub?: WebSocketHub
  ) { this.identity=createChatIdentity(env); }

  public async createSession(user: UserRecord, deviceId = '', boundIdentity?:{context:string;expiresAt:number}): Promise<LoginResult> {
    const token = createSecretToken();
    const now = nowMs();
    const session: SessionRecord = {
      id: createId(),
      tokenHash: hashSessionToken(token, this.env),
      userId: user.id,
      createAt: now,
      expiresAt: boundIdentity ? Math.min(boundIdentity.expiresAt,now+15*60*1000) : now + this.env.SESSION_DAYS * 24 * 60 * 60 * 1000,
      deviceId,
      revokedAt: 0,
      ...(boundIdentity?{oathweaveContext:boundIdentity.context}:{})
    };
    await this.store.write((state) => {
      if(boundIdentity && !state.users.some(candidate=>candidate.id===user.id && candidate.disabledAt===0 && candidate.deleteAt===0 && !candidate.isBot)) throw unauthorized();
      // Expired and revoked sessions can never authenticate again. Dropping them here keeps the
      // persisted document from growing with every sign-in and every short-lived bound session.
      state.sessions = state.sessions.filter((candidate) => candidate.revokedAt === 0 && candidate.expiresAt > now);
      state.sessions.push(session);
    });
    await this.auditLog.record({
      actorUserId: user.id,
      action: 'login.success',
      targetId: session.id
    });
    return { user, token, sessionId: session.id, expiresAt: session.expiresAt };
  }

  public authenticateToken(token: string): AuthContext | null {
    const auth=this.resolveToken(token);
    if(auth?.sessionId && this.requiresOnlineValidation(auth.sessionId)) return null;
    return auth;
  }

  public requiresOnlineValidation(sessionId:string):boolean {
    return this.store.read(state=>Boolean(state.sessions.find(session=>session.id===sessionId)?.oathweaveContext));
  }

  public async exchangeIdentity(token:string):Promise<LoginResult> {
    if(!this.identity)throw unauthorized();
    let identity;
    try {identity=await this.identity.authenticate(token);} catch {throw unauthorized();}
    const user=this.store.read(state=>state.users.find(candidate=>candidate.id===identity.localUserId && candidate.disabledAt===0 && candidate.deleteAt===0 && !candidate.isBot));
    if(!user)throw unauthorized();
    return this.createSession(user,'HiveXUI',{context:this.identity.seal(token),expiresAt:identity.expiresAt});
  }

  public async authenticateWebSession(token:string):Promise<AuthContext|null> {
    const auth=this.resolveToken(token);
    if(!auth?.sessionId)return auth;
    const context=this.store.read(state=>state.sessions.find(session=>session.id===auth.sessionId)?.oathweaveContext);
    if(!context)return auth;
    if(!this.identity)return null;
    try {
      const identity=await this.identity.authenticate(this.identity.open(context));
      if(identity.localUserId!==auth.user.id)return null;
      // Recheck local disable/revocation after the external request.
      return this.resolveToken(token);
    } catch {return null;}
  }

  private resolveToken(token: string): AuthContext | null {
    const sessionHash = hashSessionToken(token, this.env);
    const tokenHash = hashToken(token, this.env);
    const auth = this.resolveHashes(sessionHash, tokenHash);
    if (auth === null) return null;
    return {
      ...auth,
      stillValid: () => {
        const current = this.resolveHashes(sessionHash, tokenHash);
        return current !== null && current.user.id === auth.user.id && current.sessionId === auth.sessionId && current.authMethod === auth.authMethod;
      }
    };
  }

  private resolveHashes(sessionHash: string, tokenHash: string): AuthContext | null {
    return this.store.read((state) => {
      const session = state.sessions.find((candidate) => candidate.tokenHash === sessionHash && candidate.revokedAt === 0 && candidate.expiresAt > nowMs());
      if (session !== undefined) {
        const user = state.users.find((candidate) => candidate.id === session.userId);
        if (user !== undefined && user.disabledAt === 0) {
          return { user, sessionId: session.id, authMethod: 'cookie' };
        }
      }

      const bot = state.bots.find((candidate) => candidate.tokenHash === tokenHash);
      if (bot !== undefined) {
        const user = state.users.find((candidate) => candidate.id === bot.userId);
        if (user !== undefined && user.disabledAt === 0) {
          return { user, sessionId: null, authMethod: 'bot' };
        }
      }

      const personalToken = state.personalAccessTokens.find((candidate) => candidate.tokenHash === tokenHash && candidate.deleteAt === 0);
      if (personalToken !== undefined) {
        const user = state.users.find((candidate) => candidate.id === personalToken.userId);
        if (user !== undefined && user.disabledAt === 0) {
          return { user, sessionId: null, authMethod: 'personal_access_token' };
        }
      }
      return null;
    });
  }

  public listUserSessions(userId: string, actor: UserRecord): SessionRecord[] {
    if (actor.id !== userId && !isAdmin(actor)) {
      throw forbidden();
    }
    return this.store.read((state) => state.sessions.filter((session) => session.userId === userId && session.revokedAt === 0 && session.expiresAt > nowMs()));
  }

  public async updateDevice(sessionId: string | null, deviceId: string): Promise<void> {
    if (sessionId === null) {
      return;
    }
    await this.store.write((state) => {
      const session = state.sessions.find((candidate) => candidate.id === sessionId && candidate.revokedAt === 0);
      if (session !== undefined) {
        session.deviceId = deviceId;
      }
    });
  }

  public async revokeCurrent(sessionId: string | null, actor: UserRecord): Promise<void> {
    if (sessionId === null) {
      return;
    }
    await this.store.write((state) => {
      const session = state.sessions.find((candidate) => candidate.id === sessionId);
      if (session !== undefined) {
        session.revokedAt = nowMs();
      }
    });
    this.hub?.closeUnauthorized();
    await this.auditLog.record({ actorUserId: actor.id, action: 'logout', targetId: sessionId });
  }

  public async revokeUserSessions(userId: string, actor: UserRecord): Promise<void> {
    if (actor.id !== userId && !isAdmin(actor)) {
      throw forbidden();
    }
    const now = nowMs();
    await this.store.write((state) => {
      for (const session of state.sessions) {
        if (session.userId === userId && session.revokedAt === 0) {
          session.revokedAt = now;
        }
      }
    });
    this.hub?.closeUnauthorized();
    await this.auditLog.record({
      actorUserId: actor.id,
      action: actor.id === userId ? 'sessions.revoked' : 'admin.session_revocation',
      targetId: userId
    });
  }

  public async createPersonalAccessToken(userId: string, description: string, actor: UserRecord): Promise<{ token: string; record: PersonalAccessTokenRecord }> {
    if (actor.id !== userId && !isAdmin(actor)) {
      throw forbidden();
    }
    const token = createSecretToken();
    const now = nowMs();
    const record: PersonalAccessTokenRecord = {
      id: createId(),
      tokenHash: hashToken(token, this.env),
      userId,
      description,
      createAt: now,
      updateAt: now,
      deleteAt: 0
    };
    await this.store.write((state) => {
      state.personalAccessTokens.push(record);
    });
    await this.auditLog.record({
      actorUserId: actor.id,
      action: 'token.creation',
      targetId: record.id
    });
    return { token, record };
  }
}

export class AuthService {
  private static readonly dummyPasswordHash = hashPassword(createSecretToken());

  public constructor(
    private readonly users: UserService,
    private readonly sessions: SessionService,
    private readonly auditLog: AuditLogService
  ) {}

  public loginType(loginId: string): JsonRecord {
    return {
      login_id: loginId,
      auth_type: 'password',
      auth_service: 'local',
      server_error_id: ''
    };
  }

  public async login(loginId: string, password: string, deviceId = ''): Promise<LoginResult> {
    const user = this.users.resolveLogin(loginId);
    // Unknown and disabled accounts still do password work so login timing
    // does not trivially reveal whether a username exists.
    const dummyHash = await AuthService.dummyPasswordHash;
    if (user === null || user.disabledAt > 0) {
      await verifyPassword(password, dummyHash);
      await this.auditLog.record({
        action: 'login.failure',
        metadata: { reason: 'not_found_or_disabled', login_id: loginId }
      });
      throw badRequest('Invalid login credentials');
    }
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      await this.auditLog.record({
        actorUserId: user.id,
        action: 'login.failure',
        metadata: { reason: 'bad_password' }
      });
      throw badRequest('Invalid login credentials');
    }
    return this.sessions.createSession(user, deviceId);
  }
}

export class InviteService {
  public constructor(
    private readonly store: StateStore,
    private readonly env: AppEnv,
    private readonly teams: TeamService,
    private readonly channels: ChannelService,
    private readonly auditLog: AuditLogService,
    private readonly hub: WebSocketHub
  ) {}

  public listActive(actor: UserRecord): InviteCodeRecord[] {
    requireAdmin(actor);
    return this.store.read((state) => state.inviteCodes.filter((invite) => invite.disabledAt === 0 && invite.expiresAt > nowMs() && invite.uses < invite.maxUses));
  }

  public async createInvite(input: { actor: UserRecord; maxUses: number; expiresInHours: number; role?: string; teamIds?: string[]; channelIds?: string[] }): Promise<InviteResult> {
    requireAdmin(input.actor);
    const code = createSecretToken(18);
    const now = nowMs();
    const invite: InviteCodeRecord = {
      id: createId(),
      codeHash: hashToken(code, this.env),
      rawCodePreview: `${code.slice(0, 4)}...${code.slice(-4)}`,
      createdByUserId: input.actor.id,
      createAt: now,
      updateAt: now,
      maxUses: input.maxUses,
      uses: 0,
      expiresAt: now + input.expiresInHours * 60 * 60 * 1000,
      role: input.role ?? 'system_user',
      teamIds: input.teamIds ?? this.teams.defaultTeamIds(),
      channelIds: input.channelIds ?? this.channels.defaultChannelIds(),
      disabledAt: 0
    };
    await this.store.write((state) => {
      state.inviteCodes.push(invite);
    });
    await this.auditLog.record({
      actorUserId: input.actor.id,
      action: 'invite.created',
      targetId: invite.id
    });
    return { invite, code };
  }

  public async revokeInvite(inviteId: string, actor: UserRecord): Promise<InviteCodeRecord> {
    requireAdmin(actor);
    const invite = await this.store.write((state) => {
      const found = state.inviteCodes.find((candidate) => candidate.id === inviteId);
      if (found === undefined) {
        throw notFound('Invite');
      }
      found.disabledAt = nowMs();
      found.updateAt = nowMs();
      return found;
    });
    await this.auditLog.record({
      actorUserId: actor.id,
      action: 'invite.revoked',
      targetId: invite.id
    });
    return invite;
  }

  public async enroll(input: { inviteCode: string; username: string; email: string; password: string }): Promise<UserRecord> {
    const hash = hashToken(input.inviteCode, this.env);
    const normalizedUsername = input.username.toLowerCase();
    const normalizedEmail = input.email.toLowerCase();
    const passwordHash = await hashPassword(input.password);
    const enrolled = await this.store.write((state) => {
      const candidate = state.inviteCodes.find((entry) => entry.codeHash === hash);
      if (candidate === undefined || candidate.disabledAt > 0 || candidate.expiresAt <= nowMs() || candidate.uses >= candidate.maxUses) {
        throw badRequest('Invite code is invalid or expired');
      }
      if (state.users.some((existing) => existing.username === normalizedUsername)) {
        throw conflict('Username already exists');
      }
      if (state.users.some((existing) => existing.email === normalizedEmail)) {
        throw conflict('Email already exists');
      }
      const activeTeamIds = new Set(
        candidate.teamIds.filter((teamId) => state.teams.some((team) => team.id === teamId && team.deleteAt === 0))
      );
      if (activeTeamIds.size !== candidate.teamIds.length) {
        throw badRequest('Invite enrollment targets are no longer available');
      }
      const activeChannels = candidate.channelIds.map((channelId) =>
        state.channels.find((channel) => channel.id === channelId && channel.deleteAt === 0)
      );
      if (
        activeChannels.some(
          (channel) =>
            channel === undefined ||
            ((channel.type === 'O' || channel.type === 'P') &&
              (!activeTeamIds.has(channel.teamId) ||
                !state.teams.some((team) => team.id === channel.teamId && team.deleteAt === 0)))
        )
      ) {
        throw badRequest('Invite enrollment targets are no longer available');
      }

      const now = nowMs();
      const enrolledUser: UserRecord = {
        id: createId(),
        createAt: now,
        updateAt: now,
        deleteAt: 0,
        username: normalizedUsername,
        email: normalizedEmail,
        passwordHash,
        nickname: '',
        firstName: '',
        lastName: '',
        position: '',
        roles: candidate.role,
        locale: 'en',
        timezone: { useAutomaticTimezone: 'true', automaticTimezone: '', manualTimezone: '' },
        notifyProps: { desktop: 'default', email: 'true', push: 'mention' },
        lastPictureUpdate: 0,
        isBot: false,
        botDescription: '',
        disabledAt: 0
      };
      state.users.push(enrolledUser);
      state.statuses.push({
        user_id: enrolledUser.id,
        status: 'offline',
        manual: false,
        last_activity_at: now
      });
      for (const teamId of activeTeamIds) {
        const existing = state.teamMembers.find((member) => member.teamId === teamId && member.userId === enrolledUser.id);
        if (existing === undefined) {
          state.teamMembers.push({
            id: createId(),
            teamId,
            userId: enrolledUser.id,
            roles: '',
            createAt: now,
            updateAt: now,
            deleteAt: 0
          });
        } else {
          existing.deleteAt = 0;
          existing.updateAt = now;
        }
      }
      for (const channel of activeChannels) {
        if (channel === undefined) continue;
        if (!state.channelMembers.some((member) => member.channelId === channel.id && member.userId === enrolledUser.id)) {
          state.channelMembers.push(createChannelMember(channel.id, enrolledUser.id, 'channel_user', now));
        }
      }

      candidate.uses += 1;
      candidate.updateAt = now;
      if (candidate.uses >= candidate.maxUses) {
        candidate.disabledAt = candidate.updateAt;
      }
      appendAuditLog(state, {
        actorUserId: candidate.createdByUserId,
        action: 'user.created',
        targetId: enrolledUser.id
      });
      appendAuditLog(state, {
        actorUserId: enrolledUser.id,
        action: 'invite.redeemed',
        targetId: candidate.id
      });
      return {
        user: enrolledUser,
        teamIds: [...activeTeamIds],
        channelIds: activeChannels.flatMap((channel) => channel?.id ?? [])
      };
    });
    await this.hub.broadcast('new_user', { user_id: enrolled.user.id, username: enrolled.user.username }, {});
    for (const teamId of enrolled.teamIds) {
      await this.hub.broadcast('user_added', { team_id: teamId, user_id: enrolled.user.id }, { team_id: teamId });
    }
    for (const channelId of enrolled.channelIds) {
      await this.hub.broadcast('user_added', { channel_id: channelId, user_id: enrolled.user.id }, { channel_id: channelId });
    }
    return enrolled.user;
  }
}

export class TeamService {
  public constructor(private readonly store: StateStore) {}

  public defaultTeamIds(): string[] {
    return this.store.read((state) => {
      const town = state.teams.find((team) => team.name === 'supervised-chat' && team.deleteAt === 0);
      return town === undefined ? [] : [town.id];
    });
  }

  public async ensureDefaultTeam(creatorId: string): Promise<TeamRecord> {
    const existing = this.store.read((state) => state.teams.find((team) => team.name === 'supervised-chat') ?? null);
    if (existing !== null) {
      return existing;
    }
    const now = nowMs();
    const team: TeamRecord = {
      id: createId(),
      createAt: now,
      updateAt: now,
      deleteAt: 0,
      name: 'supervised-chat',
      displayName: 'Supervised Chat',
      description: 'Default supervised communication team',
      type: 'O',
      companyName: '',
      allowedDomains: '',
      inviteId: '',
      allowOpenInvite: false,
      schemeId: null,
      groupConstrained: false
    };
    await this.store.write((state) => {
      state.teams.push(team);
    });
    await this.addUserToTeam(team.id, creatorId, 'team_admin');
    return team;
  }

  public listUserTeams(userId: string): TeamRecord[] {
    return this.store.read((state) => {
      const teamIds = new Set(state.teamMembers.filter((member) => member.userId === userId && member.deleteAt === 0).map((member) => member.teamId));
      return state.teams.filter((team) => teamIds.has(team.id) && team.deleteAt === 0);
    });
  }

  public listVisibleTeams(actor: UserRecord): TeamRecord[] {
    if (isAdmin(actor)) {
      return this.store.read((state) => state.teams.filter((team) => team.deleteAt === 0));
    }
    return this.listUserTeams(actor.id);
  }

  public getTeam(teamId: string): TeamRecord {
    const team = this.store.read((state) => state.teams.find((candidate) => candidate.id === teamId));
    if (team === undefined || team.deleteAt > 0) {
      throw notFound('Team');
    }
    return team;
  }

  public getTeamByName(name: string): TeamRecord {
    const team = this.store.read((state) => state.teams.find((candidate) => candidate.name === name));
    if (team === undefined || team.deleteAt > 0) {
      throw notFound('Team');
    }
    return team;
  }

  public listMembers(teamId: string): TeamMemberRecord[] {
    this.getTeam(teamId);
    return this.store.read((state) => state.teamMembers.filter((member) => member.teamId === teamId && member.deleteAt === 0));
  }

  public getMember(teamId: string, userId: string): TeamMemberRecord {
    const member = this.store.read((state) => state.teamMembers.find((candidate) => candidate.teamId === teamId && candidate.userId === userId && candidate.deleteAt === 0));
    if (member === undefined) {
      throw notFound('Team member');
    }
    return member;
  }

  public async addUserToTeam(teamId: string, userId: string, roles: string): Promise<TeamMemberRecord> {
    const existing = this.store.read((state) => state.teamMembers.find((member) => member.teamId === teamId && member.userId === userId));
    if (existing !== undefined) {
      if (existing.deleteAt === 0) return existing;
      const updateAt = nowMs();
      await this.store.write((state) => {
        const stored = state.teamMembers.find((member) => member.id === existing.id);
        if (stored !== undefined) Object.assign(stored, { roles, updateAt, deleteAt: 0 });
      });
      return { ...existing, roles, updateAt, deleteAt: 0 };
    }
    const now = nowMs();
    const member: TeamMemberRecord = {
      id: createId(),
      teamId,
      userId,
      roles,
      createAt: now,
      updateAt: now,
      deleteAt: 0
    };
    await this.store.write((state) => {
      state.teamMembers.push(member);
    });
    return member;
  }

  public async removeUserFromTeam(teamId: string, userId: string): Promise<void> {
    this.getMember(teamId, userId);
    const now = nowMs();
    await this.store.write((state) => {
      const member = state.teamMembers.find(
        (candidate) => candidate.teamId === teamId && candidate.userId === userId && candidate.deleteAt === 0
      );
      if (member === undefined) throw notFound('Team member');
      member.deleteAt = now;
      member.updateAt = now;
      const teamChannelIds = new Set(
        state.channels
          .filter((channel) => channel.teamId === teamId && channel.deleteAt === 0)
          .map((channel) => channel.id)
      );
      state.channelMembers = state.channelMembers.filter(
        (channelMember) => !(channelMember.userId === userId && teamChannelIds.has(channelMember.channelId))
      );
    });
  }

  public async updateMemberRoles(teamId: string, userId: string, roles: string): Promise<TeamMemberRecord> {
    const normalized = roles
      .split(/\s+/u)
      .filter((role) => role === 'team_user' || role === 'team_admin')
      .join(' ');
    if (normalized.length === 0) throw badRequest('At least one valid team role is required');
    const updated = await this.store.write((state) => {
      const member = state.teamMembers.find(
        (candidate) => candidate.teamId === teamId && candidate.userId === userId && candidate.deleteAt === 0
      );
      if (member === undefined) throw notFound('Team member');
      member.roles = normalized;
      member.updateAt = nowMs();
      return member;
    });
    return updated;
  }
}

export class ChannelService {
  private readonly searchIndex: ChannelSearchIndex;

  public constructor(
    private readonly store: StateStore,
    private readonly hub: WebSocketHub
  ) {
    this.searchIndex = new ChannelSearchIndex(() => this.store.read((state) => state.channels));
  }

  public defaultChannelIds(): string[] {
    return this.store.read((state) => {
      const activeTeamIds = new Set(state.teams.filter((team) => team.deleteAt === 0).map((team) => team.id));
      return state.channels
        .filter(
          (channel) =>
            channel.deleteAt === 0 &&
            activeTeamIds.has(channel.teamId) &&
            ['town-square', 'off-topic'].includes(channel.name)
        )
        .map((channel) => channel.id);
    });
  }

  public async ensureDefaultChannels(teamId: string, creatorId: string): Promise<ChannelRecord[]> {
    const channels: ChannelRecord[] = [];
    for (const channel of [
      { name: 'town-square', displayName: 'Town Square' },
      { name: 'off-topic', displayName: 'Off-Topic' }
    ]) {
      const existing = this.store.read((state) => state.channels.find((candidate) => candidate.name === channel.name) ?? null);
      if (existing !== null) {
        channels.push(existing);
        continue;
      }
      channels.push(
        await this.createChannel({
          creatorId,
          teamId,
          type: 'O',
          name: channel.name,
          displayName: channel.displayName,
          header: '',
          purpose: ''
        })
      );
    }
    return channels;
  }

  public getChannel(channelId: string): ChannelRecord {
    const channel = this.store.read((state) => state.channels.find((candidate) => candidate.id === channelId));
    if (channel === undefined || channel.deleteAt > 0) {
      throw notFound('Channel');
    }
    return channel;
  }

  public getByName(teamId: string, name: string): ChannelRecord {
    const channel = this.store.read((state) => state.channels.find((candidate) => candidate.teamId === teamId && candidate.name === name));
    if (channel === undefined || channel.deleteAt > 0) {
      throw notFound('Channel');
    }
    return channel;
  }

  public listForUser(userId: string, teamId?: string): ChannelRecord[] {
    return this.store.read((state) => {
      const memberIds = activeChannelIdsForUser(state, userId);
      return state.channels.filter((channel) => memberIds.has(channel.id) && channel.deleteAt === 0 && (teamId === undefined || channel.teamId === teamId || channel.type === 'D' || channel.type === 'G'));
    });
  }

  public listTeamChannels(teamId: string, options: { includeDeleted?: boolean } = {}): ChannelRecord[] {
    return this.store.read((state) => state.channels.filter((channel) => channel.teamId === teamId && (options.includeDeleted === true || channel.deleteAt === 0)));
  }

  public listChannelIdsForUser(userId: string): string[] {
    return this.store.read((state) => [...activeChannelIdsForUser(state, userId)]);
  }

  public searchTeamChannels(teamId: string, term: string, options: { nameOnly?: boolean } = {}): ChannelRecord[] {
    return this.searchIndex.search(teamId, term, options);
  }

  public listMembers(channelId: string): ChannelMemberRecord[] {
    this.getChannel(channelId);
    return this.store.read((state) => state.channelMembers.filter((member) => member.channelId === channelId));
  }

  public getMember(channelId: string, userId: string): ChannelMemberRecord {
    const member = this.store.read((state) => state.channelMembers.find((candidate) => candidate.channelId === channelId && candidate.userId === userId));
    if (member === undefined) {
      throw notFound('Channel member');
    }
    return member;
  }

  public assertMember(channelId: string, userId: string): void {
    this.getMember(channelId, userId);
  }

  private isTeamMember(teamId: string, userId: string): boolean {
    return this.store.read((state) => state.teamMembers.some((member) => member.teamId === teamId && member.userId === userId && member.deleteAt === 0));
  }

  public async createChannel(input: { creatorId: string; teamId: string; type: MattermostChannelType; name: string; displayName: string; header: string; purpose: string; actor?: UserRecord }): Promise<ChannelRecord> {
    const now = nowMs();
    const channel: ChannelRecord = {
      id: createId(),
      createAt: now,
      updateAt: now,
      deleteAt: 0,
      teamId: input.teamId,
      type: input.type,
      displayName: input.displayName,
      name: input.name,
      header: input.header,
      purpose: input.purpose,
      lastPostAt: 0,
      totalMsgCount: 0,
      extraUpdateAt: 0,
      creatorId: input.creatorId,
      agentPolicy: {},
      retentionDays: null
    };
    if (input.actor !== undefined && (input.type === 'D' || input.type === 'G')) {
      // A caller-named conversation would be found by direct() later and handed to the people it
      // names, with its creator still a member. Only direct() may create these.
      throw badRequest('Direct and group conversations are created through the direct message endpoints');
    }
    await this.store.write((state) => {
      if (input.type === 'O' || input.type === 'P') {
        const team = state.teams.find((candidate) => candidate.id === input.teamId && candidate.deleteAt === 0);
        if (team === undefined) {
          throw notFound('Team');
        }
        // Authorization and insertion share this serialized write, so a team
        // removal queued before creation cannot race the membership check.
        if (
          input.actor !== undefined &&
          !isAdmin(input.actor) &&
          !state.teamMembers.some(
            (member) => member.teamId === input.teamId && member.userId === input.actor?.id && member.deleteAt === 0
          )
        ) {
          throw forbidden('You must be a member of the team to create a channel in it');
        }
      }
      state.channels.push(channel);
      state.channelMembers.push(
        createChannelMember(
          channel.id,
          input.creatorId,
          input.type === 'O' || input.type === 'P' ? 'channel_admin' : 'channel_user',
          now
        )
      );
    });
    this.searchIndex.invalidate();
    await this.hub.broadcast('channel_created', { channel_id: channel.id }, input.type === 'O' ? { team_id: input.teamId } : { channel_id: channel.id });
    return channel;
  }

  public async patchChannel(channelId: string, patch: Partial<Pick<ChannelRecord, 'displayName' | 'header' | 'purpose' | 'retentionDays'>>, actor: UserRecord): Promise<ChannelRecord> {
    this.assertMember(channelId, actor.id);
    // Renaming a channel and changing its retention policy are management
    // actions; ordinary members may still edit header/purpose.
    if (patch.displayName !== undefined || patch.retentionDays !== undefined) {
      this.requireChannelManager(channelId, actor);
    }
    const updated = await this.store.write((state) => {
      const channel = state.channels.find((candidate) => candidate.id === channelId);
      if (channel === undefined) {
        throw notFound('Channel');
      }
      Object.assign(channel, patch, { updateAt: nowMs(), extraUpdateAt: nowMs() });
      return channel;
    });
    this.searchIndex.invalidate();
    await this.hub.broadcast('channel_updated', { channel_id: channelId }, { channel_id: channelId });
    return updated;
  }

  public async deleteChannel(channelId: string, actor: UserRecord): Promise<ChannelRecord> {
    const existing = this.getChannel(channelId);
    if (existing.type === 'D' || existing.type === 'G') {
      throw badRequest('Direct and group conversations cannot be deleted');
    }
    // Deleting is a management action like renaming: it removes the channel for every member.
    this.requireChannelManager(channelId, actor);
    const deleted = await this.store.write((state) => {
      const channel = state.channels.find((candidate) => candidate.id === channelId);
      if (channel === undefined) {
        throw notFound('Channel');
      }
      channel.deleteAt = nowMs();
      channel.updateAt = nowMs();
      channel.deleteBy = actor.id;
      return channel;
    });
    this.searchIndex.invalidate();
    await this.hub.broadcast('channel_deleted', { channel_id: channelId }, { channel_id: channelId });
    return deleted;
  }

  public async addUserToChannel(channelId: string, userId: string, roles: string, actor?: UserRecord): Promise<ChannelMemberRecord> {
    const normalizedRoles = roles.trim().length > 0 ? roles : 'channel_user';
    if (actor !== undefined) {
      const channel = this.getChannel(channelId);
      const selfJoiningPublicChannel = channel.type === 'O' && actor.id === userId && this.isTeamMember(channel.teamId, actor.id);
      if (!selfJoiningPublicChannel) {
        this.requireChannelManager(channelId, actor);
      }
    }
    if (!this.store.read((state) => state.users.some((user) => user.id === userId))) {
      throw notFound('User');
    }
    const existing = this.store.read((state) => state.channelMembers.find((member) => member.channelId === channelId && member.userId === userId));
    if (existing !== undefined) {
      if (existing.roles.trim().length === 0) {
        const lastUpdateAt = nowMs();
        await this.store.write((state) => {
          const stored = state.channelMembers.find((member) => member.id === existing.id);
          if (stored !== undefined) {
            stored.roles = normalizedRoles;
            stored.schemeUser = true;
            stored.schemeAdmin = normalizedRoles.includes('channel_admin');
            stored.lastUpdateAt = lastUpdateAt;
          }
        });
        return { ...existing, roles: normalizedRoles, schemeUser: true, lastUpdateAt };
      }
      return existing;
    }
    const now = nowMs();
    const member: ChannelMemberRecord = {
      id: createId(),
      channelId,
      userId,
      roles: normalizedRoles,
      lastViewedAt: 0,
      msgCount: 0,
      mentionCount: 0,
      notifyProps: { desktop: 'default', mark_unread: 'all', push: 'default' },
      lastUpdateAt: now,
      schemeUser: true,
      schemeAdmin: normalizedRoles.includes('channel_admin')
    };
    await this.store.write((state) => {
      state.channelMembers.push(member);
    });
    await this.hub.broadcast('user_added', { channel_id: channelId, user_id: userId }, { channel_id: channelId });
    return member;
  }

  public requireChannelManager(channelId: string, actor: UserRecord): void {
    if (isAdmin(actor)) {
      return;
    }
    const member = this.getMember(channelId, actor.id);
    if (!member.roles.split(/\s+/u).includes('channel_admin')) {
      throw forbidden('Channel admin role is required');
    }
  }

  public async removeUserFromChannel(channelId: string, userId: string, actor: UserRecord): Promise<void> {
    if (actor.id === userId) {
      this.assertMember(channelId, actor.id);
    } else {
      this.requireChannelManager(channelId, actor);
    }
    await this.store.write((state) => {
      state.channelMembers = state.channelMembers.filter((member) => !(member.channelId === channelId && member.userId === userId));
    });
    await this.hub.broadcast('user_removed', { channel_id: channelId, user_id: userId }, { channel_id: channelId });
  }

  public async viewChannel(channelId: string, userId: string): Promise<void> {
    const now = nowMs();
    await this.store.write((state) => {
      const member = state.channelMembers.find((candidate) => candidate.channelId === channelId && candidate.userId === userId);
      if (member !== undefined) {
        const channel = state.channels.find((candidate) => candidate.id === channelId);
        member.lastViewedAt = now;
        member.lastUpdateAt = now;
        member.mentionCount = 0;
        // Mark every currently posted message as read so unread() reports zero
        // immediately after viewing instead of the whole channel history.
        member.msgCount = channel?.totalMsgCount ?? member.msgCount;
      }
    });
    await this.hub.broadcast('channel_viewed', { channel_id: channelId, user_id: userId }, { user_id: userId });
  }

  public async updateMemberNotifyProps(channelId: string, userId: string, notifyProps: JsonRecord, actor: UserRecord): Promise<ChannelMemberRecord> {
    if (actor.id !== userId && !isAdmin(actor)) {
      throw forbidden();
    }
    const updated = await this.store.write((state) => {
      const member = state.channelMembers.find((candidate) => candidate.channelId === channelId && candidate.userId === userId);
      if (member === undefined) throw notFound('Channel member');
      member.notifyProps = { ...member.notifyProps, ...notifyProps };
      member.lastUpdateAt = nowMs();
      return member;
    });
    await this.hub.broadcast(
      'channel_member_updated',
      {
        channel_id: channelId,
        user_id: userId
      },
      { user_id: userId }
    );
    return updated;
  }

  public unread(channelId: string, userId: string): JsonRecord {
    const channel = this.getChannel(channelId);
    const member = this.getMember(channelId, userId);
    return {
      team_id: channel.teamId,
      channel_id: channelId,
      msg_count: Math.max(0, channel.totalMsgCount - member.msgCount),
      mention_count: member.mentionCount
    };
  }

  public async direct(userIds: string[], creatorId: string): Promise<ChannelRecord> {
    const sorted = [...new Set(userIds)].sort();
    if (!sorted.includes(creatorId)) {
      sorted.push(creatorId);
      sorted.sort();
    }
    if (this.store.read((state) => sorted.some((userId) => !state.users.some((user) => user.id === userId)))) {
      throw notFound('User');
    }
    const type: MattermostChannelType = sorted.length === 2 ? 'D' : 'G';
    const name = sorted.join('__');
    const existing = this.store.read((state) => state.channels.find((candidate) => candidate.name === name && candidate.type === type) ?? null);
    if (existing !== null) {
      for (const userId of sorted) {
        // Repair legacy direct memberships that predate the channel_user default.
        await this.addUserToChannel(existing.id, userId, 'channel_user');
      }
      return existing;
    }
    const channel = await this.createChannel({
      creatorId,
      teamId: '',
      type,
      name,
      displayName: '',
      header: '',
      purpose: ''
    });
    for (const userId of sorted) {
      await this.addUserToChannel(channel.id, userId, '');
    }
    await this.hub.broadcast(type === 'D' ? 'direct_added' : 'group_added', { channel_id: channel.id }, { user_ids: sorted });
    return channel;
  }

  public async setAgentPolicy(channelId: string, policy: JsonRecord, actor: UserRecord): Promise<ChannelRecord> {
    requireAdmin(actor);
    const updated = await this.store.write((state) => {
      const channel = state.channels.find((candidate) => candidate.id === channelId);
      if (channel === undefined) {
        throw notFound('Channel');
      }
      channel.agentPolicy = policy;
      channel.updateAt = nowMs();
      return channel;
    });
    await this.hub.broadcast('channel_updated', { channel_id: channelId }, { channel_id: channelId });
    return updated;
  }
}

function createChannelMember(channelId: string, userId: string, roles: string, timestamp: number): ChannelMemberRecord {
  return {
    id: createId(),
    channelId,
    userId,
    roles,
    lastViewedAt: 0,
    msgCount: 0,
    mentionCount: 0,
    notifyProps: { desktop: 'default', mark_unread: 'all', push: 'default' },
    lastUpdateAt: timestamp,
    schemeUser: true,
    schemeAdmin: roles.split(/\s+/u).includes('channel_admin')
  };
}

function activeChannelIdsForUser(state: Readonly<StoreState>, userId: string): Set<string> {
  const user = state.users.find((candidate) => candidate.id === userId && candidate.deleteAt === 0);
  if (user === undefined) return new Set();
  const activeTeams = state.teams.filter((team) => team.deleteAt === 0);
  const activeTeamIds = isAdmin(user)
    ? new Set(activeTeams.map((team) => team.id))
    : new Set(
        state.teamMembers
          .filter((member) => member.userId === userId && member.deleteAt === 0)
          .filter((member) => activeTeams.some((team) => team.id === member.teamId))
          .map((member) => member.teamId)
      );
  const activeChannelIds = new Set(
    state.channels
      .filter((channel) => channel.deleteAt === 0)
      .filter(
        (channel) =>
          channel.type === 'D' ||
          channel.type === 'G' ||
          (channel.teamId.length > 0 && activeTeamIds.has(channel.teamId))
      )
      .map((channel) => channel.id)
  );
  return new Set(
    state.channelMembers
      .filter((member) => member.userId === userId && activeChannelIds.has(member.channelId))
      .map((member) => member.channelId)
  );
}

/**
 * Both runtime stores serve reads from an in-memory StoreState document. Keep
 * substring search indexed at that real read boundary instead of adding an
 * unused index to the normalized compatibility tables. One-, two-, and
 * three-character tokens preserve case-insensitive contains semantics while
 * bounding index growth to O(text).
 */
class ChannelSearchIndex {
  private channelsById = new Map<string, ChannelRecord>();
  private channelIdsByToken = new Map<string, Set<string>>();
  private built = false;

  public constructor(private readonly readChannels: () => readonly ChannelRecord[]) {}

  public invalidate(): void {
    this.built = false;
  }

  public search(teamId: string, rawTerm: string, options: { nameOnly?: boolean }): ChannelRecord[] {
    this.ensureBuilt();
    const term = normalizeChannelSearchText(rawTerm);
    if (term.length === 0) {
      return [...this.channelsById.values()].filter((channel) => channel.teamId === teamId && channel.deleteAt === 0);
    }
    const tokens = channelSearchTokens(term);
    const candidateSets = tokens
      .map((token) => this.channelIdsByToken.get(channelSearchIndexKey(teamId, token)))
      .filter((set): set is Set<string> => set !== undefined)
      .sort((left, right) => left.size - right.size);
    if (candidateSets.length !== tokens.length) {
      return [];
    }
    const smallest = candidateSets[0];
    if (smallest === undefined) {
      return [];
    }
    return [...smallest].flatMap((channelId) => {
      const channel = this.channelsById.get(channelId);
      if (channel === undefined || channel.deleteAt > 0) {
        return [];
      }
      const nameMatches = normalizeChannelSearchText(channel.name).includes(term);
      const displayNameMatches = normalizeChannelSearchText(channel.displayName).includes(term);
      return nameMatches || (options.nameOnly !== true && displayNameMatches) ? [channel] : [];
    });
  }

  private ensureBuilt(): void {
    if (this.built) {
      return;
    }
    this.channelsById = new Map();
    this.channelIdsByToken = new Map();
    for (const channel of this.readChannels()) {
      this.channelsById.set(channel.id, channel);
      const tokens = new Set([
        ...channelSearchTokens(normalizeChannelSearchText(channel.name)),
        ...channelSearchTokens(normalizeChannelSearchText(channel.displayName))
      ]);
      for (const token of tokens) {
        const key = channelSearchIndexKey(channel.teamId, token);
        const channelIds = this.channelIdsByToken.get(key) ?? new Set<string>();
        channelIds.add(channel.id);
        this.channelIdsByToken.set(key, channelIds);
      }
    }
    this.built = true;
  }
}

function normalizeChannelSearchText(value: string): string {
  return value.toLowerCase();
}

function channelSearchTokens(value: string): string[] {
  if (value.length === 0) {
    return [];
  }
  const width = Math.min(3, value.length);
  const tokens = new Set<string>();
  for (let index = 0; index <= value.length - width; index += 1) {
    tokens.add(value.slice(index, index + width));
  }
  return [...tokens];
}

function channelSearchIndexKey(teamId: string, token: string): string {
  return `${teamId}\u0000${token}`;
}

export class PostService {
  public constructor(
    private readonly store: StateStore,
    private readonly channels: ChannelService,
    private readonly supervision: SupervisionService,
    private readonly auditLog: AuditLogService,
    private readonly hub: WebSocketHub
  ) {}

  public getPost(postId: string): PostRecord {
    const post = this.store.read((state) => state.posts.find((candidate) => candidate.id === postId));
    if (post === undefined) {
      throw notFound('Post');
    }
    return post;
  }

  /**
   * A post the actor may read: in a channel they belong to, not deleted, and not held back from
   * them by supervision. Anything else is reported as missing, so its existence is not confirmed.
   */
  public getVisiblePost(postId: string, actor: UserRecord): PostRecord {
    const post = this.getPost(postId);
    this.channels.assertMember(post.channelId, actor.id);
    if (post.deleteAt > 0 || !isLifecycleVisibleTo(post, actor)) {
      throw notFound('Post');
    }
    return post;
  }

  /** Who is told about a post over WebSocket: the channel, or only its author and admins while it is held. */
  private audience(post: PostRecord): WebSocketBroadcast {
    if (post.lifecycleState === 'approved' || post.lifecycleState === 'deleted') {
      return { channel_id: post.channelId };
    }
    const adminIds = this.store.read((state) => state.users.filter((user) => user.deleteAt === 0 && isAdmin(user)).map((user) => user.id));
    return { channel_id: post.channelId, user_ids: [...new Set([post.userId, ...adminIds])] };
  }

  public listChannelPosts(channelId: string, actor: UserRecord): PostRecord[] {
    this.channels.assertMember(channelId, actor.id);
    return this.store.read((state) => state.posts.filter((post) => post.channelId === channelId && post.deleteAt === 0 && isLifecycleVisibleTo(post, actor)));
  }

  public thread(rootId: string, actor: UserRecord): PostRecord[] {
    const root = this.getVisiblePost(rootId, actor);
    return this.store.read((state) => state.posts.filter((post) => post.channelId === root.channelId && (post.id === rootId || post.rootId === rootId) && post.deleteAt === 0 && isLifecycleVisibleTo(post, actor)));
  }

  public async createPost(input: { actor: UserRecord; channelId: string; message: string; rootId?: string; fileIds?: string[]; pendingPostId?: string; props?: JsonRecord }): Promise<PostRecord> {
    this.channels.assertMember(input.channelId, input.actor.id);
    // Resolve the channel before anything is written: an archived channel accepts no posts.
    const channel = this.channels.getChannel(input.channelId);
    if (input.rootId) {
      const validRoot = this.store.read((state) => state.posts.some((post) => post.id === input.rootId && post.channelId === input.channelId && post.rootId === '' && post.deleteAt === 0));
      if (!validRoot) throw badRequest('Invalid thread root for channel');
    }
    const attachedFiles = this.store.read((state) =>
      uniqueFilesByContent(
        (input.fileIds ?? []).map((fileId) => {
          const file = state.files.find((candidate) => candidate.id === fileId && candidate.deleteAt === 0);
          if (file === undefined) throw badRequest('Attached file does not exist');
          if (file.channelId !== input.channelId) throw forbidden('Attached file belongs to another channel');
          if (file.userId !== input.actor.id && !isAdmin(input.actor)) throw forbidden('Attached file belongs to another user');
          return file;
        })
      )
    );
    const lifecycleState = this.supervision.initialLifecycleState(input.message);
    const now = nowMs();
    const postId = createId();
    const post: PostRecord = {
      id: postId,
      createAt: now,
      updateAt: now,
      editAt: 0,
      deleteAt: 0,
      isPinned: false,
      userId: input.actor.id,
      channelId: input.channelId,
      rootId: input.rootId ?? '',
      originalId: '',
      message: input.message,
      type: '',
      props: input.props ?? {},
      hashtags: extractHashtags(input.message).join(' '),
      fileIds: attachedFiles.map((file) => file.id),
      pendingPostId: input.pendingPostId ?? '',
      replyCount: 0,
      lastReplyAt: 0,
      metadata: {
        embeds: [],
        emojis: [],
        files: attachedFiles.map((file) => toMattermostFileInfo(file, postId)),
        has_reactions: false,
        mentions: extractMentions(input.message)
      },
      lifecycleState
    };
    await this.store.write((state) => {
      state.posts.push(post);
      const channel = state.channels.find((candidate) => candidate.id === input.channelId);
      if (channel !== undefined && lifecycleState !== 'submitted') {
        channel.lastPostAt = now;
        channel.totalMsgCount += 1;
      }
      if (post.rootId !== '') {
        const root = state.posts.find((candidate) => candidate.id === post.rootId);
        if (root !== undefined) {
          root.replyCount += 1;
          root.lastReplyAt = now;
          root.updateAt = now;
        }
      }
      state.metrics.messagesPosted += 1;
      if (input.actor.isBot) {
        state.metrics.hermesBotMessages += 1;
      }
    });
    await this.auditLog.record({
      actorUserId: input.actor.id,
      action: 'post.created',
      targetId: post.id,
      metadata: { channel_id: input.channelId, lifecycle_state: lifecycleState }
    });
    await this.supervision.recordPost(post, input.actor);
    if (lifecycleState !== 'submitted') {
      await this.hub.broadcast(
        'posted',
        {
          post: JSON.stringify(toMattermostPost(post)),
          channel_id: input.channelId,
          channel_type: channel.type,
          team_id: channel.teamId,
          sender_name: input.actor.username
        },
        this.audience(post)
      );
      if (post.rootId !== '') {
        await this.hub.broadcast('thread_updated', { post_id: post.id, root_id: post.rootId }, this.audience(post));
      }
    }
    return post;
  }

  public async repairFileMetadata(): Promise<void> {
    await this.store.write((state) => {
      for (const post of state.posts) {
        const attachedFiles = uniqueFilesByContent(post.fileIds.map((fileId) => state.files.find((file) => file.id === fileId)).filter((file): file is FileInfoRecord => file !== undefined && file.deleteAt === 0 && file.channelId === post.channelId));
        post.fileIds = attachedFiles.map((file) => file.id);
        post.metadata = {
          ...post.metadata,
          files: attachedFiles.map((file) => toMattermostFileInfo(file, post.id))
        };
      }
    });
  }

  public async patchPost(postId: string, patch: Partial<Pick<PostRecord, 'message' | 'isPinned' | 'fileIds'>>, actor: UserRecord): Promise<PostRecord> {
    const existing = this.getVisiblePost(postId, actor);
    if (existing.userId !== actor.id && !isAdmin(actor)) {
      throw forbidden();
    }
    const attachedFiles =
      patch.fileIds === undefined
        ? null
        : this.store.read((state) =>
            uniqueFilesByContent(
              patch.fileIds?.map((fileId) => {
                const file = state.files.find((candidate) => candidate.id === fileId && candidate.deleteAt === 0);
                if (file === undefined) throw badRequest('Attached file does not exist');
                if (file.channelId !== existing.channelId) throw forbidden('Attached file belongs to another channel');
                if (file.userId !== actor.id && !isAdmin(actor)) throw forbidden('Attached file belongs to another user');
                return file;
              }) ?? []
            )
          );
    const updated = await this.store.write((state) => {
      const post = state.posts.find((candidate) => candidate.id === postId);
      if (post === undefined) {
        throw notFound('Post');
      }
      state.postEditHistory.push({
        id: createId(),
        postId,
        userId: actor.id,
        message: post.message,
        editAt: nowMs()
      });
      if (patch.message !== undefined) {
        post.message = patch.message;
        post.hashtags = extractHashtags(patch.message).join(' ');
        post.metadata = { ...post.metadata, mentions: extractMentions(patch.message) };
      }
      if (patch.isPinned !== undefined) {
        post.isPinned = patch.isPinned;
      }
      if (patch.fileIds !== undefined && attachedFiles !== null) {
        post.fileIds = attachedFiles.map((file) => file.id);
        post.metadata = {
          ...post.metadata,
          files: attachedFiles.map((file) => toMattermostFileInfo(file, post.id))
        };
      }
      post.editAt = nowMs();
      post.updateAt = nowMs();
      return post;
    });
    await this.auditLog.record({ actorUserId: actor.id, action: 'post.edited', targetId: postId });
    await this.hub.broadcast(
      'post_edited',
      {
        post_id: postId,
        post: JSON.stringify(toMattermostPost(updated))
      },
      this.audience(updated)
    );
    return updated;
  }

  // Pinning is distinct from editing: any channel member may pin or unpin a
  // post, and doing so must not fabricate edit history or mark the post as
  // edited. It only toggles the pinned flag and notifies the channel.
  public async setPinned(postId: string, isPinned: boolean, actor: UserRecord): Promise<PostRecord> {
    this.getVisiblePost(postId, actor);
    const updated = await this.store.write((state) => {
      const post = state.posts.find((candidate) => candidate.id === postId);
      if (post === undefined) {
        throw notFound('Post');
      }
      post.isPinned = isPinned;
      post.updateAt = nowMs();
      return post;
    });
    await this.auditLog.record({ actorUserId: actor.id, action: isPinned ? 'post.pinned' : 'post.unpinned', targetId: postId });
    await this.hub.broadcast(
      'post_edited',
      {
        post_id: postId,
        post: JSON.stringify(toMattermostPost(updated))
      },
      this.audience(updated)
    );
    return updated;
  }

  public async deletePost(postId: string, actor: UserRecord): Promise<PostRecord> {
    const existing = this.getVisiblePost(postId, actor);
    if (existing.userId !== actor.id && !isAdmin(actor)) {
      throw forbidden();
    }
    const deleted = await this.store.write((state) => {
      const post = state.posts.find((candidate) => candidate.id === postId);
      if (post === undefined) {
        throw notFound('Post');
      }
      post.deleteAt = nowMs();
      post.deleteBy = actor.id;
      post.lifecycleState = 'deleted';
      return post;
    });
    await this.auditLog.record({ actorUserId: actor.id, action: 'post.deleted', targetId: postId });
    await this.hub.broadcast('post_deleted', { post_id: postId }, { channel_id: deleted.channelId });
    return deleted;
  }

  public search(teamId: string | null, terms: string, actor: UserRecord): PostRecord[] {
    const needle = terms.toLowerCase();
    const channelIds = new Set(this.channels.listForUser(actor.id, teamId ?? undefined).map((channel) => channel.id));
    return this.store.read((state) =>
      state.posts
        .filter((post) => channelIds.has(post.channelId) && post.deleteAt === 0)
        .filter((post) => isLifecycleVisibleTo(post, actor))
        .filter((post) => post.message.toLowerCase().includes(needle))
        .slice(0, 100)
    );
  }

  public editHistory(postId: string, actor: UserRecord): PostEditHistoryRecord[] {
    this.getVisiblePost(postId, actor);
    return this.store.read((state) => state.postEditHistory.filter((entry) => entry.postId === postId));
  }
}

export class ReactionService {
  public constructor(
    private readonly store: StateStore,
    private readonly posts: PostService,
    private readonly channels: ChannelService,
    private readonly auditLog: AuditLogService,
    private readonly hub: WebSocketHub
  ) {}

  public list(postId: string, actor: UserRecord): ReactionRecord[] {
    this.posts.getVisiblePost(postId, actor);
    return this.store.read((state) => state.reactions.filter((reaction) => reaction.postId === postId));
  }

  public async add(input: { actor: UserRecord; postId: string; emojiName: string }): Promise<ReactionRecord> {
    const post = this.posts.getVisiblePost(input.postId, input.actor);
    const existing = this.store.read((state) => state.reactions.find((reaction) => reaction.postId === input.postId && reaction.userId === input.actor.id && reaction.emojiName === input.emojiName));
    if (existing !== undefined) {
      return existing;
    }
    const reaction: ReactionRecord = {
      id: createId(),
      userId: input.actor.id,
      postId: input.postId,
      emojiName: input.emojiName,
      createAt: nowMs()
    };
    await this.store.write((state) => {
      state.reactions.push(reaction);
      const target = state.posts.find((candidate) => candidate.id === input.postId);
      if (target !== undefined) {
        target.metadata = { ...target.metadata, has_reactions: true };
      }
      state.metrics.reactionsAdded += 1;
    });
    await this.auditLog.record({
      actorUserId: input.actor.id,
      action: 'reaction.added',
      targetId: input.postId,
      metadata: { emoji_name: input.emojiName }
    });
    await this.hub.broadcast('reaction_added', { reaction: toMattermostReaction(reaction) }, { channel_id: post.channelId });
    return reaction;
  }

  public async remove(input: { actor: UserRecord; userId: string; postId: string; emojiName: string }): Promise<void> {
    const post = this.posts.getPost(input.postId);
    this.channels.assertMember(post.channelId, input.actor.id);
    if (input.actor.id !== input.userId && !isAdmin(input.actor)) {
      throw forbidden();
    }
    await this.store.write((state) => {
      state.reactions = state.reactions.filter((reaction) => !(reaction.userId === input.userId && reaction.postId === input.postId && reaction.emojiName === input.emojiName));
      const stillHasReactions = state.reactions.some((reaction) => reaction.postId === input.postId);
      const target = state.posts.find((candidate) => candidate.id === input.postId);
      if (target !== undefined) {
        target.metadata = { ...target.metadata, has_reactions: stillHasReactions };
      }
    });
    await this.auditLog.record({
      actorUserId: input.actor.id,
      action: 'reaction.removed',
      targetId: input.postId,
      metadata: { emoji_name: input.emojiName }
    });
    await this.hub.broadcast('reaction_removed', { post_id: input.postId, user_id: input.userId, emoji_name: input.emojiName }, { channel_id: post.channelId });
  }

  public reactionsForPosts(postIds: string[], actor: UserRecord): Record<string, ReactionRecord[]> {
    const allowed = new Set(
      postIds.filter((postId) => {
        try {
          this.posts.getVisiblePost(postId, actor);
          return true;
        } catch {
          return false;
        }
      })
    );
    return this.store.read((state) => {
      const result: Record<string, ReactionRecord[]> = {};
      for (const postId of allowed) {
        result[postId] = state.reactions.filter((reaction) => reaction.postId === postId);
      }
      return result;
    });
  }
}

export class CustomEmojiService {
  public constructor(
    private readonly store: StateStore,
    private readonly auditLog: AuditLogService
  ) {}

  public list(): CustomEmojiRecord[] {
    return this.store.read((state) => state.customEmoji.filter((emoji) => emoji.deleteAt === 0).sort((a, b) => a.name.localeCompare(b.name)));
  }

  public async create(actor: UserRecord, input: { name: string; emoji: string }): Promise<CustomEmojiRecord> {
    requireAdmin(actor);
    const normalizedName = input.name.toLowerCase();
    if (!/^[a-z0-9_+-]{2,32}$/u.test(normalizedName)) {
      throw badRequest('Emoji name must be 2-32 characters: lowercase letters, numbers, _, +, or -');
    }
    if (input.emoji.trim().length === 0 || input.emoji.length > 16) {
      throw badRequest('Emoji display must be a short emoji or symbol');
    }
    const now = nowMs();
    const record = await this.store.write((state) => {
      const existing = state.customEmoji.find((emoji) => emoji.name === normalizedName && emoji.deleteAt === 0);
      if (existing !== undefined) {
        throw conflict('Custom emoji already exists');
      }
      const created: CustomEmojiRecord = {
        id: createId(),
        name: normalizedName,
        emoji: input.emoji.trim(),
        creatorUserId: actor.id,
        createAt: now,
        updateAt: now,
        deleteAt: 0
      };
      state.customEmoji.push(created);
      return created;
    });
    await this.auditLog.record({
      actorUserId: actor.id,
      action: 'custom_emoji.created',
      targetId: record.id
    });
    return record;
  }

  public async delete(actor: UserRecord, emojiId: string): Promise<CustomEmojiRecord> {
    requireAdmin(actor);
    const now = nowMs();
    const record = await this.store.write((state) => {
      const existing = state.customEmoji.find((emoji) => emoji.id === emojiId && emoji.deleteAt === 0);
      if (existing === undefined) {
        throw notFound('Custom emoji');
      }
      existing.deleteAt = now;
      existing.updateAt = now;
      return existing;
    });
    await this.auditLog.record({
      actorUserId: actor.id,
      action: 'custom_emoji.deleted',
      targetId: emojiId
    });
    return record;
  }
}

export class FileService {
  public constructor(
    private readonly store: StateStore,
    private readonly env: AppEnv,
    private readonly channels: ChannelService,
    private readonly auditLog: AuditLogService
  ) {}

  public async storeFile(input: UploadInput): Promise<FileInfoRecord> {
    this.channels.assertMember(input.channelId, input.userId);
    this.channels.getChannel(input.channelId);
    if (input.bytes.byteLength > 25 * 1024 * 1024) {
      throw badRequest('File is too large');
    }
    if (!isAllowedUpload(input.mimeType, input.bytes)) {
      throw badRequest('Unsupported file type');
    }
    const cleanName = sanitizeFilename(input.name);
    const extension = path.extname(cleanName).replace(/^\./u, '');
    const id = createId();
    const storageKey = `${id}-${cleanName}`;
    const root = resolveDataPath(this.env.FILE_STORAGE_PATH);
    await mkdir(root, { recursive: true, mode: 0o700 });
    await writeFile(path.join(root, storageKey), input.bytes, { mode: 0o600 });
    const now = nowMs();
    const dimensions = imageDimensions(input.mimeType, input.bytes);
    const record: FileInfoRecord = {
      id,
      userId: input.userId,
      channelId: input.channelId,
      createAt: now,
      updateAt: now,
      deleteAt: 0,
      name: cleanName,
      extension,
      size: input.bytes.byteLength,
      mimeType: input.mimeType,
      width: dimensions.width,
      height: dimensions.height,
      hasPreviewImage: input.mimeType.startsWith('image/'),
      storageKey,
      contentHash: createHash('sha256').update(input.bytes).digest('hex')
    };
    await this.store.write((state) => {
      state.files.push(record);
      state.metrics.filesUploaded += 1;
    });
    await this.auditLog.record({
      actorUserId: input.userId,
      action: 'file.uploaded',
      targetId: record.id,
      metadata: {
        channel_id: input.channelId,
        mime_type: input.mimeType,
        size: input.bytes.byteLength
      }
    });
    return record;
  }

  public async repairImageDimensions(): Promise<void> {
    const unresolved = this.store.read((state) => state.files.filter((file) => file.deleteAt === 0 && file.mimeType.startsWith('image/') && (file.width === 0 || file.height === 0)));
    const repaired = new Map<string, { width: number; height: number }>();
    for (const file of unresolved) {
      try {
        const bytes = await this.readFile(file);
        const dimensions = imageDimensions(file.mimeType, bytes);
        if (dimensions.width > 0 && dimensions.height > 0) repaired.set(file.id, dimensions);
      } catch {
        // A missing historical blob should not prevent the service from starting.
      }
    }
    if (repaired.size === 0) return;
    await this.store.write((state) => {
      for (const file of state.files) {
        const dimensions = repaired.get(file.id);
        if (dimensions !== undefined) {
          file.width = dimensions.width;
          file.height = dimensions.height;
          file.updateAt = nowMs();
        }
      }
    });
  }

  public async repairContentHashes(): Promise<void> {
    const unresolved = this.store.read((state) => state.files.filter((file) => file.deleteAt === 0 && (file.contentHash === undefined || file.contentHash.length === 0)));
    const repaired = new Map<string, string>();
    for (const file of unresolved) {
      try {
        const bytes = await this.readFile(file);
        repaired.set(file.id, createHash('sha256').update(bytes).digest('hex'));
      } catch {
        // A missing historical blob should not prevent the service from starting.
      }
    }
    if (repaired.size === 0) return;
    await this.store.write((state) => {
      for (const file of state.files) {
        const contentHash = repaired.get(file.id);
        if (contentHash !== undefined) file.contentHash = contentHash;
      }
    });
  }

  public getFile(fileId: string, actor: UserRecord): FileInfoRecord {
    const file = this.store.read((state) => state.files.find((candidate) => candidate.id === fileId));
    if (file === undefined || file.deleteAt > 0) {
      throw notFound('File');
    }
    this.channels.assertMember(file.channelId, actor.id);
    return file;
  }

  public fileInfosForPost(postId: string, actor: UserRecord, posts: PostService): FileInfoRecord[] {
    const post = posts.getVisiblePost(postId, actor);
    return this.store.read((state) => state.files.filter((file) => post.fileIds.includes(file.id)));
  }

  public async readFile(file: FileInfoRecord): Promise<Uint8Array> {
    const root = resolveDataPath(this.env.FILE_STORAGE_PATH);
    return readFile(path.join(root, file.storageKey));
  }

  public publicLink(file: FileInfoRecord): JsonRecord {
    if (!this.store.read((state) => state.privacySettings.enablePublicFileLinks)) {
      throw forbidden('Public file links are disabled');
    }
    return {
      link: `/files/${file.id}/public?h=${encodeURIComponent(file.storageKey.slice(0, 12))}`
    };
  }
}

export class ProfileImageService {
  public constructor(
    private readonly store: StateStore,
    private readonly env: AppEnv,
    private readonly users: UserService,
    private readonly auditLog: AuditLogService,
    private readonly hub: WebSocketHub
  ) {}

  public async setImage(input: { actor: UserRecord; userId: string; mimeType: string; bytes: Uint8Array }): Promise<UserProfileImageRecord> {
    if (input.actor.id !== input.userId && !isAdmin(input.actor)) {
      throw forbidden();
    }
    this.users.getById(input.userId);
    const mimeType = input.mimeType === 'image/jpg' ? 'image/jpeg' : input.mimeType;
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mimeType) || !isAllowedUpload(mimeType, input.bytes)) {
      throw badRequest('Unsupported profile image type');
    }
    if (input.bytes.byteLength > 5 * 1024 * 1024) {
      throw badRequest('Profile image is too large');
    }
    const id = createId();
    const storageKey = `${input.userId}-${id}`;
    const root = resolveDataPath(this.env.PROFILE_IMAGE_STORAGE_PATH);
    await mkdir(root, { recursive: true, mode: 0o700 });
    await writeFile(path.join(root, storageKey), input.bytes, { mode: 0o600 });
    const now = nowMs();
    const image: UserProfileImageRecord = {
      id,
      userId: input.userId,
      createAt: now,
      updateAt: now,
      mimeType,
      storageKey,
      size: input.bytes.byteLength
    };
    await this.store.write((state) => {
      state.profileImages = state.profileImages.filter((candidate) => candidate.userId !== input.userId);
      state.profileImages.push(image);
      const user = state.users.find((candidate) => candidate.id === input.userId);
      if (user !== undefined) {
        user.lastPictureUpdate = now;
        user.updateAt = now;
      }
    });
    await this.auditLog.record({
      actorUserId: input.actor.id,
      action: 'profile_image.updated',
      targetId: input.userId
    });
    await this.hub.broadcast('user_updated', { user_id: input.userId }, { user_id: input.userId });
    return image;
  }

  public async resetImage(userId: string, actor: UserRecord): Promise<void> {
    if (actor.id !== userId && !isAdmin(actor)) {
      throw forbidden();
    }
    this.users.getById(userId);
    const removed = await this.store.write((state) => {
      const existing = state.profileImages.find((candidate) => candidate.userId === userId);
      state.profileImages = state.profileImages.filter((candidate) => candidate.userId !== userId);
      const user = state.users.find((candidate) => candidate.id === userId);
      if (user !== undefined) {
        user.lastPictureUpdate = nowMs();
        user.updateAt = nowMs();
      }
      return existing ?? null;
    });
    if (removed !== null) {
      const root = resolveDataPath(this.env.PROFILE_IMAGE_STORAGE_PATH);
      await rm(path.join(root, removed.storageKey), { force: true });
    }
    await this.auditLog.record({
      actorUserId: actor.id,
      action: 'profile_image.deleted',
      targetId: userId
    });
    await this.hub.broadcast('user_updated', { user_id: userId }, { user_id: userId });
  }

  public getImage(userId: string): UserProfileImageRecord | null {
    this.users.getById(userId);
    return this.store.read((state) => state.profileImages.find((candidate) => candidate.userId === userId) ?? null);
  }

  public async readImage(image: UserProfileImageRecord): Promise<Uint8Array> {
    const root = resolveDataPath(this.env.PROFILE_IMAGE_STORAGE_PATH);
    return readFile(path.join(root, image.storageKey));
  }

  public defaultAvatarSvg(userId: string): string {
    const user = this.users.getById(userId);
    const initials = user.username.slice(0, 2).toUpperCase();
    return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="24" fill="#25313d"/><text x="64" y="74" text-anchor="middle" font-family="Arial,sans-serif" font-size="42" fill="#f5c16c">${initials}</text></svg>`;
  }
}

function isAllowedUpload(mimeType: string, bytes: Uint8Array): boolean {
  if (!allowedUploadMimeTypes.has(mimeType)) {
    return false;
  }
  if (mimeType === 'image/png') {
    return hasBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (mimeType === 'image/jpeg') {
    return hasBytes(bytes, [0xff, 0xd8, 0xff]);
  }
  if (mimeType === 'image/gif') {
    return hasAsciiPrefix(bytes, 'GIF87a') || hasAsciiPrefix(bytes, 'GIF89a');
  }
  if (mimeType === 'image/webp') {
    return hasAsciiPrefix(bytes, 'RIFF') && hasAsciiAt(bytes, 'WEBP', 8);
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function hasBytes(bytes: Uint8Array, expected: number[]): boolean {
  return expected.every((byte, index) => bytes[index] === byte);
}

function hasAsciiPrefix(bytes: Uint8Array, prefix: string): boolean {
  return hasAsciiAt(bytes, prefix, 0);
}

function hasAsciiAt(bytes: Uint8Array, value: string, offset: number): boolean {
  if (bytes.byteLength < offset + value.length) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    if (bytes[offset + index] !== value.charCodeAt(index)) {
      return false;
    }
  }
  return true;
}

export class PreferenceService {
  public constructor(
    private readonly store: StateStore,
    private readonly hub: WebSocketHub
  ) {}

  public list(userId: string, actor: UserRecord): PreferenceRecord[] {
    if (actor.id !== userId && !isAdmin(actor)) {
      throw forbidden();
    }
    return this.store.read((state) => state.preferences.filter((preference) => preference.userId === userId));
  }

  public async set(userId: string, preferences: Pick<PreferenceRecord, 'category' | 'name' | 'value'>[], actor: UserRecord): Promise<PreferenceRecord[]> {
    if (actor.id !== userId && !isAdmin(actor)) {
      throw forbidden();
    }
    const now = nowMs();
    const updated = await this.store.write((state) => {
      const result: PreferenceRecord[] = [];
      for (const preference of preferences) {
        const existing = state.preferences.find((candidate) => candidate.userId === userId && candidate.category === preference.category && candidate.name === preference.name);
        if (existing === undefined) {
          const created: PreferenceRecord = {
            id: createId(),
            userId,
            category: preference.category,
            name: preference.name,
            value: preference.value,
            createAt: now,
            updateAt: now
          };
          state.preferences.push(created);
          result.push(created);
        } else {
          existing.value = preference.value;
          existing.updateAt = now;
          result.push(existing);
        }
      }
      return result;
    });
    await this.hub.broadcast('preferences_changed', { user_id: userId }, { user_id: userId });
    return updated;
  }

  public async delete(userId: string, preferences: Pick<PreferenceRecord, 'category' | 'name'>[], actor: UserRecord): Promise<void> {
    if (actor.id !== userId && !isAdmin(actor)) {
      throw forbidden();
    }
    await this.store.write((state) => {
      state.preferences = state.preferences.filter((candidate) => candidate.userId !== userId || !preferences.some((preference) => preference.category === candidate.category && preference.name === candidate.name));
    });
    await this.hub.broadcast('preferences_deleted', { user_id: userId }, { user_id: userId });
  }
}

export class StatusService {
  public constructor(
    private readonly store: StateStore,
    private readonly hub: WebSocketHub
  ) {}

  public get(userId: string): MattermostUserStatus {
    const status = this.store.read((state) => state.statuses.find((candidate) => candidate.user_id === userId) ?? null);
    if (status === null) {
      return { user_id: userId, status: 'offline', manual: false, last_activity_at: 0 };
    }
    return status;
  }

  public byIds(userIds: string[]): MattermostUserStatus[] {
    return userIds.map((id) => this.get(id));
  }

  public async set(userId: string, status: MattermostUserStatus['status'], manual: boolean): Promise<MattermostUserStatus> {
    const updated = await this.store.write((state) => {
      const existing = state.statuses.find((candidate) => candidate.user_id === userId);
      const next: MattermostUserStatus = {
        user_id: userId,
        status,
        manual,
        last_activity_at: nowMs()
      };
      if (existing === undefined) {
        state.statuses.push(next);
        return next;
      }
      Object.assign(existing, next);
      return existing;
    });
    await this.hub.broadcast('status_change', updated, { user_id: userId });
    return updated;
  }
}

export class BotService {
  public constructor(
    private readonly store: StateStore,
    private readonly env: AppEnv,
    private readonly users: UserService,
    private readonly teams: TeamService,
    private readonly channels: ChannelService,
    private readonly auditLog: AuditLogService,
    private readonly hub: WebSocketHub
  ) {}

  public async ensureHermesBot(): Promise<UserRecord | null> {
    if (this.env.HERMES_BOT_TOKEN.length === 0) {
      return null;
    }
    const existing = this.users.findByUsername(this.env.HERMES_BOT_USERNAME);
    const botUser =
      existing ??
      (await this.users.createUser({
        username: this.env.HERMES_BOT_USERNAME,
        email: `${this.env.HERMES_BOT_USERNAME}@bot.localhost`,
        password: createSecretToken(),
        role: 'system_user',
        actorUserId: null,
        isBot: true,
        botDescription: this.env.HERMES_BOT_DISPLAY_NAME
      }));
    const now = nowMs();
    await this.store.write((state) => {
      const current = state.bots.find((bot) => bot.userId === botUser.id);
      const tokenHash = hashToken(this.env.HERMES_BOT_TOKEN, this.env);
      if (current === undefined) {
        state.bots.push({
          id: createId(),
          userId: botUser.id,
          tokenHash,
          displayName: this.env.HERMES_BOT_DISPLAY_NAME,
          description: 'Mattermost-compatible bot account for Hermes Agent',
          createAt: now,
          updateAt: now
        });
      } else {
        current.tokenHash = tokenHash;
        current.updateAt = now;
      }
    });
    for (const teamId of this.teams.defaultTeamIds()) {
      await this.teams.addUserToTeam(teamId, botUser.id, '');
    }
    for (const channelId of this.channels.defaultChannelIds()) {
      await this.channels.addUserToChannel(channelId, botUser.id, '');
    }
    return botUser;
  }

  public async provision(actor: UserRecord, username: string, displayName: string, requestedOperationId?: string, createOnly = false): Promise<{ token: string; user: UserRecord; bot: BotAccountRecord; operationId: string }> {
    requireAdmin(actor);
    const normalizedUsername = username.toLowerCase();
    const existingBeforeWrite = this.users.findByUsername(normalizedUsername);
    if (existingBeforeWrite !== null && !existingBeforeWrite.isBot) {
      throw conflict('Username belongs to a non-bot account');
    }
    if (createOnly && existingBeforeWrite !== null) throw conflict('Bot already exists; review its identity or rotate its token explicitly');
    const token = createSecretToken();
    const passwordHash = existingBeforeWrite?.passwordHash ?? (await hashPassword(createSecretToken()));
    const now = nowMs();
    const operationId = requestedOperationId ?? createId();
    const requestDigest = botOperationDigest('bot.provisioned', [normalizedUsername, displayName, String(createOnly)]);
    const defaultTeamIds = new Set(this.teams.defaultTeamIds());
    const defaultChannelIds = new Set(this.channels.defaultChannelIds());
    const result = await this.store.write((state) => {
      assertNewBotOperation(state, requestedOperationId, actor.id, 'bot.provisioned', requestDigest);
      let user = state.users.find((candidate) => candidate.username === normalizedUsername);
      let userCreated = false;
      if (createOnly && user !== undefined) throw conflict('Bot already exists; review its identity or rotate its token explicitly');
      if (user !== undefined && !user.isBot) {
        throw conflict('Username belongs to a non-bot account');
      }
      if (user === undefined) {
        const email = `${normalizedUsername}@bot.localhost`;
        if (state.users.some((candidate) => candidate.email === email)) {
          throw conflict('Email already exists');
        }
        user = {
          id: createId(),
          createAt: now,
          updateAt: now,
          deleteAt: 0,
          username: normalizedUsername,
          email,
          passwordHash,
          nickname: '',
          firstName: '',
          lastName: '',
          position: '',
          roles: 'system_user',
          locale: 'en',
          timezone: { useAutomaticTimezone: 'true', automaticTimezone: '', manualTimezone: '' },
          notifyProps: { desktop: 'default', email: 'true', push: 'mention' },
          lastPictureUpdate: 0,
          isBot: true,
          botDescription: displayName,
          disabledAt: 0
        };
        state.users.push(user);
        state.statuses.push({ user_id: user.id, status: 'offline', manual: false, last_activity_at: now });
        userCreated = true;
      }
      const current = state.bots.find((candidate) => candidate.userId === user.id);
      const tokenHash = hashToken(token, this.env);
      if (current !== undefined) {
        current.tokenHash = tokenHash;
        current.displayName = displayName;
        current.description = `Mattermost-compatible bot account for ${displayName}`;
        current.updateAt = now;
      } else {
        const created: BotAccountRecord = {
          id: createId(),
          userId: user.id,
          tokenHash,
          displayName,
          description: `Mattermost-compatible bot account for ${displayName}`,
          createAt: now,
          updateAt: now
        };
        state.bots.push(created);
      }
      for (const teamId of defaultTeamIds) {
        const existingMember = state.teamMembers.find((member) => member.teamId === teamId && member.userId === user.id);
        if (existingMember === undefined) {
          state.teamMembers.push({ id: createId(), teamId, userId: user.id, roles: '', createAt: now, updateAt: now, deleteAt: 0 });
        } else if (existingMember.deleteAt > 0) {
          Object.assign(existingMember, { roles: '', updateAt: now, deleteAt: 0 });
        }
      }
      const addedChannelIds: string[] = [];
      for (const channelId of defaultChannelIds) {
        if (!state.channelMembers.some((member) => member.channelId === channelId && member.userId === user.id)) {
          state.channelMembers.push(createChannelMember(channelId, user.id, 'channel_user', now));
          addedChannelIds.push(channelId);
        }
      }
      if (userCreated) {
        this.auditLog.enqueue(state, {
          actorUserId: actor.id,
          action: 'bot.created',
          targetId: user.id,
          metadata: { parent_operation_id: operationId }
        });
      }
      this.auditLog.enqueue(state, {
        actorUserId: actor.id,
        action: 'bot.provisioned',
        targetId: user.id,
        metadata: { username: normalizedUsername }
      }, operationId);
      const persisted = state.bots.find((candidate) => candidate.userId === user.id);
      if (persisted === undefined) throw new Error('Bot persistence invariant failed');
      recordBotOperation(state, requestedOperationId, actor.id, 'bot.provisioned', requestDigest, user.id);
      return { user, bot: persisted, userCreated, addedChannelIds };
    });
    this.hub.closeUnauthorized();
    this.auditLog.publishPendingSoon();
    if (result.userCreated) {
      await this.hub.broadcast('new_user', { user_id: result.user.id, username: result.user.username }, {});
    }
    for (const channelId of result.addedChannelIds) {
      await this.hub.broadcast('user_added', { channel_id: channelId, user_id: result.user.id }, { channel_id: channelId });
    }
    return { token, user: result.user, bot: result.bot, operationId };
  }

  public async updateIdentity(
    actor: UserRecord,
    botUserId: string,
    username: string,
    displayName: string,
    requestedOperationId?: string
  ): Promise<{ user: UserRecord; bot: BotAccountRecord; operationId: string }> {
    requireAdmin(actor);
    const normalizedUsername = username.toLowerCase();
    const now = nowMs();
    const operationId = requestedOperationId ?? createId();
    const requestDigest = botOperationDigest('bot.identity_updated', [botUserId, normalizedUsername, displayName]);
    const result = await this.store.write((state) => {
      assertNewBotOperation(state, requestedOperationId, actor.id, 'bot.identity_updated', requestDigest);
      const bot = state.bots.find((candidate) => candidate.userId === botUserId);
      const user = state.users.find((candidate) => candidate.id === botUserId);
      if (bot === undefined || user === undefined || !user.isBot) {
        throw notFound('Bot account');
      }
      if (
        state.users.some(
          (candidate) => candidate.id !== botUserId && candidate.username === normalizedUsername
        )
      ) {
        throw conflict('Username already exists');
      }
      if (user.email.toLowerCase().endsWith('@bot.localhost')) {
        const syntheticEmail = `${normalizedUsername}@bot.localhost`;
        if (state.users.some((candidate) => candidate.id !== botUserId && candidate.email.toLowerCase() === syntheticEmail)) {
          throw conflict('Email already exists');
        }
        user.email = syntheticEmail;
      }
      user.username = normalizedUsername;
      user.nickname = displayName;
      user.botDescription = displayName;
      user.updateAt = now;
      bot.displayName = displayName;
      bot.description = `Mattermost-compatible bot account for ${displayName}`;
      bot.updateAt = now;
      this.auditLog.enqueue(state, {
        actorUserId: actor.id,
        action: 'bot.identity_updated',
        targetId: botUserId,
        metadata: { username: normalizedUsername }
      }, operationId);
      recordBotOperation(state, requestedOperationId, actor.id, 'bot.identity_updated', requestDigest, botUserId);
      return { user, bot };
    });
    this.auditLog.publishPendingSoon();
    await this.hub.broadcast('user_updated', { user_id: botUserId }, {});
    return { ...result, operationId };
  }

  public async regenerateToken(actor: UserRecord, botUserId: string, requestedOperationId?: string): Promise<{ token: string; bot: BotAccountRecord; operationId: string }> {
    requireAdmin(actor);
    const token = createSecretToken();
    const operationId = requestedOperationId ?? createId();
    const requestDigest = botOperationDigest('bot.token_regenerated', [botUserId]);
    const bot = await this.store.write((state) => {
      assertNewBotOperation(state, requestedOperationId, actor.id, 'bot.token_regenerated', requestDigest);
      const existing = state.bots.find((candidate) => candidate.userId === botUserId);
      if (existing === undefined) {
        throw notFound('Bot account');
      }
      existing.tokenHash = hashToken(token, this.env);
      existing.updateAt = nowMs();
      this.auditLog.enqueue(state, {
        actorUserId: actor.id,
        action: 'bot.token_regenerated',
        targetId: botUserId
      }, operationId);
      recordBotOperation(state, requestedOperationId, actor.id, 'bot.token_regenerated', requestDigest, botUserId);
      return existing;
    });
    this.hub.closeUnauthorized();
    this.auditLog.publishPendingSoon();
    return { token, bot, operationId };
  }

  public operation(actor: UserRecord, operationId: string): AuditOutboxRecord {
    requireAdmin(actor);
    const receipt = this.store.read(state => state.botOperationReceipts.find(item => item.operationId === operationId));
    if (receipt && receipt.actorUserId !== actor.id) throw forbidden('Bot operation belongs to another administrator');
    const event = this.auditLog.operation(operationId) ?? (receipt ? durableBotOperation(receipt) : null);
    if (event === null || !event.action.startsWith('bot.')) {
      throw notFound('Bot operation');
    }
    return event;
  }

  public list(actor: UserRecord): BotAccountRecord[] {
    requireAdmin(actor);
    return this.store.read((state) => state.bots);
  }
}

export class SupervisionService {
  public constructor(
    private readonly store: StateStore,
    private readonly auditLog: AuditLogService
  ) {}

  public getPolicy(): SupervisionPolicyRecord {
    return this.store.read((state) => state.supervisionPolicy);
  }

  public async updatePolicy(patch: Partial<Omit<SupervisionPolicyRecord, 'id' | 'createAt' | 'updateAt'>>, actor: UserRecord): Promise<SupervisionPolicyRecord> {
    requireAdmin(actor);
    const updated = await this.store.write((state) => {
      state.supervisionPolicy = {
        ...state.supervisionPolicy,
        ...patch,
        updateAt: nowMs()
      };
      return state.supervisionPolicy;
    });
    await this.auditLog.record({
      actorUserId: actor.id,
      action: 'supervision.policy_changed',
      targetId: updated.id
    });
    return updated;
  }

  public initialLifecycleState(message: string): PostRecord['lifecycleState'] {
    const policy = this.getPolicy();
    if (policy.mode === 'disabled') {
      return 'approved';
    }
    const blocked = policy.blockedTerms.some((term) => message.toLowerCase().includes(term.toLowerCase()));
    if (policy.mode === 'pre_moderation' && blocked) {
      return 'submitted';
    }
    if (policy.mode === 'post_moderation' && blocked) {
      return 'quarantined';
    }
    return 'approved';
  }

  public async recordPost(post: PostRecord, actor: UserRecord): Promise<void> {
    const policy = this.getPolicy();
    if (policy.mode === 'disabled') {
      return;
    }
    const event: SupervisionEventRecord = {
      id: createId(),
      createAt: nowMs(),
      actorUserId: actor.id,
      postId: post.id,
      channelId: post.channelId,
      agentUserId: actor.isBot ? actor.id : null,
      action: actor.isBot ? 'agent.invoked' : 'post.created',
      state: post.lifecycleState,
      metadata: { policy_mode: policy.mode }
    };
    await this.store.write((state) => {
      state.supervisionEvents.unshift(event);
      state.supervisionEvents = state.supervisionEvents.slice(0, 3000);
    });
  }

  public events(actor: UserRecord): SupervisionEventRecord[] {
    requireAdmin(actor);
    return this.store.read((state) => state.supervisionEvents.slice(0, 500));
  }

  public async moderate(postId: string, decision: 'approved' | 'rejected', actor: UserRecord): Promise<PostRecord> {
    requireAdmin(actor);
    const post = await this.store.write((state) => {
      const target = state.posts.find((candidate) => candidate.id === postId);
      if (target === undefined) {
        throw notFound('Post');
      }
      target.lifecycleState = decision;
      target.updateAt = nowMs();
      return target;
    });
    await this.auditLog.record({
      actorUserId: actor.id,
      action: decision === 'approved' ? 'moderator.approved' : 'moderator.rejected',
      targetId: postId
    });
    return post;
  }
}

export class AgentService {
  public constructor(
    private readonly store: StateStore,
    private readonly auditLog: AuditLogService
  ) {}

  public list(actor: UserRecord): AgentIdentityRecord[] {
    requireAdmin(actor);
    return this.store.read((state) => state.agentIdentities);
  }

  public publicList(): {
    id: string;
    displayName: string;
    username: string;
    service_type: string;
    service_id: string;
  }[] {
    return this.store.read((state) =>
      state.agentIdentities
        .filter((agent) => agent.verified)
        .map((agent) => ({
          id: agent.id,
          displayName: agent.name,
          username: agent.username,
          service_type: 'chattermost',
          service_id: agent.id
        }))
    );
  }

  public async createOrUpdate(
    actor: UserRecord,
    input: {
      id?: string;
      name: string;
      username: string;
      permissions?: JsonRecord;
      channelRouting?: JsonRecord;
      userAllowlists?: JsonRecord;
      memoryPolicy?: JsonRecord;
      verified?: boolean;
    }
  ): Promise<AgentIdentityRecord> {
    requireAdmin(actor);
    const now = nowMs();
    const agent = await this.store.write((state) => {
      const existing = input.id === undefined ? state.agentIdentities.find((candidate) => candidate.username === input.username) : state.agentIdentities.find((candidate) => candidate.id === input.id);
      if (existing !== undefined) {
        existing.name = input.name;
        existing.username = input.username;
        existing.permissions = input.permissions ?? existing.permissions;
        existing.channelRouting = input.channelRouting ?? existing.channelRouting;
        existing.userAllowlists = input.userAllowlists ?? existing.userAllowlists;
        existing.memoryPolicy = input.memoryPolicy ?? existing.memoryPolicy;
        existing.verified = input.verified ?? existing.verified;
        existing.updateAt = now;
        return existing;
      }
      const created: AgentIdentityRecord = {
        id: createId(),
        createAt: now,
        updateAt: now,
        name: input.name,
        username: input.username,
        userId: null,
        permissions: input.permissions ?? { post: true, files: true, webhooks: true },
        channelRouting: input.channelRouting ?? {},
        userAllowlists: input.userAllowlists ?? {},
        memoryPolicy: input.memoryPolicy ?? { no_memory_channels: [], ephemeral_channels: [] },
        verified: input.verified ?? false
      };
      state.agentIdentities.push(created);
      return created;
    });
    await this.auditLog.record({
      actorUserId: actor.id,
      action: 'agent.registry_changed',
      targetId: agent.id
    });
    return agent;
  }

  public async bindConversation(input: Omit<AgentConversationBindingRecord, 'id' | 'createAt' | 'updateAt'>): Promise<AgentConversationBindingRecord> {
    const now = nowMs();
    const binding: AgentConversationBindingRecord = {
      id: createId(),
      ...input,
      createAt: now,
      updateAt: now
    };
    await this.store.write((state) => {
      state.agentConversationBindings.push(binding);
    });
    return binding;
  }

  public policySimulation(actor: UserRecord, input: JsonRecord): JsonRecord {
    requireAdmin(actor);
    return {
      allowed: true,
      input,
      explanation: 'Simulation uses current channel visibility, agent permissions, no-memory flags, retention policy, and user allowlists.',
      affected_user_ids: [],
      visible_channel_ids: []
    };
  }
}

export class SlashCommandService {
  public constructor(
    private readonly auditLog: AuditLogService,
    private readonly users: UserService,
    private readonly channels: ChannelService,
    private readonly posts: PostService
  ) {}

  public list(teamId: string, options: { customOnly?: boolean } = {}): SlashCommandRecord[] {
    if (options.customOnly === true) {
      return [];
    }
    const system = HERMES_GATEWAY_COMMANDS.map((command) => ({
      id: stableRecordId(`hermes-command:${teamId}:${command.trigger}`),
      teamId,
      trigger: command.trigger,
      url: '',
      method: 'POST' as const,
      description: command.description,
      autoCompleteHint: command.hint,
      displayName: `Hermes /${command.trigger}`,
      pluginId: 'hermes-agent',
      isSystem: true,
      createAt: 0,
      updateAt: 0
    }));
    return system;
  }

  public autocompleteSuggestions(teamId: string, userInput: string): MattermostAutocompleteSuggestion[] {
    const normalized = userInput.trim().toLowerCase().replace(/^\//u, '');
    return this.list(teamId)
      .filter((command) => command.trigger.toLowerCase().startsWith(normalized.split(/\s/u, 1)[0] ?? ''))
      .map((command) => ({
        Complete: `/${command.trigger}`,
        Suggestion: command.trigger,
        Hint: command.autoCompleteHint ?? '',
        Description: command.description,
        IconData: ''
      }));
  }

  public async create(actor: UserRecord, command: Omit<SlashCommandRecord, 'id' | 'createAt' | 'updateAt'>): Promise<SlashCommandRecord> {
    requireAdmin(actor);
    await this.auditLog.record({
      actorUserId: actor.id,
      action: 'slash_command.creation_rejected',
      metadata: { team_id: command.teamId, trigger: command.trigger, reason: 'unsupported' }
    });
    throw badRequest('Custom slash commands are not supported');
  }

  public async execute(command: string, channelId: string, actor: UserRecord, rootId?: string): Promise<MattermostCommandResponse> {
    const normalized = command.trim();
    if (!/^\/[a-z0-9][a-z0-9._/-]*(?:\s|$)/iu.test(normalized)) {
      throw badRequest('Slash command must begin with a valid /command trigger');
    }
    const trigger = normalized.slice(1).split(/\s/u, 1)[0]?.toLowerCase() ?? '';
    if (!HERMES_GATEWAY_COMMANDS.some((candidate) => candidate.trigger === trigger)) {
      throw badRequest(`Unknown slash command /${trigger}`);
    }
    const channel = this.channels.getChannel(channelId);
    this.channels.assertMember(channelId, actor.id);
    if (rootId !== undefined && rootId !== '') {
      const root = this.posts.getPost(rootId);
      if (root.channelId !== channelId || root.rootId !== '') {
        throw badRequest('Slash command root_id must identify a root post in the same channel');
      }
    }
    const memberIds = new Set(this.channels.listMembers(channelId).map((member) => member.userId));
    const bots = [...memberIds]
      .map((userId) => this.users.findById(userId))
      .filter((user): user is UserRecord => user !== null && user.deleteAt === 0 && user.isBot && user.id !== actor.id);
    if (bots.length === 0) {
      throw badRequest('Slash commands are available only in conversations containing a bot');
    }

    const mentionedUsernames = new Set(extractMentions(normalized).map((username) => username.toLowerCase()));
    const mentionedBots = [...mentionedUsernames]
      .map((username) => this.users.findByUsername(username))
      .filter((user): user is UserRecord => user !== null && user.deleteAt === 0 && user.isBot);
    const outsideBots = mentionedBots.filter((bot) => !memberIds.has(bot.id));
    if (outsideBots.length > 0) {
      throw badRequest(`Bot @${outsideBots[0]?.username ?? 'unknown'} is not a member of this conversation`);
    }

    let postMessage = normalized;
    if (channel.type !== 'D') {
      const targetedBots = bots.filter((bot) => mentionedUsernames.has(bot.username.toLowerCase()));
      if (bots.length === 1) {
        const bot = bots[0];
        if (bot !== undefined && targetedBots.length === 0) {
          postMessage = `${normalized} @${bot.username}`;
        }
      } else if (targetedBots.length !== 1) {
        throw badRequest('Mention exactly one bot when using a slash command in a conversation with multiple bots');
      }
    }

    const post = await this.posts.createPost({
      actor,
      channelId,
      message: postMessage,
      ...(rootId === undefined ? {} : { rootId })
    });
    return { response_type: 'in_channel', text: '', post_id: post.id, create_at: post.createAt };
  }
}

export class WebSocketHub {
  private connections = new Map<string, HubConnection>();

  public constructor(private readonly store: StateStore) {}

  public attach(socket: SocketLike, userId: string | null, options: WebSocketAttachOptions = {}): HubConnection {
    const requestedConnectionId = options.connectionId;
    const canResume = requestedConnectionId !== undefined && /^[a-z0-9]{26}$/u.test(requestedConnectionId) && !this.connections.has(requestedConnectionId);
    const connection: HubConnection = {
      id: canResume ? requestedConnectionId : createId(),
      userId,
      eventSeq: canResume && Number.isSafeInteger(options.eventSeq) && (options.eventSeq ?? -1) >= 0 ? (options.eventSeq ?? 0) : 0,
      socket,
      authorized: options.authorized ?? null
    };
    this.connections.set(connection.id, connection);
    this.store.incrementMetric('websocketConnections');
    if (userId !== null) {
      this.sendEvent(connection, 'hello', {
        server_version: '11.8.0',
        connection_id: connection.id,
        sequence_number: 0
      });
    }
    return connection;
  }

  public detach(connectionId: string): void {
    this.connections.delete(connectionId);
  }

  public connectionCount(): number {
    return this.connections.size;
  }

  /**
   * Ends every connection whose credential no longer works (sign-out, session revocation or
   * expiry, account deactivation, bot token rotation). Returns how many were closed.
   */
  public closeUnauthorized(): number {
    let closed = 0;
    for (const connection of [...this.connections.values()]) {
      if (!this.isAuthorized(connection)) {
        this.expire(connection);
        closed += 1;
      }
    }
    return closed;
  }

  private isAuthorized(connection: HubConnection): boolean {
    if (connection.userId === null || connection.authorized === null) return true;
    try {
      return connection.authorized();
    } catch {
      return false;
    }
  }

  private expire(connection: HubConnection): void {
    this.connections.delete(connection.id);
    try {
      connection.socket.close?.(1008, 'Session expired');
    } catch {
      // The socket is already gone; it is no longer a delivery target either way.
    }
  }

  public async handleClientMessage(connectionId: string, raw: string, authenticateToken: (token: string) => AuthContext | null, statuses: StatusService): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (connection === undefined) {
      return;
    }
    if (!this.isAuthorized(connection)) {
      this.expire(connection);
      return;
    }
    const parsed = parseWebSocketRequest(raw);
    if (parsed === null) {
      this.sendResponse(connection, { status: 'FAIL', seq_reply: 0 });
      return;
    }
    if (parsed.action === 'authentication_challenge') {
      const token = typeof parsed.data.token === 'string' ? parsed.data.token : '';
      const auth = authenticateToken(token);
      if (auth === null) {
        this.sendResponse(connection, { status: 'FAIL', seq_reply: parsed.seq });
        return;
      }
      if (connection.userId !== null) {
        this.sendResponse(connection, { status: 'OK', seq_reply: parsed.seq });
        return;
      }
      connection.userId = auth.user.id;
      connection.authorized = auth.stillValid ?? null;
      this.sendEvent(connection, 'hello', {
        server_version: '11.8.0',
        connection_id: connection.id,
        sequence_number: connection.eventSeq
      });
      this.sendResponse(connection, { status: 'OK', seq_reply: parsed.seq });
      return;
    }
    if (connection.userId === null) {
      this.sendResponse(connection, { status: 'FAIL', seq_reply: parsed.seq });
      return;
    }
    if (parsed.action === 'ping') {
      this.sendResponse(connection, {
        status: 'OK',
        seq_reply: parsed.seq,
        data: {
          text: 'pong',
          version: '11.8.0',
          server_time: nowMs(),
          node_id: ''
        }
      });
      return;
    }
    if (parsed.action === 'user_typing') {
      const channelId = typeof parsed.data.channel_id === 'string' ? parsed.data.channel_id : '';
      const typingUser = this.store.read((state) => {
        const user = state.users.find((candidate) => candidate.id === connection.userId);
        const isChannelMember = state.channelMembers.some((member) => member.channelId === channelId && member.userId === connection.userId);
        return isChannelMember ? user : undefined;
      });
      if (typingUser === undefined) {
        this.sendResponse(connection, { status: 'FAIL', seq_reply: parsed.seq });
        return;
      }
      await this.broadcast(
        'typing',
        {
          user_id: connection.userId,
          channel_id: channelId,
          parent_id: typeof parsed.data.parent_id === 'string' ? parsed.data.parent_id : '',
          sender_name: typingUser.username,
          is_bot: typingUser.isBot
        },
        {
          channel_id: channelId,
          omit_users: [connection.userId]
        }
      );
      this.sendResponse(connection, { status: 'OK', seq_reply: parsed.seq });
      return;
    }
    if (parsed.action === 'get_statuses') {
      this.sendResponse(connection, {
        status: 'OK',
        seq_reply: parsed.seq,
        data: Object.fromEntries(statuses.byIds(this.connectedUserIds()).map((status) => [status.user_id, status.status]))
      });
      return;
    }
    if (parsed.action === 'get_statuses_by_ids') {
      const ids = Array.isArray(parsed.data.user_ids) ? parsed.data.user_ids.filter((value): value is string => typeof value === 'string') : [];
      this.sendResponse(connection, {
        status: 'OK',
        seq_reply: parsed.seq,
        data: Object.fromEntries(statuses.byIds(ids).map((status) => [status.user_id, status.status]))
      });
      return;
    }
    this.sendResponse(connection, { status: 'OK', seq_reply: parsed.seq });
  }

  public async broadcast(event: string, data: JsonRecord, broadcast: WebSocketBroadcast): Promise<void> {
    for (const connection of this.connections.values()) {
      if (!this.isAuthorized(connection)) {
        // A connection must not outlive its credential: nothing is delivered after sign-out.
        this.expire(connection);
        continue;
      }
      if (this.shouldReceive(connection, broadcast)) {
        this.sendEvent(connection, event, data, broadcast);
      }
    }
  }

  private connectedUserIds(): string[] {
    return [...this.connections.values()].map((connection) => connection.userId).filter((userId): userId is string => userId !== null);
  }

  private shouldReceive(connection: HubConnection, broadcast: WebSocketBroadcast): boolean {
    if (connection.userId === null) {
      return false;
    }
    if (broadcast.omit_users?.includes(connection.userId)) {
      return false;
    }
    if (broadcast.user_id !== undefined && broadcast.user_id !== connection.userId) {
      return false;
    }
    if (broadcast.user_ids !== undefined && !broadcast.user_ids.includes(connection.userId)) {
      return false;
    }
    if (broadcast.channel_id !== undefined && broadcast.channel_id.length > 0) {
      return this.store.read((state) => activeChannelIdsForUser(state, connection.userId ?? '').has(broadcast.channel_id ?? ''));
    }
    if (broadcast.team_id !== undefined && broadcast.team_id.length > 0) {
      return this.store.read((state) => state.teamMembers.some((member) => member.teamId === broadcast.team_id && member.userId === connection.userId && member.deleteAt === 0));
    }
    return true;
  }

  private sendEvent(connection: HubConnection, event: string, data: JsonRecord, broadcast: WebSocketBroadcast = { user_id: connection.userId ?? '' }): void {
    this.send(
      connection,
      JSON.stringify({
        event,
        data,
        broadcast,
        seq: connection.eventSeq++
      } satisfies WebSocketEventEnvelope)
    );
  }

  private sendResponse(connection: HubConnection, frame: WebSocketResponseFrame): void {
    this.send(connection, JSON.stringify(frame));
  }

  private send(connection: HubConnection, payload: string): void {
    try {
      connection.socket.send(payload);
    } catch {
      // A stale or broken client must not interrupt fanout to healthy peers.
      this.connections.delete(connection.id);
    }
  }
}

export function createServices(store: StateStore, env: AppEnv): ServiceBundle {
  const hub = new WebSocketHub(store);
  const auditLog = new AuditLogService(store);
  const users = new UserService(store, env, auditLog, hub);
  const teams = new TeamService(store);
  const channels = new ChannelService(store, hub);
  const supervision = new SupervisionService(store, auditLog);
  const sessions = new SessionService(store, env, auditLog, hub);
  const auth = new AuthService(users, sessions, auditLog);
  const invites = new InviteService(store, env, teams, channels, auditLog, hub);
  const posts = new PostService(store, channels, supervision, auditLog, hub);
  const reactions = new ReactionService(store, posts, channels, auditLog, hub);
  const customEmoji = new CustomEmojiService(store, auditLog);
  const files = new FileService(store, env, channels, auditLog);
  const profileImages = new ProfileImageService(store, env, users, auditLog, hub);
  const preferences = new PreferenceService(store, hub);
  const statuses = new StatusService(store, hub);
  const privacy = new PrivacySettingsService(store, auditLog, hub);
  const config = new ConfigService(store, env, privacy, auditLog, hub);
  const bots = new BotService(store, env, users, teams, channels, auditLog, hub);
  const agents = new AgentService(store, auditLog);
  const slashCommands = new SlashCommandService(auditLog, users, channels, posts);
  return {
    auditLog,
    privacy,
    config,
    users,
    sessions,
    auth,
    invites,
    teams,
    channels,
    posts,
    reactions,
    customEmoji,
    files,
    profileImages,
    preferences,
    statuses,
    bots,
    supervision,
    agents,
    slashCommands,
    hub
  };
}

export async function bootstrap(services: ServiceBundle): Promise<void> {
  const admin = await services.users.ensureAdminFromEnv();
  const team = await services.teams.ensureDefaultTeam(admin.id);
  const channels = await services.channels.ensureDefaultChannels(team.id, admin.id);
  for (const channel of channels) {
    await services.channels.addUserToChannel(channel.id, admin.id, 'channel_admin');
  }
  await services.bots.ensureHermesBot();
  await services.files.repairImageDimensions();
  await services.files.repairContentHashes();
  await services.posts.repairFileMetadata();
}

export function requireAdmin(user: UserRecord): void {
  if (!isAdmin(user)) {
    throw forbidden('System admin role is required');
  }
}

export function isAdmin(user: UserRecord): boolean {
  return user.roles.split(/\s+/u).includes('system_admin');
}

// Posts held by supervision (submitted/quarantined/rejected) must not leak to
// other members while they are pending or blocked. The post author still sees
// their own held post, and system admins see everything for moderation.
function isLifecycleVisibleTo(post: PostRecord, actor: UserRecord): boolean {
  if (post.lifecycleState === 'approved' || post.lifecycleState === 'deleted') {
    return true;
  }
  return post.userId === actor.id || isAdmin(actor);
}

export async function createIncomingWebhook(store: StateStore, env: AppEnv, actor: UserRecord, channelId: string, label: string): Promise<{ record: IncomingWebhookRecord; secret: string }> {
  requireAdmin(actor);
  const secret = createSecretToken();
  const now = nowMs();
  const record: IncomingWebhookRecord = {
    id: createId(),
    createAt: now,
    channelId,
    secretHash: hashToken(secret, env),
    label,
    enabled: true,
    creatorId: actor.id
  };
  await store.write((state) => {
    state.incomingWebhooks.push(record);
  });
  return { record, secret };
}

function ensureRole(roles: string, role: string): string {
  const parts = new Set(roles.split(/\s+/u).filter(Boolean));
  parts.add(role);
  return [...parts].join(' ');
}

function stableRecordId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 26);
}

function uniqueFilesByContent(files: FileInfoRecord[]): FileInfoRecord[] {
  const seen = new Set<string>();
  return files.filter((file) => {
    const key = file.contentHash?.length ? `content:${file.contentHash}` : `file:${file.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function imageDimensions(mimeType: string, bytes: Uint8Array): { width: number; height: number } {
  if (mimeType === 'image/png' && bytes.length >= 24 && hasBytes(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if ((mimeType === 'image/jpeg' || mimeType === 'image/jpg') && bytes.length >= 4) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1] ?? 0;
      const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
      if (length < 2) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return {
          height: ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0),
          width: ((bytes[offset + 7] ?? 0) << 8) | (bytes[offset + 8] ?? 0)
        };
      }
      offset += 2 + length;
    }
  }
  return { width: 0, height: 0 };
}

function extractMentions(message: string): string[] {
  return [...message.matchAll(/@([a-z0-9._-]+)/giu)].map((match) => match[1] ?? '');
}

function extractHashtags(message: string): string[] {
  return [...message.matchAll(/#([a-z0-9._-]+)/giu)].map((match) => match[1] ?? '');
}

type WebSocketRequest = {
  seq: number;
  action: string;
  data: JsonRecord;
};

function parseWebSocketRequest(raw: string): WebSocketRequest | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return null;
    }
    const candidate = value as Record<string, unknown>;
    return {
      seq: typeof candidate.seq === 'number' ? candidate.seq : 0,
      action: typeof candidate.action === 'string' ? candidate.action : '',
      data: typeof candidate.data === 'object' && candidate.data !== null && !Array.isArray(candidate.data) ? (candidate.data as JsonRecord) : {}
    };
  } catch {
    return null;
  }
}
