import { badRequest, createId, type JsonRecord, type MattermostChannelType } from '../shared/mattermost.js';
import type { ChannelRecord, PostRecord, StoreState, UserRecord } from './domain.js';

/** One reaction as the bulk export carries it: by username, not ID. */
export type ImportReactionInput = { user: string; emoji_name: string; create_at?: number | undefined };

export type ImportReplyInput = {
  import_id?: string | undefined;
  user?: string | undefined;
  message: string;
  create_at?: number | undefined;
  props: Record<string, unknown>;
  reactions: ImportReactionInput[];
};

export type ImportPostInput = ImportReplyInput & {
  /** Channel name (or, for older payloads, a channel ID) in `team`, or the default team. */
  channel_id: string;
  team?: string | undefined;
  /** Usernames of a direct or group conversation; replaces `channel_id`. */
  direct_members?: string[] | undefined;
  /** Older payloads: an existing post ID or another post's `import_id`. */
  root_id: string;
  replies: ImportReplyInput[];
};

export type ImportChannelInput = {
  team_id?: string | undefined;
  team?: string | undefined;
  name: string;
  display_name: string;
  type: 'O' | 'P';
  header: string;
  purpose: string;
  retention_days?: number | null | undefined;
};

export type ImportBatch = { channels: ImportChannelInput[]; posts: ImportPostInput[] };

export type ImportReport = {
  planned_channels: number;
  planned_posts: number;
  created_channels: number;
  reused_channels: number;
  created_direct_channels: number;
  imported_posts: number;
  imported_replies: number;
  imported_reactions: number;
  skipped_duplicates: number;
  memberships_added: number;
  held_by_supervision: number;
  /** Authors with no matching active account in the target team; their posts are attributed to the importer. */
  unmapped_users: string[];
  /** Export data that this import does not carry over. */
  lost: { reactions: number; direct_posts: number };
  /** Channels created in this batch (applied runs only), for change notification. */
  channel_ids: string[];
};

/** Clock skew tolerated for export timestamps, so a clock slightly ahead does not reject a batch. */
const FUTURE_SKEW_MS = 5 * 60_000;
const MAX_IMPORT_KEY_LENGTH = 200;

type Context = {
  actor: UserRecord;
  now: number;
  lifecycleFor: (message: string) => PostRecord['lifecycleState'];
  hashtags: (message: string) => string;
  mentions: (message: string) => string[];
  appendAudit: (state: StoreState, input: { actorUserId: string; action: string; metadata: JsonRecord }) => void;
};

/**
 * Applies one import batch to `state` in place. The caller runs this inside one store write (so a
 * failure leaves nothing behind) or against a copy for a dry run. Posts keep their export author and
 * timestamp; replies attach to the root they arrived with. A post whose `import_id` already exists
 * is skipped, so a batch can be retried after a failure without duplicating history.
 */
