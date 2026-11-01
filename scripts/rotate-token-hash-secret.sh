#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"
CONFIRM=''
PREVIEW_ONLY=0
WORK_DIR=''

usage() {
  cat <<'USAGE'
Usage: scripts/rotate-token-hash-secret.sh [--preview] [--confirm ROTATE_CHATTERMOST_TOKEN_HASH_SECRET] [--env-file <path>]

TOKEN_HASH_SECRET rotation invalidates every existing bot token, personal access
token, invite code, and incoming webhook secret. The command reports exact live
record counts before requiring its dedicated confirmation phrase.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --preview) PREVIEW_ONLY=1; shift ;;
    --confirm) CONFIRM="${2:-}"; shift 2 ;;
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ ! -f "$ENV_FILE" || "$(stat -c '%a' "$ENV_FILE")" != 600 ]]; then echo "$ENV_FILE must exist and be mode 600." >&2; exit 1; fi
while IFS= read -r -d '' name && IFS= read -r -d '' value; do
  printf -v "$name" '%s' "$value"
  export "$name"
done < <(node "$SCRIPT_DIR/env-file.mjs" emit-nul "$ENV_FILE")
: "${CHAT_SERVER_DEPLOY_USER:?}"
: "${CHAT_SERVER_DEPLOY_HOST:?}"
: "${CHAT_SERVER_DEPLOY_PATH:?}"
: "${CHAT_SERVER_INTERNAL_PORT:?}"

REMOTE="${CHAT_SERVER_DEPLOY_USER}@${CHAT_SERVER_DEPLOY_HOST}"
SSH_KEY_PATH="${CHAT_SERVER_DEPLOY_SSH_KEY:-$HOME/.ssh/chattermost_deploy_ed25519}"
SSH_OPTS=(-o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$REPO_ROOT/deploy/ssh_known_hosts" -o HostKeyAlgorithms=ssh-ed25519)
if [[ -f "$SSH_KEY_PATH" ]]; then SSH_OPTS=(-i "$SSH_KEY_PATH" "${SSH_OPTS[@]}"); fi
REMOTE_ENV="$CHAT_SERVER_DEPLOY_PATH/current/.env"

IMPACT_JSON="$(ssh "${SSH_OPTS[@]}" "$REMOTE" "cd '$CHAT_SERVER_DEPLOY_PATH/current' && docker compose -p chattermost --env-file '$REMOTE_ENV' exec -T postgres psql -U chattermost_app -d chattermost -tAc \"SELECT json_build_object('browser_sessions_unchanged', jsonb_array_length(COALESCE(value->'sessions','[]'::jsonb)), 'bot_tokens_invalidated', jsonb_array_length(COALESCE(value->'bots','[]'::jsonb)), 'api_tokens_invalidated', jsonb_array_length(COALESCE(value->'personalAccessTokens','[]'::jsonb)), 'invite_codes_invalidated', jsonb_array_length(COALESCE(value->'inviteCodes','[]'::jsonb)), 'webhooks_invalidated', jsonb_array_length(COALESCE(value->'incomingWebhooks','[]'::jsonb)), 'database_credentials_unchanged', true)::text FROM \\\"RuntimeState\\\" WHERE \\\"key\\\"='default'\"")"
echo "TOKEN_HASH_SECRET impact preview: $IMPACT_JSON"
if [[ "$PREVIEW_ONLY" == 1 ]]; then exit 0; fi
if [[ "$CONFIRM" != ROTATE_CHATTERMOST_TOKEN_HASH_SECRET ]]; then
  echo 'Rotation requires --confirm ROTATE_CHATTERMOST_TOKEN_HASH_SECRET after reviewing the impact.' >&2
  exit 2
fi

umask 077
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/chattermost-token-rotation.XXXXXX")"
cleanup() { if [[ -n "$WORK_DIR" && -d "$WORK_DIR" ]]; then rm -rf -- "$WORK_DIR"; fi; }
trap cleanup EXIT
CURRENT_ENV="$WORK_DIR/current.env"
CANDIDATE_ENV="$WORK_DIR/candidate.env"
ssh "${SSH_OPTS[@]}" "$REMOTE" "[[ -r '$REMOTE_ENV' && \"\$(stat -Lc '%a' '$REMOTE_ENV')\" == 600 ]] && cat '$REMOTE_ENV'" > "$CURRENT_ENV"
chmod 600 "$CURRENT_ENV"
export ROTATE_TOKEN_HASH_SECRET="$(openssl rand -hex 32)"
node "$SCRIPT_DIR/env-file.mjs" rewrite-rotation "$CURRENT_ENV" "$CANDIDATE_ENV"

