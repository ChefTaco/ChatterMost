CREATE TABLE IF NOT EXISTS "RuntimeState" (
  "key" TEXT PRIMARY KEY,
  "value" JSONB NOT NULL,
  "update_at" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "CustomEmoji" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "emoji" TEXT NOT NULL,
  "creator_user_id" TEXT NOT NULL,
  "create_at" BIGINT NOT NULL,
  "update_at" BIGINT NOT NULL,
  "delete_at" BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "CustomEmoji_name_idx" ON "CustomEmoji"("name");
