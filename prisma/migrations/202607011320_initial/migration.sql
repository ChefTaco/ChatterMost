CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE "User" (
  "id" TEXT PRIMARY KEY,
  "create_at" BIGINT NOT NULL,
  "update_at" BIGINT NOT NULL,
  "delete_at" BIGINT NOT NULL DEFAULT 0,
  "delete_by" TEXT,
  "username" TEXT NOT NULL UNIQUE,
  "email" TEXT NOT NULL UNIQUE,
  "password_hash" TEXT NOT NULL,
  "nickname" TEXT NOT NULL DEFAULT '',
  "first_name" TEXT NOT NULL DEFAULT '',
  "last_name" TEXT NOT NULL DEFAULT '',
  "position" TEXT NOT NULL DEFAULT '',
  "roles" TEXT NOT NULL DEFAULT 'system_user',
  "locale" TEXT NOT NULL DEFAULT 'en',
  "timezone" JSONB NOT NULL,
  "notify_props" JSONB NOT NULL,
  "last_picture_update" BIGINT NOT NULL DEFAULT 0,
  "is_bot" BOOLEAN NOT NULL DEFAULT false,
  "bot_description" TEXT NOT NULL DEFAULT '',
  "disabled_at" BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE "UserProfileImage" ("id" TEXT PRIMARY KEY, "user_id" TEXT NOT NULL UNIQUE REFERENCES "User"("id") ON DELETE CASCADE, "create_at" BIGINT NOT NULL, "update_at" BIGINT NOT NULL, "mime_type" TEXT NOT NULL, "storage_key" TEXT NOT NULL, "size" INTEGER NOT NULL);
CREATE TABLE "Session" ("id" TEXT PRIMARY KEY, "tokenHash" TEXT NOT NULL UNIQUE, "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE, "create_at" BIGINT NOT NULL, "expires_at" BIGINT NOT NULL, "device_id" TEXT NOT NULL DEFAULT '', "revoked_at" BIGINT NOT NULL DEFAULT 0);
CREATE TABLE "PersonalAccessToken" ("id" TEXT PRIMARY KEY, "tokenHash" TEXT NOT NULL UNIQUE, "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE, "description" TEXT NOT NULL DEFAULT '', "create_at" BIGINT NOT NULL, "update_at" BIGINT NOT NULL, "delete_at" BIGINT NOT NULL DEFAULT 0);
CREATE TABLE "InviteCode" ("id" TEXT PRIMARY KEY, "codeHash" TEXT NOT NULL UNIQUE, "createdByUserId" TEXT NOT NULL, "create_at" BIGINT NOT NULL, "update_at" BIGINT NOT NULL, "maxUses" INTEGER NOT NULL, "uses" INTEGER NOT NULL DEFAULT 0, "expiresAt" BIGINT NOT NULL, "role" TEXT NOT NULL DEFAULT 'system_user', "teamIds" JSONB NOT NULL, "channelIds" JSONB NOT NULL, "disabledAt" BIGINT NOT NULL DEFAULT 0);
CREATE TABLE "Team" ("id" TEXT PRIMARY KEY, "create_at" BIGINT NOT NULL, "update_at" BIGINT NOT NULL, "delete_at" BIGINT NOT NULL DEFAULT 0, "delete_by" TEXT, "name" TEXT NOT NULL UNIQUE, "display_name" TEXT NOT NULL, "description" TEXT NOT NULL DEFAULT '', "type" TEXT NOT NULL DEFAULT 'O', "company_name" TEXT NOT NULL DEFAULT '', "allowed_domains" TEXT NOT NULL DEFAULT '', "invite_id" TEXT NOT NULL DEFAULT '', "allow_open_invite" BOOLEAN NOT NULL DEFAULT false, "scheme_id" TEXT, "group_constrained" BOOLEAN NOT NULL DEFAULT false);
CREATE TABLE "TeamMember" ("id" TEXT PRIMARY KEY, "team_id" TEXT NOT NULL REFERENCES "Team"("id") ON DELETE CASCADE, "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE, "roles" TEXT NOT NULL DEFAULT '', "create_at" BIGINT NOT NULL, "update_at" BIGINT NOT NULL, "delete_at" BIGINT NOT NULL DEFAULT 0, UNIQUE("user_id","team_id"));
CREATE TABLE "Channel" ("id" TEXT PRIMARY KEY, "create_at" BIGINT NOT NULL, "update_at" BIGINT NOT NULL, "delete_at" BIGINT NOT NULL DEFAULT 0, "delete_by" TEXT, "team_id" TEXT REFERENCES "Team"("id") ON DELETE CASCADE, "type" TEXT NOT NULL, "display_name" TEXT NOT NULL, "name" TEXT NOT NULL, "header" TEXT NOT NULL DEFAULT '', "purpose" TEXT NOT NULL DEFAULT '', "last_post_at" BIGINT NOT NULL DEFAULT 0, "total_msg_count" INTEGER NOT NULL DEFAULT 0, "extra_update_at" BIGINT NOT NULL DEFAULT 0, "creator_id" TEXT NOT NULL, "agent_policy" JSONB, "retention_days" INTEGER, UNIQUE("team_id","name"));
CREATE TABLE "ChannelMember" ("id" TEXT PRIMARY KEY, "channel_id" TEXT NOT NULL REFERENCES "Channel"("id") ON DELETE CASCADE, "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE, "roles" TEXT NOT NULL DEFAULT '', "last_viewed_at" BIGINT NOT NULL DEFAULT 0, "msg_count" INTEGER NOT NULL DEFAULT 0, "mention_count" INTEGER NOT NULL DEFAULT 0, "notify_props" JSONB NOT NULL, "last_update_at" BIGINT NOT NULL DEFAULT 0, "scheme_user" BOOLEAN NOT NULL DEFAULT true, "scheme_admin" BOOLEAN NOT NULL DEFAULT false, UNIQUE("user_id","channel_id"));
CREATE TABLE "Post" ("id" TEXT PRIMARY KEY, "create_at" BIGINT NOT NULL, "update_at" BIGINT NOT NULL, "edit_at" BIGINT NOT NULL DEFAULT 0, "delete_at" BIGINT NOT NULL DEFAULT 0, "delete_by" TEXT, "is_pinned" BOOLEAN NOT NULL DEFAULT false, "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE, "channel_id" TEXT NOT NULL REFERENCES "Channel"("id") ON DELETE CASCADE, "root_id" TEXT NOT NULL DEFAULT '', "original_id" TEXT NOT NULL DEFAULT '', "message" TEXT NOT NULL, "type" TEXT NOT NULL DEFAULT '', "props" JSONB NOT NULL, "hashtags" TEXT NOT NULL DEFAULT '', "file_ids" JSONB NOT NULL, "pending_post_id" TEXT, "reply_count" INTEGER NOT NULL DEFAULT 0, "last_reply_at" BIGINT NOT NULL DEFAULT 0, "metadata" JSONB NOT NULL, "lifecycle_state" TEXT NOT NULL DEFAULT 'approved');
CREATE TABLE "PostEditHistory" ("id" TEXT PRIMARY KEY, "post_id" TEXT NOT NULL REFERENCES "Post"("id") ON DELETE CASCADE, "user_id" TEXT NOT NULL, "message" TEXT NOT NULL, "edit_at" BIGINT NOT NULL);
CREATE TABLE "Reaction" ("id" TEXT PRIMARY KEY, "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE, "post_id" TEXT NOT NULL REFERENCES "Post"("id") ON DELETE CASCADE, "emoji_name" TEXT NOT NULL, "create_at" BIGINT NOT NULL, UNIQUE("user_id","post_id","emoji_name"));
CREATE TABLE "FileObject" ("id" TEXT PRIMARY KEY, "create_at" BIGINT NOT NULL, "storage_key" TEXT NOT NULL UNIQUE, "sha256" TEXT NOT NULL, "size" INTEGER NOT NULL);
CREATE TABLE "FileInfo" ("id" TEXT PRIMARY KEY, "user_id" TEXT NOT NULL, "channel_id" TEXT NOT NULL REFERENCES "Channel"("id") ON DELETE CASCADE, "create_at" BIGINT NOT NULL, "update_at" BIGINT NOT NULL, "delete_at" BIGINT NOT NULL DEFAULT 0, "name" TEXT NOT NULL, "extension" TEXT NOT NULL, "size" INTEGER NOT NULL, "mime_type" TEXT NOT NULL, "width" INTEGER NOT NULL DEFAULT 0, "height" INTEGER NOT NULL DEFAULT 0, "has_preview_image" BOOLEAN NOT NULL DEFAULT false, "storage_key" TEXT NOT NULL);
CREATE TABLE "Preference" ("id" TEXT PRIMARY KEY, "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE, "category" TEXT NOT NULL, "name" TEXT NOT NULL, "value" TEXT NOT NULL, "create_at" BIGINT NOT NULL, "update_at" BIGINT NOT NULL, UNIQUE("user_id","category","name"));
CREATE TABLE "UserStatus" ("user_id" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE, "status" TEXT NOT NULL, "manual" BOOLEAN NOT NULL DEFAULT false, "last_activity_at" BIGINT NOT NULL);
CREATE TABLE "BotAccount" ("id" TEXT PRIMARY KEY, "user_id" TEXT NOT NULL UNIQUE REFERENCES "User"("id") ON DELETE CASCADE, "tokenHash" TEXT NOT NULL UNIQUE, "display_name" TEXT NOT NULL, "description" TEXT NOT NULL, "create_at" BIGINT NOT NULL, "update_at" BIGINT NOT NULL);
CREATE TABLE "SlashCommand" ("id" TEXT PRIMARY KEY, "team_id" TEXT NOT NULL, "trigger" TEXT NOT NULL, "url" TEXT NOT NULL, "method" TEXT NOT NULL DEFAULT 'POST', "description" TEXT NOT NULL DEFAULT '', "create_at" BIGINT NOT NULL, "update_at" BIGINT NOT NULL);
CREATE TABLE "ServerConfig" ("key" TEXT PRIMARY KEY, "value" JSONB NOT NULL, "update_at" BIGINT NOT NULL);
CREATE TABLE "PrivacySettings" ("id" TEXT PRIMARY KEY, "showEmailAddress" BOOLEAN NOT NULL DEFAULT false, "showFullName" BOOLEAN NOT NULL DEFAULT true, "teammateNameDisplay" TEXT NOT NULL DEFAULT 'username', "enableDiagnostics" BOOLEAN NOT NULL DEFAULT false, "enableTelemetry" BOOLEAN NOT NULL DEFAULT false, "enableSecurityAlerts" BOOLEAN NOT NULL DEFAULT false, "enableAdminNotices" BOOLEAN NOT NULL DEFAULT false, "enableUserNotices" BOOLEAN NOT NULL DEFAULT false, "enablePublicFileLinks" BOOLEAN NOT NULL DEFAULT false, "enableFileAttachments" BOOLEAN NOT NULL DEFAULT true, "enableCustomEmoji" BOOLEAN NOT NULL DEFAULT false, "enableEmojiPicker" BOOLEAN NOT NULL DEFAULT true, "enableBotAccountCreation" BOOLEAN NOT NULL DEFAULT true, "enableUserAccessTokens" BOOLEAN NOT NULL DEFAULT true, "enablePostSearch" BOOLEAN NOT NULL DEFAULT true, "enableFileSearch" BOOLEAN NOT NULL DEFAULT true, "update_at" BIGINT NOT NULL);
CREATE TABLE "AuditLog" ("id" TEXT PRIMARY KEY, "create_at" BIGINT NOT NULL, "actorUserId" TEXT, "action" TEXT NOT NULL, "targetId" TEXT, "ip" TEXT, "metadata" JSONB NOT NULL);
CREATE TABLE "SupervisionPolicy" ("id" TEXT PRIMARY KEY, "mode" TEXT NOT NULL DEFAULT 'audit_only', "blockedTerms" JSONB NOT NULL, "channelRestrictions" JSONB NOT NULL, "userRestrictions" JSONB NOT NULL, "agentRestrictions" JSONB NOT NULL, "fileRestrictions" JSONB NOT NULL, "create_at" BIGINT NOT NULL, "update_at" BIGINT NOT NULL);
CREATE TABLE "SupervisionEvent" ("id" TEXT PRIMARY KEY, "create_at" BIGINT NOT NULL, "actorUserId" TEXT, "postId" TEXT, "channelId" TEXT, "agentUserId" TEXT, "action" TEXT NOT NULL, "state" TEXT NOT NULL, "metadata" JSONB NOT NULL);
CREATE TABLE "AgentIdentity" ("id" TEXT PRIMARY KEY, "create_at" BIGINT NOT NULL, "update_at" BIGINT NOT NULL, "name" TEXT NOT NULL, "username" TEXT NOT NULL UNIQUE, "user_id" TEXT, "permissions" JSONB NOT NULL, "channelRouting" JSONB NOT NULL, "userAllowlists" JSONB NOT NULL, "memoryPolicy" JSONB NOT NULL, "verified" BOOLEAN NOT NULL DEFAULT false);
CREATE TABLE "AgentConversationBinding" ("id" TEXT PRIMARY KEY, "agentUserId" TEXT NOT NULL, "channelId" TEXT NOT NULL, "threadRootId" TEXT NOT NULL, "humanUserId" TEXT NOT NULL, "sessionKey" TEXT NOT NULL, "policy" JSONB NOT NULL, "create_at" BIGINT NOT NULL, "update_at" BIGINT NOT NULL);

CREATE INDEX "User_username_idx" ON "User"("username");
CREATE INDEX "User_email_idx" ON "User"("email");
CREATE INDEX "Session_tokenHash_idx" ON "Session"("tokenHash");
CREATE INDEX "InviteCode_codeHash_idx" ON "InviteCode"("codeHash");
CREATE INDEX "Post_channel_create_idx" ON "Post"("channel_id","create_at");
CREATE INDEX "Post_root_create_idx" ON "Post"("root_id","create_at");
CREATE INDEX "Reaction_post_idx" ON "Reaction"("post_id");
CREATE INDEX "Channel_team_name_idx" ON "Channel"("team_id","name");
CREATE INDEX "ChannelMember_user_channel_idx" ON "ChannelMember"("user_id","channel_id");
CREATE INDEX "TeamMember_user_team_idx" ON "TeamMember"("user_id","team_id");
CREATE INDEX "Post_message_trgm_idx" ON "Post" USING GIN ("message" gin_trgm_ops);
CREATE INDEX "FileInfo_name_trgm_idx" ON "FileInfo" USING GIN ("name" gin_trgm_ops);