ROTATION_ID="$(date -u +%Y%m%d%H%M%S)"
REMOTE_BACKUP="$CHAT_SERVER_DEPLOY_PATH/shared/.env.before-token-rotation-$ROTATION_ID"
REMOTE_CANDIDATE="$CHAT_SERVER_DEPLOY_PATH/current/.env.token-rotation-$ROTATION_ID.tmp"
ssh "${SSH_OPTS[@]}" "$REMOTE" "umask 077; cat > '$REMOTE_CANDIDATE' && chmod 600 '$REMOTE_CANDIDATE'" < "$CANDIDATE_ENV"
ssh "${SSH_OPTS[@]}" "$REMOTE" "cp '$REMOTE_ENV' '$REMOTE_BACKUP' && chmod 600 '$REMOTE_BACKUP'"

remote_sudo() {
  local command="$1"
  if [[ -n "${CHAT_SERVER_DEPLOY_SUDO_PASSWORD:-}" ]]; then
    printf '%s\n' "$CHAT_SERVER_DEPLOY_SUDO_PASSWORD" | ssh "${SSH_OPTS[@]}" "$REMOTE" "sudo -S -p '' bash -lc $(printf '%q' "$command")"
  else
    ssh "${SSH_OPTS[@]}" "$REMOTE" "sudo bash -lc $(printf '%q' "$command")"
  fi
}
rollback() {
  echo 'Token-hash rotation failed; restoring the prior configuration.' >&2
  ssh "${SSH_OPTS[@]}" "$REMOTE" "cp '$REMOTE_BACKUP' '$REMOTE_ENV' && chmod 600 '$REMOTE_ENV'" || true
  remote_sudo 'systemctl restart chattermost.service' || true
  exit 1
}

ssh "${SSH_OPTS[@]}" "$REMOTE" "mv -f '$REMOTE_CANDIDATE' '$REMOTE_ENV'" || rollback
remote_sudo 'systemctl restart chattermost.service' || rollback
ssh "${SSH_OPTS[@]}" "$REMOTE" "for attempt in {1..30}; do curl -fsS 'http://127.0.0.1:${CHAT_SERVER_INTERNAL_PORT}/api/v4/system/ping' >/dev/null && exit 0; sleep 1; done; exit 1" || rollback

CONFIG_DIGEST="$(node "$SCRIPT_DIR/env-file.mjs" digest "$CANDIDATE_ENV")"
TOKEN_VERSION="$(node "$SCRIPT_DIR/env-file.mjs" fingerprint "$CANDIDATE_ENV" TOKEN_HASH_SECRET)"
LEDGER_RECORD="$(node -e 'console.log(JSON.stringify({status:"token_hash_rotated",configuration_digest:process.argv[1],secret_versions:{token_hash:process.argv[2]},impact:JSON.parse(process.argv[3]),rollback_target:process.argv[4],health_evidence:{internal:"passed"}}))' "$CONFIG_DIGEST" "$TOKEN_VERSION" "$IMPACT_JSON" "$REMOTE_BACKUP")"
printf '%s' "$LEDGER_RECORD" | ssh "${SSH_OPTS[@]}" "$REMOTE" "node '$CHAT_SERVER_DEPLOY_PATH/current/scripts/env-file.mjs' append-ledger '$CHAT_SERVER_DEPLOY_PATH/shared/release-transactions.jsonl'"
ssh "${SSH_OPTS[@]}" "$REMOTE" "ln -sfn '$CHAT_SERVER_DEPLOY_PATH/current/.env' '$CHAT_SERVER_DEPLOY_PATH/shared/.env'"
echo "Token-hash rotation $ROTATION_ID completed. Rollback environment retained at $REMOTE_BACKUP."
