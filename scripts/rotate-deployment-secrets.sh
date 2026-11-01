#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"
ROTATE_POSTGRES=0
ROTATE_COOKIE=0
CONFIRM=''
WORK_DIR=''
REMOTE_SQL_FILES=()

usage() {
  cat <<'USAGE'
Usage: scripts/rotate-deployment-secrets.sh [--postgres] [--cookie] --confirm ROTATE_CHATTERMOST_SECRETS [--env-file <path>]

--postgres  Rotate the chattermost_app database role password and DATABASE_URL.
--cookie    Rotate COOKIE_SECRET and revoke all browser sessions after health succeeds.

The command stops ChatterMost during the coordinated change. API, bot, invite,
and webhook token hashes remain keyed by TOKEN_HASH_SECRET and are not rotated.
Before the confirmation gate, the command reports the affected credential classes.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --postgres) ROTATE_POSTGRES=1; shift ;;
    --cookie) ROTATE_COOKIE=1; shift ;;
    --confirm) CONFIRM="${2:-}"; shift 2 ;;
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ "$ROTATE_POSTGRES" != "1" && "$ROTATE_COOKIE" != "1" ]]; then
  echo "Choose --postgres, --cookie, or both." >&2
  exit 2
fi
if [[ ! -f "$ENV_FILE" || "$(stat -c '%a' "$ENV_FILE")" != "600" ]]; then
  echo "$ENV_FILE must exist and be mode 600." >&2
  exit 1
fi

while IFS= read -r -d '' name && IFS= read -r -d '' value; do
  printf -v "$name" '%s' "$value"
  export "$name"
done < <(node "$SCRIPT_DIR/env-file.mjs" emit-nul "$ENV_FILE")

: "${CHAT_SERVER_DEPLOY_USER:?CHAT_SERVER_DEPLOY_USER is required}"
: "${CHAT_SERVER_DEPLOY_HOST:?CHAT_SERVER_DEPLOY_HOST is required}"
: "${CHAT_SERVER_DEPLOY_PATH:?CHAT_SERVER_DEPLOY_PATH is required}"
: "${CHAT_SERVER_INTERNAL_PORT:?CHAT_SERVER_INTERNAL_PORT is required}"