export function applyImportBatch(state: StoreState, batch: ImportBatch, ctx: Context): ImportReport {
  const report: ImportReport = {
    planned_channels: batch.channels.length,
    planned_posts: batch.posts.reduce((total, post) => total + 1 + post.replies.length, 0),
    created_channels: 0,
    reused_channels: 0,
    created_direct_channels: 0,
    imported_posts: 0,
    imported_replies: 0,
    imported_reactions: 0,
    skipped_duplicates: 0,
    memberships_added: 0,
    held_by_supervision: 0,
    unmapped_users: [],
    lost: { reactions: 0, direct_posts: 0 },
    channel_ids: []
  };
  const unmapped = new Set<string>();
  const activeTeams = state.teams.filter((team) => team.deleteAt === 0);
  const defaultTeamId = activeTeams.find((team) => state.teamMembers.some((member) => member.teamId === team.id && member.userId === ctx.actor.id && member.deleteAt === 0))?.id ?? activeTeams[0]?.id ?? '';
  const teamIdFor = (teamName: string | undefined, teamId: string | undefined): string => {
    if (teamId !== undefined && teamId.length > 0) {
      if (!activeTeams.some((team) => team.id === teamId)) throw badRequest(`Unknown import team ${teamId}`);
      return teamId;
    }
    if (teamName !== undefined && teamName.length > 0) {
      const team = activeTeams.find((candidate) => candidate.name === teamName);
      if (team === undefined) throw badRequest(`Unknown import team ${teamName}`);
      return team.id;
    }
    if (defaultTeamId.length === 0) throw badRequest('Import requires a team');
    return defaultTeamId;
  };
  const usersByName = new Map(state.users.filter((user) => user.deleteAt === 0 && user.disabledAt === 0).map((user) => [user.username, user]));
  const isTeamMember = (teamId: string, userId: string): boolean => state.teamMembers.some((member) => member.teamId === teamId && member.userId === userId && member.deleteAt === 0);
  const isChannelMember = (channelId: string, userId: string): boolean => state.channelMembers.some((member) => member.channelId === channelId && member.userId === userId);
  const addMember = (channel: ChannelRecord, userId: string, roles: string): void => {
    state.channelMembers.push(channelMember(channel.id, userId, roles, ctx.now));
  };

  for (const input of batch.channels) {
    const teamId = teamIdFor(input.team, input.team_id);
    const existing = state.channels.find((channel) => channel.teamId === teamId && channel.name === input.name && channel.deleteAt === 0);
    if (existing !== undefined) {
      report.reused_channels += 1;
      continue;
    }
    const channel = newChannel({ teamId, type: input.type, name: input.name, displayName: input.display_name, header: input.header, purpose: input.purpose, creatorId: ctx.actor.id, now: ctx.now });
    if (input.retention_days !== undefined) channel.retentionDays = input.retention_days;
    state.channels.push(channel);
    addMember(channel, ctx.actor.id, 'channel_admin');
    report.created_channels += 1;
    report.channel_ids.push(channel.id);
  }

  /** The post's channel, or null for a direct conversation whose people do not all have accounts. */
  const channelFor = (post: ImportPostInput): ChannelRecord | null => {
    if (post.direct_members !== undefined && post.direct_members.length > 0) {
      const members = post.direct_members.map((username) => usersByName.get(username));
      if (!members.every((user): user is UserRecord => user !== undefined)) return null;
      const ids = [...new Set(members.map((user) => user.id))].sort();
      const creatorId = ids[0];
      if (creatorId === undefined || ids.length < 2) throw badRequest('A direct import conversation needs at least two people');
      const type: MattermostChannelType = ids.length === 2 ? 'D' : 'G';
      const name = ids.join('__');
      let channel = state.channels.find((candidate) => candidate.name === name && candidate.type === type);
      if (channel === undefined) {
        channel = newChannel({ teamId: '', type, name, displayName: '', header: '', purpose: '', creatorId, now: ctx.now });
        state.channels.push(channel);
        for (const id of ids) addMember(channel, id, 'channel_user');
        report.created_direct_channels += 1;
        report.channel_ids.push(channel.id);
      }
      return channel;
    }
    if (post.channel_id.length === 0) {
      // Older payloads without a channel go to the importer's first channel.
      const fallback = state.channels.find((candidate) => candidate.deleteAt === 0 && (candidate.type === 'O' || candidate.type === 'P') && isChannelMember(candidate.id, ctx.actor.id));
      if (fallback === undefined) throw badRequest('Import post requires a channel_id when no default channel exists');
      return fallback;
    }
    const teamId = teamIdFor(post.team, undefined);
    const channel =
      state.channels.find((candidate) => candidate.teamId === teamId && candidate.name === post.channel_id && candidate.deleteAt === 0) ??
      state.channels.find((candidate) => candidate.id === post.channel_id && candidate.deleteAt === 0 && (candidate.type === 'O' || candidate.type === 'P'));
    if (channel === undefined) throw badRequest(`Unknown import channel ${post.channel_id}`);
    return channel;
  };

  const existingKeys = new Set<string>();
  for (const post of state.posts) if (post.importKey !== undefined) existingKeys.add(post.importKey);
  const postsById = new Map(state.posts.map((post) => [post.id, post]));
  const touchedChannels = new Map<string, ChannelRecord>();

  const authorFor = (channel: ChannelRecord, username: string | undefined): { user: UserRecord; imported: string | null } => {
    const name = username ?? '';
    const candidate = name.length > 0 ? usersByName.get(name) : ctx.actor;
    if (candidate === undefined) {
      unmapped.add(name);
      return { user: ctx.actor, imported: name };
    }
    if (channel.type === 'D' || channel.type === 'G') {
      if (isChannelMember(channel.id, candidate.id)) return { user: candidate, imported: null };
      unmapped.add(name);
      return { user: ctx.actor, imported: name };
    }
    if (!isTeamMember(channel.teamId, candidate.id) && candidate.id !== ctx.actor.id) {
      unmapped.add(name);
      return { user: ctx.actor, imported: name };
    }
    if (!isChannelMember(channel.id, candidate.id)) {
      addMember(channel, candidate.id, '');
      report.memberships_added += 1;
    }
    return { user: candidate, imported: null };
  };

  const timestamp = (value: number | undefined): number => {
    if (value === undefined) return ctx.now;
    if (!Number.isSafeInteger(value) || value <= 0 || value > ctx.now + FUTURE_SKEW_MS) throw badRequest('Import create_at must be a Unix millisecond timestamp that is not in the future');
    return value;
  };

  const writePost = (channel: ChannelRecord, input: ImportReplyInput, root: PostRecord | null): PostRecord | null => {
    const key = input.import_id;
    if (key !== undefined && key.length > 0) {
      if (key.length > MAX_IMPORT_KEY_LENGTH) throw badRequest('Import ID is too long');
      if (existingKeys.has(key)) {
        report.skipped_duplicates += 1;
        return null;
      }
      existingKeys.add(key);
    }
    const author = authorFor(channel, input.user);
    const createAt = timestamp(input.create_at);
    const lifecycleState = ctx.lifecycleFor(input.message);
    const id = createId();
    const props: JsonRecord = { ...(input.props as JsonRecord) };
    if (author.imported !== null && author.imported.length > 0) props.imported_username = author.imported;
    const post: PostRecord = {
      id,
      createAt,
      updateAt: createAt,
      editAt: 0,
      deleteAt: 0,
      isPinned: false,
      userId: author.user.id,
      channelId: channel.id,
      rootId: root?.id ?? '',
      originalId: '',
      message: input.message,
      type: '',
      props,
      hashtags: ctx.hashtags(input.message),
      fileIds: [],
      pendingPostId: '',
      replyCount: 0,
      lastReplyAt: 0,
      metadata: { embeds: [], emojis: [], files: [], has_reactions: false, mentions: ctx.mentions(input.message) },
      lifecycleState,
      ...(key !== undefined && key.length > 0 ? { importKey: key } : {})
    };
    state.posts.push(post);
    postsById.set(post.id, post);
    if (lifecycleState === 'submitted') report.held_by_supervision += 1;
    else {
      channel.lastPostAt = Math.max(channel.lastPostAt, createAt);
      channel.totalMsgCount += 1;
      touchedChannels.set(channel.id, channel);
    }
    if (root !== null) {
      root.replyCount += 1;
      root.lastReplyAt = Math.max(root.lastReplyAt, createAt);
      root.updateAt = Math.max(root.updateAt, createAt);
    }
    for (const reaction of input.reactions) {
      const user = usersByName.get(reaction.user);
      if (user === undefined) {
        report.lost.reactions += 1;
        continue;
      }
      if (state.reactions.some((existing) => existing.postId === post.id && existing.userId === user.id && existing.emojiName === reaction.emoji_name)) continue;
      state.reactions.push({ id: createId(), userId: user.id, postId: post.id, emojiName: reaction.emoji_name, createAt: reaction.create_at !== undefined ? timestamp(reaction.create_at) : createAt });
      post.metadata = { ...post.metadata, has_reactions: true };
      report.imported_reactions += 1;
    }
    return post;
  };

  const resolveRoot = (channel: ChannelRecord, rootId: string): PostRecord => {
    const byId = postsById.get(rootId);
    const root = byId ?? state.posts.find((post) => post.importKey === rootId);
    if (root === undefined || root.channelId !== channel.id || root.rootId !== '' || root.deleteAt > 0) throw badRequest('Invalid thread root for channel');
    return root;
  };

  for (const input of batch.posts) {
    const channel = channelFor(input);
    if (channel === null) {
      report.lost.direct_posts += 1 + input.replies.length;
      for (const name of input.direct_members ?? []) if (!usersByName.has(name)) unmapped.add(name);
      continue;
    }
    const explicitRoot = input.root_id.length > 0 ? resolveRoot(channel, input.root_id) : null;
    const written = writePost(channel, input, explicitRoot);
    if (written !== null) {
      if (explicitRoot === null) report.imported_posts += 1;
      else report.imported_replies += 1;
    }
    // A thread root skipped as a duplicate still receives replies that are new in this batch.
    const root = explicitRoot ?? written ?? (input.import_id !== undefined ? state.posts.find((post) => post.importKey === input.import_id) ?? null : null);
    for (const reply of input.replies) {
      if (root === null) throw badRequest('Import replies require a thread root');
      if (writePost(channel, reply, root) !== null) report.imported_replies += 1;
    }
  }

  for (const channel of touchedChannels.values()) channel.updateAt = Math.max(channel.updateAt, ctx.now);
  report.unmapped_users = [...unmapped].filter((name) => name.length > 0).sort();
  ctx.appendAudit(state, {
    actorUserId: ctx.actor.id,
    action: 'import.mattermost_archive',
    metadata: {
      channels: report.created_channels,
      direct_channels: report.created_direct_channels,
      posts: report.imported_posts,
      replies: report.imported_replies,
      reactions: report.imported_reactions,
      skipped_duplicates: report.skipped_duplicates,
      unmapped_users: report.unmapped_users.length
    }
  });
  return report;
}

function newChannel(input: { teamId: string; type: MattermostChannelType; name: string; displayName: string; header: string; purpose: string; creatorId: string; now: number }): ChannelRecord {
  return {
    id: createId(),
    createAt: input.now,
    updateAt: input.now,
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
}

function channelMember(channelId: string, userId: string, roles: string, timestamp: number): StoreState['channelMembers'][number] {
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
