#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

: "${CHATTERMOST_RELEASE:?}"
: "${CHATTERMOST_DEPLOY_PATH:?}"
: "${CHATTERMOST_DEPLOY_USER:?}"

cd "$CHATTERMOST_RELEASE"
LEDGER="$CHATTERMOST_DEPLOY_PATH/shared/release-transactions.jsonl"
MIGRATION_OUTPUT="$(mktemp "${TMPDIR:-/tmp}/chattermost-migrate.XXXXXX")"
MIGRATION_TABLE="$(mktemp "${TMPDIR:-/tmp}/chattermost-migrations-table.XXXXXX")"
EXPECTED_CURRENT="$(mktemp "${TMPDIR:-/tmp}/chattermost-schema-current.XXXXXX")"
EXPECTED_LEGACY="$(mktemp "${TMPDIR:-/tmp}/chattermost-schema-legacy.XXXXXX")"
LIVE_SCHEMA="$(mktemp "${TMPDIR:-/tmp}/chattermost-schema-live.XXXXXX")"
LEGACY_CHECK_DATABASE=''
chmod 600 "$MIGRATION_OUTPUT" "$MIGRATION_TABLE" "$EXPECTED_CURRENT" "$EXPECTED_LEGACY" "$LIVE_SCHEMA"
cleanup() {
  if [[ -n "$LEGACY_CHECK_DATABASE" ]]; then
    docker compose -p chattermost --env-file .env exec -T postgres dropdb --if-exists --force -U chattermost_app "$LEGACY_CHECK_DATABASE" >/dev/null 2>&1 || true
  fi
  rm -f -- "$MIGRATION_OUTPUT" "$MIGRATION_TABLE" "$EXPECTED_CURRENT" "$EXPECTED_LEGACY" "$LIVE_SCHEMA"
}
trap cleanup EXIT

DATABASE_URL="$(node scripts/env-file.mjs get .env DATABASE_URL)"
MANIFEST_MIGRATION_SET_DIGEST="${MIGRATION_SET_DIGEST:?}"
MANIFEST_SCHEMA_LINEAGE_ALGORITHM="${SCHEMA_LINEAGE_ALGORITHM:?}"
MANIFEST_SCHEMA_LINEAGE_DIGEST="${SCHEMA_LINEAGE_DIGEST:?}"
MANIFEST_SCHEMA_LINEAGE_DEPTH="${SCHEMA_LINEAGE_DEPTH:?}"
MANIFEST_LEGACY_UNTRACKED_SCHEMA_DIGEST="${LEGACY_UNTRACKED_SCHEMA_DIGEST:?}"
MANIFEST_REPAIRED_SCHEMA_DIGEST="${REPAIRED_SCHEMA_DIGEST:?}"
while IFS= read -r -d '' name && IFS= read -r -d '' value; do
  printf -v "$name" '%s' "$value"
done < <(node scripts/schema-policy.mjs emit-nul "$CHATTERMOST_RELEASE")
: "${MIGRATION_SET_DIGEST:?}"
: "${SCHEMA_LINEAGE_ALGORITHM:?}"
: "${SCHEMA_LINEAGE_DIGEST:?}"
: "${SCHEMA_LINEAGE_DEPTH:?}"
: "${LEGACY_UNTRACKED_SCHEMA_DIGEST:?}"
: "${REPAIRED_SCHEMA_DIGEST:?}"
[[ "$MIGRATION_POLICY" == expansion-only ]]
[[ "$MIGRATION_SET_DIGEST" == "$MANIFEST_MIGRATION_SET_DIGEST" ]]
[[ "$SCHEMA_LINEAGE_ALGORITHM" == "$MANIFEST_SCHEMA_LINEAGE_ALGORITHM" ]]
[[ "$SCHEMA_LINEAGE_DIGEST" == "$MANIFEST_SCHEMA_LINEAGE_DIGEST" ]]
[[ "$SCHEMA_LINEAGE_DEPTH" == "$MANIFEST_SCHEMA_LINEAGE_DEPTH" ]]
[[ "$LEGACY_UNTRACKED_SCHEMA_DIGEST" == "$MANIFEST_LEGACY_UNTRACKED_SCHEMA_DIGEST" ]]
[[ "$REPAIRED_SCHEMA_DIGEST" == "$MANIFEST_REPAIRED_SCHEMA_DIGEST" ]]

