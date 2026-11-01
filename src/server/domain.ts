import type {
  JsonRecord,
  MattermostChannelType,
  MattermostUserStatus
} from '../shared/mattermost.js';

export type UserRecord = {
  id: string;
  createAt: number;
  updateAt: number;
  deleteAt: number;
  deleteBy?: string;
  username: string;
  email: string;
  passwordHash: string;
  nickname: string;
  firstName: string;
  lastName: string;
  position: string;
  roles: string;
  locale: string;
  timezone: JsonRecord;
  notifyProps: JsonRecord;
  lastPictureUpdate: number;
  isBot: boolean;
  botDescription: string;
  disabledAt: number;
};

export type UserProfileImageRecord = {
  id: string;
  userId: string;
  createAt: number;
  updateAt: number;
  mimeType: string;
  storageKey: string;
  size: number;
};

export type SessionRecord = {
  id: string;
  tokenHash: string;
  userId: string;
  createAt: number;
  expiresAt: number;
  deviceId: string;
  revokedAt: number;
};

export type PersonalAccessTokenRecord = {
  id: string;
  tokenHash: string;
  userId: string;
  description: string;
  createAt: number;
  updateAt: number;
  deleteAt: number;
};

export type InviteCodeRecord = {
  id: string;
  codeHash: string;
  rawCodePreview: string;
  createdByUserId: string;
  createAt: number;
  updateAt: number;
  maxUses: number;
  uses: number;
  expiresAt: number;
  role: string;
  teamIds: string[];
  channelIds: string[];
  disabledAt: number;
};

export type TeamRecord = {
  id: string;
  createAt: number;
  updateAt: number;
  deleteAt: number;
  deleteBy?: string;
  name: string;
  displayName: string;
  description: string;
  type: 'O' | 'I';
  companyName: string;
  allowedDomains: string;
  inviteId: string;
  allowOpenInvite: boolean;
  schemeId: string | null;
  groupConstrained: boolean;
};

export type TeamMemberRecord = {
  id: string;
  teamId: string;
  userId: string;
  roles: string;
  createAt: number;
  updateAt: number;
  deleteAt: number;
};

export type ChannelRecord = {
  id: string;
  createAt: number;
  updateAt: number;
  deleteAt: number;
  deleteBy?: string;
  teamId: string;
  type: MattermostChannelType;
  displayName: string;
  name: string;
  header: string;
  purpose: string;
  lastPostAt: number;
  totalMsgCount: number;
  extraUpdateAt: number;
  creatorId: string;
  agentPolicy: JsonRecord;
  retentionDays: number | null;
};

export type ChannelMemberRecord = {
  id: string;
  channelId: string;
  userId: string;
  roles: string;
  lastViewedAt: number;
  msgCount: number;
  mentionCount: number;
  notifyProps: JsonRecord;
  lastUpdateAt: number;
  schemeUser: boolean;
  schemeAdmin: boolean;
};

export type PostRecord = {
  id: string;
  createAt: number;
  updateAt: number;
  editAt: number;
  deleteAt: number;
  deleteBy?: string;
  isPinned: boolean;
  userId: string;
  channelId: string;
  rootId: string;
  originalId: string;
  message: string;
  type: string;
  props: JsonRecord;
  hashtags: string;
  fileIds: string[];
  pendingPostId: string;
  replyCount: number;
  lastReplyAt: number;
  metadata: JsonRecord;
  lifecycleState: 'submitted' | 'approved' | 'rejected' | 'quarantined' | 'deleted';
};

export type PostEditHistoryRecord = {
  id: string;
  postId: string;
  userId: string;
  message: string;
  editAt: number;
};

export type ReactionRecord = {
  id: string;
  userId: string;
  postId: string;
  emojiName: string;
  createAt: number;
};

export type CustomEmojiRecord = {
  id: string;
  name: string;
  emoji: string;
  creatorUserId: string;
  createAt: number;
  updateAt: number;
  deleteAt: number;
};

export type FileInfoRecord = {
  id: string;
  userId: string;
  channelId: string;
  createAt: number;
  updateAt: number;
  deleteAt: number;
  name: string;
  extension: string;
  size: number;
  mimeType: string;
  width: number;
  height: number;
  hasPreviewImage: boolean;
  storageKey: string;
  contentHash?: string;
};

export type PreferenceRecord = {
  id: string;
  userId: string;
  category: string;
  name: string;
  value: string;
  createAt: number;
  updateAt: number;
};

export type UserStatusRecord = MattermostUserStatus;

export type BotAccountRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  displayName: string;
  description: string;
  createAt: number;
  updateAt: number;
};

