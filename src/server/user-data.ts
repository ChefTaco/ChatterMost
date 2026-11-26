import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { badRequest, forbidden, notFound, nowMs, type JsonRecord } from '../shared/mattermost.js';
import type { FileInfoRecord, StoreState, UserRecord } from './domain.js';
import type { AppEnv } from './env.js';
import { resolveDataPath } from './env.js';
import { toMattermostFileInfo, toMattermostPost, toMattermostReaction, toMattermostUser } from './mappers.js';
import { createSecretToken, hashPassword } from './security.js';
import { appendAuditLog, redactDeletedPost, requireAdmin, type WebSocketHub } from './services.js';
import type { StateStore } from './store.js';

export type EraseReport = {
  user_id: string;
  posts: number;
  reactions: number;
  files: number;
  sessions: number;
  personal_access_tokens: number;
  preferences: number;
  channel_memberships: number;
  team_memberships: number;
  webhooks: number;
  profile_image: boolean;
};

/**
 * Per-user data export and erase for administrators. Export returns everything stored about one
 * account; erase removes it, leaving the account as an anonymous, deactivated placeholder so other
 * people's threads, reactions and audit history stay consistent.
 */
export class UserDataService {
  public constructor(
    private readonly store: StateStore,
    private readonly env: AppEnv,
    private readonly hub: WebSocketHub
  ) {}

  public async export(actor: UserRecord, userId: string, ip: string | null): Promise<JsonRecord> {
    requireAdmin(actor);
    const data = this.store.read((state) => {
      const user = state.users.find((candidate) => candidate.id === userId);
      if (user === undefined) throw notFound('User');
      const channelNames = new Map(state.channels.map((channel) => [channel.id, channel]));
      const posts = state.posts.filter((post) => post.userId === userId);
      return {
        format: 'chattermost-user-export',
        version: 1,
        exported_at: nowMs(),
        user: toMattermostUser(user, { includeEmail: true }),
        teams: state.teamMembers.filter((member) => member.userId === userId).map((member) => ({ team_id: member.teamId, team_name: state.teams.find((team) => team.id === member.teamId)?.name ?? '', roles: member.roles, create_at: member.createAt, delete_at: member.deleteAt })),
        channels: state.channelMembers.filter((member) => member.userId === userId).map((member) => ({ channel_id: member.channelId, channel_name: channelNames.get(member.channelId)?.name ?? '', channel_type: channelNames.get(member.channelId)?.type ?? '', roles: member.roles, last_viewed_at: member.lastViewedAt, notify_props: member.notifyProps })),
        posts: posts.map((post) => ({ ...toMattermostPost(post), lifecycle_state: post.lifecycleState })),
        edit_history: state.postEditHistory.filter((entry) => entry.userId === userId).map((entry) => ({ post_id: entry.postId, message: entry.message, edit_at: entry.editAt })),
        reactions: state.reactions.filter((reaction) => reaction.userId === userId).map(toMattermostReaction),
        files: state.files.filter((file) => file.userId === userId).map((file) => ({ ...toMattermostFileInfo(file, ''), download: `/admin/users/${userId}/export/files/${file.id}` })),
        preferences: state.preferences.filter((preference) => preference.userId === userId).map((preference) => ({ category: preference.category, name: preference.name, value: preference.value })),
        status: state.statuses.find((status) => status.user_id === userId) ?? null,
        sessions: state.sessions.filter((session) => session.userId === userId).map((session) => ({ id: session.id, create_at: session.createAt, expires_at: session.expiresAt, device_id: session.deviceId, revoked_at: session.revokedAt })),
        personal_access_tokens: state.personalAccessTokens.filter((token) => token.userId === userId).map((token) => ({ id: token.id, description: token.description, create_at: token.createAt, delete_at: token.deleteAt })),
        profile_image: (() => {
          const image = state.profileImages.find((candidate) => candidate.userId === userId);
          return image === undefined ? null : { mime_type: image.mimeType, size: image.size, update_at: image.updateAt };
        })(),
        audit: state.auditLogs.filter((entry) => entry.actorUserId === userId || entry.targetId === userId).map((entry) => ({ id: entry.id, create_at: entry.createAt, action: entry.action, actor_user_id: entry.actorUserId, target_id: entry.targetId, metadata: entry.metadata }))
      };
    });
    await this.store.write((state) => {
      appendAuditLog(state, { actorUserId: actor.id, action: 'admin.user.exported', targetId: userId, ip, metadata: { posts: data.posts.length, files: data.files.length } });
    });
    return data;
  }

  /** The bytes of one file the user uploaded, for an export. */
  public async exportFile(actor: UserRecord, userId: string, fileId: string): Promise<{ file: FileInfoRecord; bytes: Uint8Array }> {
    requireAdmin(actor);
    const file = this.store.read((state) => state.files.find((candidate) => candidate.id === fileId && candidate.userId === userId));
    if (file === undefined || path.basename(file.storageKey) !== file.storageKey) throw notFound('File');
    return { file, bytes: await readFile(path.join(resolveDataPath(this.env.FILE_STORAGE_PATH), file.storageKey)) };
  }