REMOTE="${CHAT_SERVER_DEPLOY_USER}@${CHAT_SERVER_DEPLOY_HOST}"
SSH_KEY_PATH="${CHAT_SERVER_DEPLOY_SSH_KEY:-$HOME/.ssh/chattermost_deploy_ed25519}"
KNOWN_HOSTS_FILE="$REPO_ROOT/deploy/ssh_known_hosts"
SSH_OPTS=(-o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$KNOWN_HOSTS_FILE" -o HostKeyAlgorithms=ssh-ed25519)
if [[ -f "$SSH_KEY_PATH" ]]; then
  SSH_OPTS=(-i "$SSH_KEY_PATH" "${SSH_OPTS[@]}")
fi
ROTATION_ID="$(date -u +%Y%m%d%H%M%S)"
REMOTE_ENV="$CHAT_SERVER_DEPLOY_PATH/current/.env"
REMOTE_BACKUP="$CHAT_SERVER_DEPLOY_PATH/shared/.env.before-rotation-$ROTATION_ID"
REMOTE_CANDIDATE="$CHAT_SERVER_DEPLOY_PATH/shared/.env.rotation-$ROTATION_ID.tmp"

umask 077
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/chattermost-secret-rotation.XXXXXX")"
cleanup() {
  for remote_file in "${REMOTE_SQL_FILES[@]}"; do
    ssh "${SSH_OPTS[@]}" "$REMOTE" "rm -f '$remote_file'" >/dev/null 2>&1 || true
  done
  if [[ -n "$WORK_DIR" && -d "$WORK_DIR" ]]; then
    rm -rf -- "$WORK_DIR"
  fi
}
trap cleanup EXIT

CURRENT_ENV="$WORK_DIR/current.env"
CANDIDATE_ENV="$WORK_DIR/candidate.env"
if ! ssh "${SSH_OPTS[@]}" "$REMOTE" "[[ -e '$CHAT_SERVER_DEPLOY_PATH/current' && -r '$REMOTE_ENV' ]] && [[ \"\$(stat -Lc '%a' '$REMOTE_ENV')\" == 600 ]] && cat '$REMOTE_ENV'" > "$CURRENT_ENV"; then
  echo "Rotation is only allowed for an established deployment with a readable mode-600 shared/.env." >&2
  exit 1
fi
chmod 600 "$CURRENT_ENV"
cp "$CURRENT_ENV" "$CANDIDATE_ENV"

env_value() {
  local name="$1"
  node "$SCRIPT_DIR/env-file.mjs" get "$CURRENT_ENV" "$name"
}

OLD_POSTGRES_PASSWORD="$(env_value POSTGRES_PASSWORD)"
OLD_COOKIE_SECRET="$(env_value COOKIE_SECRET)"
TOKEN_HASH_SECRET="$(env_value TOKEN_HASH_SECRET)"
if [[ -z "$OLD_POSTGRES_PASSWORD" || -z "$OLD_COOKIE_SECRET" ]]; then
  echo "Protected values are missing from the established environment; rotation aborted." >&2
  exit 1
fi
TOKEN_HASH_SECRET="${TOKEN_HASH_SECRET:-$OLD_COOKIE_SECRET}"
NEW_POSTGRES_PASSWORD="$OLD_POSTGRES_PASSWORD"
NEW_COOKIE_SECRET="$OLD_COOKIE_SECRET"
if [[ "$ROTATE_POSTGRES" == "1" ]]; then NEW_POSTGRES_PASSWORD="$(openssl rand -hex 32)"; fi
if [[ "$ROTATE_COOKIE" == "1" ]]; then NEW_COOKIE_SECRET="$(openssl rand -hex 32)"; fi

rewrite_env() {
  export ROTATE_POSTGRES_PASSWORD="$NEW_POSTGRES_PASSWORD" ROTATE_COOKIE_SECRET="$NEW_COOKIE_SECRET" ROTATE_TOKEN_HASH_SECRET="$TOKEN_HASH_SECRET"
  node "$SCRIPT_DIR/env-file.mjs" rewrite-rotation "$CURRENT_ENV" "$CANDIDATE_ENV"
}
rewrite_env

IMPACT_JSON="$(ssh "${SSH_OPTS[@]}" "$REMOTE" "cd '$CHAT_SERVER_DEPLOY_PATH/current' && docker compose -p chattermost --env-file '$REMOTE_ENV' exec -T postgres psql -U chattermost_app -d chattermost -tAc \"SELECT json_build_object('browser_sessions', jsonb_array_length(COALESCE(value->'sessions','[]'::jsonb)), 'browser_sessions_invalidated', ($ROTATE_COOKIE = 1), 'bot_tokens_unchanged', jsonb_array_length(COALESCE(value->'bots','[]'::jsonb)), 'api_tokens_unchanged', jsonb_array_length(COALESCE(value->'personalAccessTokens','[]'::jsonb)), 'invite_codes_unchanged', jsonb_array_length(COALESCE(value->'inviteCodes','[]'::jsonb)), 'webhooks_unchanged', jsonb_array_length(COALESCE(value->'incomingWebhooks','[]'::jsonb)), 'database_credentials_rotated', ($ROTATE_POSTGRES = 1))::text FROM \\\"RuntimeState\\\" WHERE \\\"key\\\"='default'\"")"
echo "Secret impact preview: $IMPACT_JSON"
if [[ "$ROTATE_COOKIE" == 1 ]]; then echo 'COOKIE_SECRET rotation revokes all browser sessions.'; fi
if [[ "$ROTATE_POSTGRES" == 1 ]]; then echo 'POSTGRES_PASSWORD rotation reconnects the application, migrations, and database operators.'; fi
if [[ "$CONFIRM" != "ROTATE_CHATTERMOST_SECRETS" ]]; then
  echo "Rotation requires --confirm ROTATE_CHATTERMOST_SECRETS after reviewing the impact." >&2
  exit 2
fi

remote_sudo() {
  local command="$1"
  if [[ -n "${CHAT_SERVER_DEPLOY_SUDO_PASSWORD:-}" ]]; then
    printf '%s\n' "$CHAT_SERVER_DEPLOY_SUDO_PASSWORD" | ssh "${SSH_OPTS[@]}" "$REMOTE" "sudo -S -p '' bash -lc $(printf '%q' "$command")"
  else
    ssh "${SSH_OPTS[@]}" "$REMOTE" "sudo bash -lc $(printf '%q' "$command")"
  fi
}