export type SlashCommandRecord = {
  id: string;
  teamId: string;
  trigger: string;
  url: string;
  method: 'GET' | 'POST';
  description: string;
  autoCompleteHint?: string;
  displayName?: string;
  pluginId?: string;
  isSystem?: boolean;
  createAt: number;
  updateAt: number;
};

export type PrivacySettingsRecord = {
  id: string;
  showEmailAddress: boolean;
  showFullName: boolean;
  teammateNameDisplay: 'username' | 'full_name' | 'nickname_full_name';
  enableDiagnostics: boolean;
  enableTelemetry: boolean;
  enableSecurityAlerts: boolean;
  enableAdminNotices: boolean;
  enableUserNotices: boolean;
  enablePublicFileLinks: boolean;
  enableFileAttachments: boolean;
  enableCustomEmoji: boolean;
  enableEmojiPicker: boolean;
  enableBotAccountCreation: boolean;
  enableUserAccessTokens: boolean;
  enablePostSearch: boolean;
  enableFileSearch: boolean;
  updateAt: number;
};

export type AuditLogRecord = {
  id: string;
  exportSequence: number;
  createAt: number;
  actorUserId: string | null;
  action: string;
  targetId: string | null;
  ip: string | null;
  metadata: JsonRecord;
};

export type AuditOutboxRecord = {
  operationId: string;
  createAt: number;
  publishedAt: number;
  actorUserId: string | null;
  action: string;
  targetId: string | null;
  ip: string | null;
  metadata: JsonRecord;
};

export type SupervisionPolicyRecord = {
  id: string;
  mode: 'disabled' | 'audit_only' | 'pre_moderation' | 'post_moderation';
  blockedTerms: string[];
  channelRestrictions: JsonRecord;
  userRestrictions: JsonRecord;
  agentRestrictions: JsonRecord;
  fileRestrictions: JsonRecord;
  createAt: number;
  updateAt: number;
};

export type SupervisionEventRecord = {
  id: string;
  createAt: number;
  actorUserId: string | null;
  postId: string | null;
  channelId: string | null;
  agentUserId: string | null;
  action: string;
  state: string;
  metadata: JsonRecord;
};

export type AgentIdentityRecord = {
  id: string;
  createAt: number;
  updateAt: number;
  name: string;
  username: string;
  userId: string | null;
  permissions: JsonRecord;
  channelRouting: JsonRecord;
  userAllowlists: JsonRecord;
  memoryPolicy: JsonRecord;
  verified: boolean;
};

export type AgentConversationBindingRecord = {
  id: string;
  agentUserId: string;
  channelId: string;
  threadRootId: string;
  humanUserId: string;
  sessionKey: string;
  policy: JsonRecord;
  createAt: number;
  updateAt: number;
};

export type IncomingWebhookRecord = {
  id: string;
  createAt: number;
  channelId: string;
  secretHash: string;
  label: string;
  enabled: boolean;
  creatorId?: string;
};

export type MetricsRecord = {
  httpRequests: number;
  errors: number;
  websocketConnections: number;
  messagesPosted: number;
  reactionsAdded: number;
  filesUploaded: number;
  moderationActions: number;
  hermesBotMessages: number;
};

export type StoreState = {
  users: UserRecord[];
  profileImages: UserProfileImageRecord[];
  sessions: SessionRecord[];
  personalAccessTokens: PersonalAccessTokenRecord[];
  inviteCodes: InviteCodeRecord[];
  teams: TeamRecord[];
  teamMembers: TeamMemberRecord[];
  channels: ChannelRecord[];
  channelMembers: ChannelMemberRecord[];
  posts: PostRecord[];
  postEditHistory: PostEditHistoryRecord[];
  reactions: ReactionRecord[];
  customEmoji: CustomEmojiRecord[];
  files: FileInfoRecord[];
  preferences: PreferenceRecord[];
  statuses: UserStatusRecord[];
  bots: BotAccountRecord[];
  slashCommands: SlashCommandRecord[];
  serverConfig: Record<string, JsonRecord>;
  privacySettings: PrivacySettingsRecord;
  auditSequence: number;
  auditLogs: AuditLogRecord[];
  auditOutbox: AuditOutboxRecord[];
  supervisionPolicy: SupervisionPolicyRecord;
  supervisionEvents: SupervisionEventRecord[];
  agentIdentities: AgentIdentityRecord[];
  agentConversationBindings: AgentConversationBindingRecord[];
  incomingWebhooks: IncomingWebhookRecord[];
  metrics: MetricsRecord;
};
