CREATE INDEX "Post_message_trgm_idx" ON "Post" USING GIN ("message" gin_trgm_ops);
CREATE INDEX "FileInfo_name_trgm_idx" ON "FileInfo" USING GIN ("name" gin_trgm_ops);