database_migration_table() {
  local table_exists
  table_exists="$(docker compose -p chattermost --env-file .env exec -T postgres psql -X -qAt -U chattermost_app -d chattermost -c "SELECT to_regclass('public.\"_prisma_migrations\"') IS NOT NULL")"
  if [[ "$table_exists" != t ]]; then
    printf '%s\n' '{"table_exists":false,"rows":[]}'
    return
  fi
  docker compose -p chattermost --env-file .env exec -T postgres psql -X -qAt -U chattermost_app -d chattermost <<'SQL'
SELECT jsonb_build_object(
  'table_exists', true,
  'rows', COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.started_at), '[]'::jsonb)
)
FROM (
  SELECT id, checksum, migration_name, started_at, finished_at, rolled_back_at, applied_steps_count
  FROM "_prisma_migrations"
) AS m;
SQL
}

append_failure_ledger() {
  local attempt="$1"
  database_migration_table > "$MIGRATION_TABLE" 2>/dev/null || printf '%s\n' '{"table_exists":null,"rows":[],"inspection_error":true}' > "$MIGRATION_TABLE"
  MIGRATION_ATTEMPT="$attempt" CHATTERMOST_RELEASE="$CHATTERMOST_RELEASE" \
    node --input-type=module - "$LEDGER" "$MIGRATION_OUTPUT" "$MIGRATION_TABLE" <<'NODE'
import { appendFile, chmod, readFile } from 'node:fs/promises';
const [ledger, outputFile, tableFile] = process.argv.slice(2);
const output = await readFile(outputFile, 'utf8');
const table = JSON.parse((await readFile(tableFile, 'utf8')).trim());
const unfinished = Array.isArray(table.rows)
  ? table.rows.find((row) => row.finished_at === null && row.rolled_back_at === null)
  : undefined;
const named = output.match(/(?:Migration name:|migration [`'"])([a-zA-Z0-9_-]+)/u);
const code = output.match(/\bP\d{4}\b/u);
const record = {
  recorded_at: new Date().toISOString(),
  release_id: process.env.CHATTERMOST_RELEASE.split('/').pop(),
  status: 'migration_failed',
  migration_state: 'failed',
  migration_attempt: process.env.MIGRATION_ATTEMPT,
  failed_migration: unfinished?.migration_name ?? named?.[1] ?? null,
  prisma_error_code: code?.[0] ?? null,
  database_migration_table: table
};
await appendFile(ledger, JSON.stringify(record) + '\n', { mode: 0o600 });
await chmod(ledger, 0o600);
NODE
  chown "$CHATTERMOST_DEPLOY_USER" "$LEDGER"
}

normalize_schema_dump() {
  sed -i '/^\\restrict /d; /^\\unrestrict /d' "$1"
}

repair_exact_untracked_legacy_schema() {
  local pre_repair_hash post_repair_hash
  LEGACY_CHECK_DATABASE="chattermost_legacy_check_${RANDOM}_$$"
  docker compose -p chattermost --env-file .env exec -T postgres createdb -U chattermost_app "$LEGACY_CHECK_DATABASE"
  while IFS= read -r migration_file; do
    docker compose -p chattermost --env-file .env exec -T postgres \
      psql -X -q -v ON_ERROR_STOP=1 -U chattermost_app -d "$LEGACY_CHECK_DATABASE" < "$migration_file"
  done < <(find prisma/migrations -mindepth 2 -maxdepth 2 -type f -name migration.sql | sort)

  docker compose -p chattermost --env-file .env exec -T postgres \
    pg_dump --schema-only --no-owner --no-privileges -U chattermost_app -d "$LEGACY_CHECK_DATABASE" > "$EXPECTED_CURRENT"
  docker compose -p chattermost --env-file .env exec -T postgres \
    psql -X -q -v ON_ERROR_STOP=1 -U chattermost_app -d "$LEGACY_CHECK_DATABASE" < prisma/legacy/202607020020_untracked_fingerprint.sql
  docker compose -p chattermost --env-file .env exec -T postgres \
    pg_dump --schema-only --no-owner --no-privileges -U chattermost_app -d "$LEGACY_CHECK_DATABASE" > "$EXPECTED_LEGACY"
  docker compose -p chattermost --env-file .env exec -T postgres \
    pg_dump --schema-only --no-owner --no-privileges -U chattermost_app -d chattermost > "$LIVE_SCHEMA"
  normalize_schema_dump "$EXPECTED_CURRENT"
  normalize_schema_dump "$EXPECTED_LEGACY"
  normalize_schema_dump "$LIVE_SCHEMA"
  [[ "$(sha256sum "$EXPECTED_LEGACY" | cut -d' ' -f1)" == "$LEGACY_UNTRACKED_SCHEMA_DIGEST" ]]
  [[ "$(sha256sum "$EXPECTED_CURRENT" | cut -d' ' -f1)" == "$REPAIRED_SCHEMA_DIGEST" ]]
  pre_repair_hash="$(sha256sum "$LIVE_SCHEMA" | cut -d' ' -f1)"
  if [[ "$pre_repair_hash" != "$LEGACY_UNTRACKED_SCHEMA_DIGEST" ]]; then
    return 1
  fi

  docker compose -p chattermost --env-file .env exec -T postgres \
    psql -X -q -v ON_ERROR_STOP=1 -U chattermost_app -d chattermost < prisma/legacy/202607020020_untracked_repair.sql
  docker compose -p chattermost --env-file .env exec -T postgres \
    pg_dump --schema-only --no-owner --no-privileges -U chattermost_app -d chattermost > "$LIVE_SCHEMA"
  normalize_schema_dump "$LIVE_SCHEMA"
  post_repair_hash="$(sha256sum "$LIVE_SCHEMA" | cut -d' ' -f1)"
  PRE_REPAIR_HASH="$pre_repair_hash" POST_REPAIR_HASH="$post_repair_hash" \
  LEGACY_UNTRACKED_SCHEMA_DIGEST="$LEGACY_UNTRACKED_SCHEMA_DIGEST" REPAIRED_SCHEMA_DIGEST="$REPAIRED_SCHEMA_DIGEST" \
    node --input-type=module - "$LEDGER" <<'NODE'
import { appendFile, chmod } from 'node:fs/promises';
const [ledger] = process.argv.slice(2);
await appendFile(ledger, JSON.stringify({
  recorded_at: new Date().toISOString(),
  release_id: process.env.CHATTERMOST_RELEASE.split('/').pop(),
  status: 'legacy_schema_repaired',
  migration_state: 'repair_applied',
  schema_hashes: {
    pre_repair: process.env.PRE_REPAIR_HASH,
    expected_pre_repair: process.env.LEGACY_UNTRACKED_SCHEMA_DIGEST,
    post_repair: process.env.POST_REPAIR_HASH,
    expected_post_repair: process.env.REPAIRED_SCHEMA_DIGEST
  }
}) + '\n', { mode: 0o600 });
await chmod(ledger, 0o600);
NODE
  chown "$CHATTERMOST_DEPLOY_USER" "$LEDGER"
  [[ "$post_repair_hash" == "$REPAIRED_SCHEMA_DIGEST" ]]
}

if DATABASE_URL="$DATABASE_URL" npx prisma migrate deploy > "$MIGRATION_OUTPUT" 2>&1; then
  exit 0
fi

append_failure_ledger initial
cat "$MIGRATION_OUTPUT" >&2

TABLE_EXISTS="$(database_migration_table | node --input-type=module -e "let value=''; for await (const chunk of process.stdin) value += chunk; process.stdout.write(JSON.parse(value).table_exists === false ? '0' : '1')")"
if [[ "$TABLE_EXISTS" != 0 ]]; then
  echo 'Prisma migration failed on a database with migration history; refusing fallback.' >&2
  exit 1
fi

if ! repair_exact_untracked_legacy_schema; then
  echo 'Database is not the exact known untracked legacy schema; refusing migration repair and baselining.' >&2
  exit 1
fi

while IFS= read -r migration; do
  DATABASE_URL="$DATABASE_URL" npx prisma migrate resolve --applied "$migration"
done < <(find prisma/migrations -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort)

if ! DATABASE_URL="$DATABASE_URL" npx prisma migrate deploy > "$MIGRATION_OUTPUT" 2>&1; then
  append_failure_ledger after-baseline
  cat "$MIGRATION_OUTPUT" >&2
  exit 1
fi
