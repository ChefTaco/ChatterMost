import type {
  MattermostChannel,
  MattermostChannelMember,
  MattermostCommand,
  MattermostFileInfo,
  MattermostPost,
  MattermostPostList,
  MattermostPreference,
  MattermostReaction,
  MattermostTeam,
  MattermostTeamMember,
  MattermostUser
} from '../shared/mattermost.js';
import type {
  ChannelMemberRecord,
  ChannelRecord,
  FileInfoRecord,
  PostRecord,
  PreferenceRecord,
  ReactionRecord,
  SlashCommandRecord,
  TeamMemberRecord,
  TeamRecord,
  UserRecord
} from './domain.js';

export function toMattermostUser(
  user: UserRecord,
  options: { includeEmail: boolean }
): MattermostUser {
  return {
    id: user.id,
    create_at: user.createAt,
    update_at: user.updateAt,
    delete_at: user.deleteAt,
    username: user.username,
    auth_data: '',
    auth_service: '',
    email: options.includeEmail ? user.email : '',
    nickname: user.nickname,
    first_name: user.firstName,
    last_name: user.lastName,
    position: user.position,
    roles: user.roles,
    locale: user.locale,
    timezone: user.timezone,
    notify_props: user.notifyProps,
    last_picture_update: user.lastPictureUpdate,
    is_bot: user.isBot,
    bot_description: user.botDescription
  };
}

export function toMattermostTeam(team: TeamRecord): MattermostTeam {
  return {
    id: team.id,
    create_at: team.createAt,
    update_at: team.updateAt,
    delete_at: team.deleteAt,
    name: team.name,
    display_name: team.displayName,
    description: team.description,
    type: team.type,
    company_name: team.companyName,
    allowed_domains: team.allowedDomains,
    invite_id: team.inviteId,
    allow_open_invite: team.allowOpenInvite,
    scheme_id: team.schemeId,
    group_constrained: team.groupConstrained
  };
}

export function toMattermostTeamMember(member: TeamMemberRecord): MattermostTeamMember {
  return {
    team_id: member.teamId,
    user_id: member.userId,
    roles: member.roles.trim().length > 0 ? member.roles : 'team_user',
    delete_at: member.deleteAt,
    scheme_user: true,
    scheme_admin: member.roles.includes('team_admin')
  };
}

export function toMattermostChannel(channel: ChannelRecord): MattermostChannel {
  return {
    id: channel.id,
    create_at: channel.createAt,
    update_at: channel.updateAt,
    delete_at: channel.deleteAt,
    team_id: channel.teamId,
    type: channel.type,
    display_name: channel.displayName,
    name: channel.name,
    header: channel.header,
    purpose: channel.purpose,
    last_post_at: channel.lastPostAt,
    total_msg_count: channel.totalMsgCount,
    extra_update_at: channel.extraUpdateAt,
    creator_id: channel.creatorId
  };
}

export function toMattermostChannelMember(member: ChannelMemberRecord): MattermostChannelMember {
  return {
    channel_id: member.channelId,
    user_id: member.userId,
    roles: member.roles.trim().length > 0 ? member.roles : 'channel_user',
    last_viewed_at: member.lastViewedAt,
    msg_count: member.msgCount,
    mention_count: member.mentionCount,
    notify_props: member.notifyProps,
    last_update_at: member.lastUpdateAt,
    scheme_user: member.schemeUser,
    scheme_admin: member.schemeAdmin
  };
}

export function toMattermostPost(
  post: PostRecord,
  participants: MattermostUser[] = []
): MattermostPost {
  const metadataFiles = Array.isArray(post.metadata.files)
    ? post.metadata.files.filter((file) => typeof file === 'object' && file !== null && !Array.isArray(file))
    : [];
  return {
    id: post.id,
    create_at: post.createAt,
    update_at: post.updateAt,
    edit_at: post.editAt,
    delete_at: post.deleteAt,
    is_pinned: post.isPinned,
    user_id: post.userId,
    channel_id: post.channelId,
    root_id: post.rootId,
    original_id: post.originalId,
    message: post.message,
    type: post.type,
    props: post.props,
    hashtags: post.hashtags,
    file_ids: post.fileIds,
    pending_post_id: post.pendingPostId,
    reply_count: post.replyCount,
    last_reply_at: post.lastReplyAt,
    participants,
    metadata: { ...post.metadata, files: metadataFiles }
  };
}

export function toMattermostPostList(posts: PostRecord[]): MattermostPostList {
  const ordered = [...posts].sort((a, b) => a.createAt - b.createAt);
  return {
    order: ordered.map((post) => post.id),
    posts: Object.fromEntries(ordered.map((post) => [post.id, toMattermostPost(post)])),
    next_post_id: '',
    prev_post_id: ''
  };
}

export function toMattermostReaction(reaction: ReactionRecord): MattermostReaction {
  return {
    user_id: reaction.userId,
    post_id: reaction.postId,
    emoji_name: reaction.emojiName,
    create_at: reaction.createAt
  };
}

export function toMattermostCommand(command: SlashCommandRecord): MattermostCommand {
  return {
    id: command.id,
    token: '',
    create_at: command.createAt,
    update_at: command.updateAt,
    delete_at: 0,
    creator_id: '',
    team_id: command.teamId,
    trigger: command.trigger,
    method: command.method === 'POST' ? 'P' : 'G',
    username: '',
    icon_url: '',
    auto_complete: true,
    auto_complete_desc: command.description,
    auto_complete_hint: command.autoCompleteHint ?? '',
    display_name: command.displayName ?? command.trigger,
    description: command.description,
    url: '',
    plugin_id: command.pluginId ?? ''
  };
}

export function toMattermostFileInfo(file: FileInfoRecord, postId = ''): MattermostFileInfo {
  return {
    id: file.id,
    user_id: file.userId,
    post_id: postId,
    channel_id: file.channelId,
    create_at: file.createAt,
    update_at: file.updateAt,
    delete_at: file.deleteAt,
    name: file.name,
    extension: file.extension,
    size: file.size,
    mime_type: file.mimeType,
    width: file.width,
    height: file.height,
    has_preview_image: file.hasPreviewImage
  };
}

export function toMattermostPreference(preference: PreferenceRecord): MattermostPreference {
  return {
    user_id: preference.userId,
    category: preference.category,
    name: preference.name,
    value: preference.value
  };
}
