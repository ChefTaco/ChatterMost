ALTER TABLE "User"
  ADD COLUMN "optional_label" TEXT,
  ADD COLUMN "required_label" TEXT NOT NULL DEFAULT 'unknown',
  ADD CONSTRAINT "User_username_nonempty" CHECK ("username" <> '') NOT VALID;

CREATE INDEX "User_optional_label_idx" ON "User" ("optional_label");