transfer_protected() {
  local local_file="$1"
  local remote_file="$2"
  ssh "${SSH_OPTS[@]}" "$REMOTE" "umask 077; cat > '$remote_file' && chmod 600 '$remote_file' && [[ \"\$(stat -c '%a' '$remote_file')\" == 600 ]] && [[ \"\$(stat -c '%U' '$remote_file')\" == \"\$(id -un)\" ]]" < "$local_file"
}

SQL_APPLY="$WORK_DIR/apply.sql"
SQL_ROLLBACK="$WORK_DIR/rollback.sql"
printf "ALTER ROLE chattermost_app PASSWORD '%s';\n" "$NEW_POSTGRES_PASSWORD" > "$SQL_APPLY"
printf "ALTER ROLE chattermost_app PASSWORD '%s';\n" "$OLD_POSTGRES_PASSWORD" > "$SQL_ROLLBACK"
REMOTE_SQL_APPLY="$CHAT_SERVER_DEPLOY_PATH/shared/.rotation-$ROTATION_ID-apply.sql"
REMOTE_SQL_ROLLBACK="$CHAT_SERVER_DEPLOY_PATH/shared/.rotation-$ROTATION_ID-rollback.sql"
REMOTE_SQL_FILES+=("$REMOTE_SQL_APPLY" "$REMOTE_SQL_ROLLBACK")
transfer_protected "$SQL_APPLY" "$REMOTE_SQL_APPLY"
transfer_protected "$SQL_ROLLBACK" "$REMOTE_SQL_ROLLBACK"
transfer_protected "$CANDIDATE_ENV" "$REMOTE_CANDIDATE"

ssh "${SSH_OPTS[@]}" "$REMOTE" "cp '$REMOTE_ENV' '$REMOTE_BACKUP' && chmod 600 '$REMOTE_BACKUP'"
remote_sudo "systemctl stop chattermost.service"
if [[ "$ROTATE_COOKIE" == "1" ]]; then
  remote_sudo "cd '$CHAT_SERVER_DEPLOY_PATH/current' && docker compose -p chattermost --env-file '$REMOTE_BACKUP' exec -T postgres psql -v ON_ERROR_STOP=1 -U chattermost_app -d chattermost -c \"INSERT INTO \\\"RuntimeState\\\" (\\\"key\\\", \\\"value\\\", \\\"update_at\\\") SELECT 'rotation-$ROTATION_ID', \\\"value\\\", \\\"update_at\\\" FROM \\\"RuntimeState\\\" WHERE \\\"key\\\" = 'default' ON CONFLICT (\\\"key\\\") DO UPDATE SET \\\"value\\\" = EXCLUDED.\\\"value\\\", \\\"update_at\\\" = EXCLUDED.\\\"update_at\\\"\"" || exit 1
fi

rollback() {
  echo "Rotation failed; restoring the prior environment and database role." >&2
  ssh "${SSH_OPTS[@]}" "$REMOTE" "cp '$REMOTE_BACKUP' '$REMOTE_ENV' && chmod 600 '$REMOTE_ENV'" || true
  if [[ "$ROTATE_POSTGRES" == "1" ]]; then
    remote_sudo "cd '$CHAT_SERVER_DEPLOY_PATH/current' && docker compose -p chattermost --env-file '$REMOTE_BACKUP' exec -T postgres psql -v ON_ERROR_STOP=1 -U chattermost_app -d postgres < '$REMOTE_SQL_ROLLBACK'" || true
  fi
  if [[ "$ROTATE_COOKIE" == "1" ]]; then
    remote_sudo "cd '$CHAT_SERVER_DEPLOY_PATH/current' && docker compose -p chattermost --env-file '$REMOTE_BACKUP' exec -T postgres psql -v ON_ERROR_STOP=1 -U chattermost_app -d chattermost -c \"UPDATE \\\"RuntimeState\\\" AS current SET \\\"value\\\" = backup.\\\"value\\\", \\\"update_at\\\" = backup.\\\"update_at\\\" FROM \\\"RuntimeState\\\" AS backup WHERE current.\\\"key\\\" = 'default' AND backup.\\\"key\\\" = 'rotation-$ROTATION_ID'\"" || true
  fi
  remote_sudo "systemctl restart chattermost.service" || true
  exit 1
}

if [[ "$ROTATE_POSTGRES" == "1" ]]; then
  remote_sudo "cd '$CHAT_SERVER_DEPLOY_PATH/current' && docker compose -p chattermost --env-file '$REMOTE_BACKUP' exec -T postgres psql -v ON_ERROR_STOP=1 -U chattermost_app -d postgres < '$REMOTE_SQL_APPLY'" || rollback
