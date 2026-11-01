-- Exact historical state produced before Prisma migration tracking was enabled.
-- These two pg_trgm indexes were absent; every other schema object must match
-- the complete checked-in migration history before deployment may repair it.
DROP INDEX "FileInfo_name_trgm_idx";
DROP INDEX "Post_message_trgm_idx";