  /**
   * Erases one account's content and personal data. The account's ID stays as a deactivated,
   * anonymous placeholder; its posts become deletion tombstones so replies by others remain in their
   * threads. The caller must repeat the username in `confirm`. A dry run reports the counts only.
   */
  public async erase(actor: UserRecord, userId: string, input: { confirm: string; dryRun: boolean; ip: string | null }): Promise<EraseReport> {
    requireAdmin(actor);
    const target = this.store.read((state) => state.users.find((candidate) => candidate.id === userId));
    if (target === undefined) throw notFound('User');
    if (target.id === actor.id) throw forbidden('You cannot erase your own account');
    if (target.isBot) throw badRequest('Bot accounts are removed through bot management, not erased');
    if (target.roles.split(/\s+/u).includes('system_admin') || target.username === this.env.ADMIN_USERNAME.toLowerCase()) throw forbidden('Remove the system admin role before erasing this account');
    if (!input.dryRun && input.confirm !== target.username) throw badRequest('Confirm the erase by repeating the username in confirm');
    const plan = (state: Readonly<StoreState>): EraseReport => ({
      user_id: userId,
      posts: state.posts.filter((post) => post.userId === userId).length,
      reactions: state.reactions.filter((reaction) => reaction.userId === userId).length,
      files: state.files.filter((file) => file.userId === userId).length,
      sessions: state.sessions.filter((session) => session.userId === userId).length,
      personal_access_tokens: state.personalAccessTokens.filter((token) => token.userId === userId).length,
      preferences: state.preferences.filter((preference) => preference.userId === userId).length,
      channel_memberships: state.channelMembers.filter((member) => member.userId === userId).length,
      team_memberships: state.teamMembers.filter((member) => member.userId === userId).length,
      webhooks: state.incomingWebhooks.filter((hook) => hook.creatorId === userId).length + state.outgoingWebhooks.filter((hook) => hook.creatorId === userId).length,
      profile_image: state.profileImages.some((image) => image.userId === userId)
    });
    if (input.dryRun) return this.store.read(plan);
    const placeholderPassword = await hashPassword(createSecretToken());
    const removed = await this.store.write((state) => {
      const report = plan(state);
      const now = nowMs();
      const user = state.users.find((candidate) => candidate.id === userId);
      if (user === undefined) throw notFound('User');
      const erasedPostIds = new Set<string>();
      for (const post of state.posts) {
        if (post.userId !== userId) continue;
        erasedPostIds.add(post.id);
        Object.assign(post, redactDeletedPost(post), {
          deleteAt: post.deleteAt > 0 ? post.deleteAt : now,
          deleteBy: post.deleteBy ?? actor.id,
          updateAt: now,
          lifecycleState: 'deleted',
          isPinned: false
        });
      }
      const fileStorageKeys = state.files.filter((file) => file.userId === userId).map((file) => file.storageKey);
      const imageStorageKeys = state.profileImages.filter((image) => image.userId === userId).map((image) => image.storageKey);
      state.files = state.files.filter((file) => file.userId !== userId);
      state.postEditHistory = state.postEditHistory.filter((entry) => entry.userId !== userId && !erasedPostIds.has(entry.postId));
      state.reactions = state.reactions.filter((reaction) => reaction.userId !== userId && !erasedPostIds.has(reaction.postId));
      state.sessions = state.sessions.filter((session) => session.userId !== userId);
      state.personalAccessTokens = state.personalAccessTokens.filter((token) => token.userId !== userId);
      state.preferences = state.preferences.filter((preference) => preference.userId !== userId);
      state.statuses = state.statuses.filter((status) => status.user_id !== userId);
      state.channelMembers = state.channelMembers.filter((member) => member.userId !== userId);
      state.teamMembers = state.teamMembers.filter((member) => member.userId !== userId);
      state.incomingWebhooks = state.incomingWebhooks.filter((hook) => hook.creatorId !== userId);
      state.outgoingWebhooks = state.outgoingWebhooks.filter((hook) => hook.creatorId !== userId);
      state.profileImages = state.profileImages.filter((image) => image.userId !== userId);
      Object.assign(user, {
        username: `erased-${userId.slice(0, 12)}`,
        email: `erased-${userId}@erased.invalid`,
        passwordHash: placeholderPassword,
        nickname: '',
        firstName: '',
        lastName: '',
        position: '',
        roles: 'system_user',
        notifyProps: {},
        lastPictureUpdate: 0,
        disabledAt: user.disabledAt > 0 ? user.disabledAt : now,
        deleteAt: user.deleteAt > 0 ? user.deleteAt : now,
        updateAt: now
      });
      appendAuditLog(state, { actorUserId: actor.id, action: 'admin.user.erased', targetId: userId, ip: input.ip, metadata: { ...report } });
      return { report, fileStorageKeys, imageStorageKeys };
    });
    this.hub.closeUnauthorized();
    await removeAll(resolveDataPath(this.env.FILE_STORAGE_PATH), removed.fileStorageKeys);
    await removeAll(resolveDataPath(this.env.PROFILE_IMAGE_STORAGE_PATH), removed.imageStorageKeys);
    await this.hub.broadcast('user_updated', { user_id: userId }, {});
    return removed.report;
  }
}

async function removeAll(root: string, storageKeys: string[]): Promise<void> {
  for (const storageKey of storageKeys) {
    if (storageKey.length === 0 || path.basename(storageKey) !== storageKey) continue;
    await rm(path.join(root, storageKey), { force: true }).catch(() => undefined);
  }
}