fi
ssh "${SSH_OPTS[@]}" "$REMOTE" "mv -f '$REMOTE_CANDIDATE' '$REMOTE_ENV'" || rollback
remote_sudo "systemctl restart chattermost.service" || rollback
if ! ssh "${SSH_OPTS[@]}" "$REMOTE" "for attempt in {1..30}; do curl -fsS 'http://127.0.0.1:${CHAT_SERVER_INTERNAL_PORT}/api/v4/system/ping' >/dev/null && exit 0; sleep 1; done; exit 1"; then
  rollback
fi

if [[ "$ROTATE_COOKIE" == "1" ]]; then
  INVALIDATE_SQL="$WORK_DIR/invalidate-sessions.sql"
  printf '%s\n' 'UPDATE "RuntimeState" SET "value" = jsonb_set("value", '\''{sessions}'\'', '\''[]'\''::jsonb, true), "update_at" = (extract(epoch from clock_timestamp()) * 1000)::bigint WHERE "key" = '\''default'\'';' > "$INVALIDATE_SQL"
  REMOTE_INVALIDATE_SQL="$CHAT_SERVER_DEPLOY_PATH/shared/.rotation-$ROTATION_ID-invalidate.sql"
  REMOTE_SQL_FILES+=("$REMOTE_INVALIDATE_SQL")
  transfer_protected "$INVALIDATE_SQL" "$REMOTE_INVALIDATE_SQL"
  remote_sudo "systemctl stop chattermost.service" || rollback
  remote_sudo "cd '$CHAT_SERVER_DEPLOY_PATH/current' && docker compose -p chattermost --env-file '$REMOTE_ENV' exec -T postgres psql -v ON_ERROR_STOP=1 -U chattermost_app -d chattermost < '$REMOTE_INVALIDATE_SQL'" || rollback
  remote_sudo "systemctl restart chattermost.service" || rollback
  if ! ssh "${SSH_OPTS[@]}" "$REMOTE" "for attempt in {1..30}; do curl -fsS 'http://127.0.0.1:${CHAT_SERVER_INTERNAL_PORT}/api/v4/system/ping' >/dev/null && exit 0; sleep 1; done; exit 1"; then
    rollback
  fi
  remote_sudo "cd '$CHAT_SERVER_DEPLOY_PATH/current' && docker compose -p chattermost --env-file '$REMOTE_ENV' exec -T postgres psql -v ON_ERROR_STOP=1 -U chattermost_app -d chattermost -c \"DELETE FROM \\\"RuntimeState\\\" WHERE \\\"key\\\" = 'rotation-$ROTATION_ID'\"" || true
fi

ssh "${SSH_OPTS[@]}" "$REMOTE" "rm -f '$REMOTE_CANDIDATE'"
ssh "${SSH_OPTS[@]}" "$REMOTE" "ln -sfn '$CHAT_SERVER_DEPLOY_PATH/current/.env' '$CHAT_SERVER_DEPLOY_PATH/shared/.env'"
CONFIG_DIGEST="$(node "$SCRIPT_DIR/env-file.mjs" digest "$CANDIDATE_ENV")"
COOKIE_VERSION="$(node "$SCRIPT_DIR/env-file.mjs" fingerprint "$CANDIDATE_ENV" COOKIE_SECRET)"
POSTGRES_VERSION="$(node "$SCRIPT_DIR/env-file.mjs" fingerprint "$CANDIDATE_ENV" POSTGRES_PASSWORD)"
LEDGER_RECORD="$(node -e 'console.log(JSON.stringify({status:"deployment_secrets_rotated",configuration_digest:process.argv[1],secret_versions:{cookie:process.argv[2],postgres:process.argv[3]},impact:JSON.parse(process.argv[4]),rollback_target:process.argv[5],health_evidence:{internal:"passed"}}))' "$CONFIG_DIGEST" "$COOKIE_VERSION" "$POSTGRES_VERSION" "$IMPACT_JSON" "$REMOTE_BACKUP")"
printf '%s' "$LEDGER_RECORD" | ssh "${SSH_OPTS[@]}" "$REMOTE" "node '$CHAT_SERVER_DEPLOY_PATH/current/scripts/env-file.mjs' append-ledger '$CHAT_SERVER_DEPLOY_PATH/shared/release-transactions.jsonl'"
echo "Secret rotation $ROTATION_ID completed. Rollback environment retained at $REMOTE_BACKUP."
