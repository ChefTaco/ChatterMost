#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"
KNOWN_HOSTS_FILE="$REPO_ROOT/deploy/ssh_known_hosts"
PHASE=all
PHASE_EXPLICIT=0
MANIFEST=''
SKIP_TESTS=0
FORCE=0
WORK_DIR=''
ROLLBACK_TARGET=''
EXPECTED_CURRENT=''

cleanup() {
  if [[ -n "$WORK_DIR" && -d "$WORK_DIR" ]]; then rm -rf -- "$WORK_DIR"; fi
}
trap cleanup EXIT

usage() {
  cat <<'USAGE'
Usage:
  scripts/deploy.sh [--skip-tests] [--env-file <path>] [--force]
  scripts/deploy.sh --stage [--skip-tests] [--env-file <path>] [--force]
  scripts/deploy.sh --migrate --manifest <remote-release-manifest> [--env-file <path>]
  scripts/deploy.sh --activate --manifest <remote-release-manifest> [--env-file <path>]
  scripts/deploy.sh --rollback <native-release-id> --expected-current <native-release-id> [--env-file <path>]

--no-restart is retained as a deprecated alias for the non-mutating --stage phase.
USAGE
}

select_phase() {
  if [[ "$PHASE_EXPLICIT" == 1 ]]; then
    echo 'Choose only one of --stage, --migrate, or --activate.' >&2
    exit 2
  fi
  PHASE="$1"
  PHASE_EXPLICIT=1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage) select_phase stage; shift ;;
    --migrate) select_phase migrate; shift ;;
    --activate) select_phase activate; shift ;;
    --no-restart)
      select_phase stage
      echo 'Warning: --no-restart is deprecated; using the non-mutating --stage phase.' >&2
      shift
      ;;
    --manifest) MANIFEST="${2:-}"; shift 2 ;;
    --rollback) ROLLBACK_TARGET="${2:-}"; shift 2 ;;
    --expected-current) EXPECTED_CURRENT="${2:-}"; shift 2 ;;
    --skip-tests) SKIP_TESTS=1; shift ;;
    --force) FORCE=1; shift ;;
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ ! -f "$ENV_FILE" || "$(stat -c '%a' "$ENV_FILE")" != 600 ]]; then
  echo "$ENV_FILE must exist and be mode 600." >&2
  exit 1
fi
if [[ ! -s "$KNOWN_HOSTS_FILE" ]]; then
  echo "Missing pinned SSH trust file: $KNOWN_HOSTS_FILE" >&2
  exit 1
fi

while IFS= read -r -d '' name && IFS= read -r -d '' value; do
  printf -v "$name" '%s' "$value"
  export "$name"
done < <(node "$SCRIPT_DIR/env-file.mjs" emit-nul "$ENV_FILE")

: "${CHAT_SERVER_DEPLOY_USER:?CHAT_SERVER_DEPLOY_USER is required}"
: "${CHAT_SERVER_DEPLOY_HOST:?CHAT_SERVER_DEPLOY_HOST is required}"
: "${CHAT_SERVER_DEPLOY_PATH:?CHAT_SERVER_DEPLOY_PATH is required}"

REMOTE="${CHAT_SERVER_DEPLOY_USER}@${CHAT_SERVER_DEPLOY_HOST}"
SSH_KEY_PATH="${CHAT_SERVER_DEPLOY_SSH_KEY:-$HOME/.ssh/chattermost_deploy_ed25519}"
SSH_OPTS=(-o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$KNOWN_HOSTS_FILE" -o HostKeyAlgorithms=ssh-ed25519)
if [[ -f "$SSH_KEY_PATH" ]]; then SSH_OPTS=(-i "$SSH_KEY_PATH" "${SSH_OPTS[@]}"); fi

remote_sudo() {
  local command="$1"
  if [[ -n "${CHAT_SERVER_DEPLOY_SUDO_PASSWORD:-}" ]]; then
    printf '%s\n' "$CHAT_SERVER_DEPLOY_SUDO_PASSWORD" | ssh "${SSH_OPTS[@]}" "$REMOTE" "sudo -S -p '' bash -lc $(printf '%q' "$command")"
  else
    ssh "${SSH_OPTS[@]}" "$REMOTE" "sudo bash -lc $(printf '%q' "$command")"
  fi
}

if [[ -n "$ROLLBACK_TARGET" || -n "$EXPECTED_CURRENT" ]]; then
  [[ -n "$ROLLBACK_TARGET" && -n "$EXPECTED_CURRENT" && "$PHASE" == all ]] || { echo 'Rollback requires both native release IDs and no phase.' >&2; exit 2; }
  [[ "$ROLLBACK_TARGET" =~ ^[0-9]{14}-[a-f0-9]{7,40}-[a-f0-9]{12}$ && "$EXPECTED_CURRENT" =~ ^[0-9]{14}-[a-f0-9]{7,40}-[a-f0-9]{12}$ ]] || { echo 'Invalid native release ID.' >&2; exit 2; }
  remote_sudo "bash '$CHAT_SERVER_DEPLOY_PATH/current/scripts/rollback-release.sh' '$CHAT_SERVER_DEPLOY_PATH' '$EXPECTED_CURRENT' '$ROLLBACK_TARGET'"
  exit 0
fi

validate_manifest_argument() {
  if [[ -z "$MANIFEST" ]]; then
    echo "--$PHASE requires --manifest." >&2
    exit 2
  fi
  case "$MANIFEST" in
    "$CHAT_SERVER_DEPLOY_PATH"/releases/*/release-manifest.json) ;;
    *) echo 'Manifest must be a release manifest under the configured deploy path.' >&2; exit 2 ;;
  esac
  if [[ ! "$MANIFEST" =~ ^[A-Za-z0-9._/-]+$ ]]; then
    echo 'Manifest path contains unsupported characters.' >&2
    exit 2
  fi
}

run_transaction() {
  local phase="$1" manifest="$2" release_root
  release_root="${manifest%/release-manifest.json}"
  if ! ssh "${SSH_OPTS[@]}" "$REMOTE" "node -e 'process.exit(Number(process.versions.node.split(\".\")[0]) >= 22 ? 0 : 1)'" >/dev/null 2>&1; then
    echo 'Node.js 22+ is required on the deployment target before migration or activation.' >&2
    exit 1
  fi
  remote_sudo "env CHATTERMOST_MANIFEST='$manifest' '$release_root/scripts/release-transaction.sh' '$phase'"
}

if [[ "$PHASE" == migrate || "$PHASE" == activate ]]; then
  validate_manifest_argument
  run_transaction "$PHASE" "$MANIFEST"
  echo "Completed ChatterMost $PHASE phase for $MANIFEST"
  exit 0
fi
if [[ -n "$MANIFEST" ]]; then
  echo '--manifest is valid only with --migrate or --activate.' >&2
  exit 2
fi

: "${CHAT_SERVER_URL:?CHAT_SERVER_URL is required}"
: "${CHAT_SERVER_ADMIN_USERNAME:?CHAT_SERVER_ADMIN_USERNAME is required}"
: "${CHAT_SERVER_ADMIN_PASSWORD:?CHAT_SERVER_ADMIN_PASSWORD is required}"

reject_placeholder_secret() {
  local name="$1" value="$2"
  case "$value" in
    replace-with-*|change-this-*|changeme|change-me|password|admin|secret)
      echo "$name must be replaced with a unique production secret before deployment" >&2
      exit 1
      ;;
  esac
}
reject_placeholder_secret CHAT_SERVER_ADMIN_PASSWORD "$CHAT_SERVER_ADMIN_PASSWORD"

if git -C "$REPO_ROOT" rev-parse --is-work-tree >/dev/null 2>&1; then
  if [[ "$FORCE" != 1 ]] && ! git -C "$REPO_ROOT" diff --quiet --ignore-submodules --; then
    echo 'Worktree has uncommitted changes. Use --force to deploy anyway.' >&2
    exit 1
  fi
fi

BUILD_HASH="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || printf unknown)"
SOURCE_REVISION="$(git -C "$REPO_ROOT" rev-parse HEAD)"
BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
RELEASE_ID="$(date -u +%Y%m%d%H%M%S)-${BUILD_HASH}-$(openssl rand -hex 6)"
REMOTE_RELEASE="$CHAT_SERVER_DEPLOY_PATH/releases/$RELEASE_ID"
REMOTE_MANIFEST="$REMOTE_RELEASE/release-manifest.json"

cert_host_from_url() {
  local host="${CHAT_SERVER_URL#http://}"
  host="${host#https://}"; host="${host%%/*}"; host="${host%%:*}"
  printf '%s' "$host"
}

TLS_ENABLED=0
if [[ "${CHAT_SERVER_USE_TLS:-}" =~ ^(1|true)$ || "${CHAT_SERVER_DEPLOY_TAILSCALE:-}" =~ ^(1|true)$ ]]; then TLS_ENABLED=1; fi
REMOTE_APP_PORT="${CHAT_SERVER_INTERNAL_PORT:-}"
if [[ -z "$REMOTE_APP_PORT" ]]; then
  if [[ "$TLS_ENABLED" == 1 ]]; then REMOTE_APP_PORT=8065; else REMOTE_APP_PORT="${CHAT_SERVER_PORT:-8065}"; fi
fi
PREFLIGHT_PORT="${CHAT_SERVER_PREFLIGHT_PORT:-29065}"
URL_HOSTPORT="${CHAT_SERVER_URL#http://}"; URL_HOSTPORT="${URL_HOSTPORT#https://}"; URL_HOSTPORT="${URL_HOSTPORT%%/*}"
REMOTE_TLS_PORT="${CHAT_SERVER_TLS_PORT:-}"
if [[ -z "$REMOTE_TLS_PORT" ]]; then if [[ "$URL_HOSTPORT" == *:* ]]; then REMOTE_TLS_PORT="${URL_HOSTPORT##*:}"; else REMOTE_TLS_PORT=443; fi; fi
TAILSCALE_CERT_HOST="${CHAT_SERVER_DEPLOY_TAILSCALE_CERT:-}"
if [[ -z "$TAILSCALE_CERT_HOST" || "$TAILSCALE_CERT_HOST" =~ ^(1|true)$ ]]; then TAILSCALE_CERT_HOST="$(cert_host_from_url)"; fi

umask 077
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/chattermost-deploy.XXXXXX")"
ESTABLISHED_ENV="$WORK_DIR/established.env"
RUNTIME_ENV_FILE="$WORK_DIR/runtime.env"
MANIFEST_FILE="$WORK_DIR/release-manifest.json"
ARTIFACT="$WORK_DIR/chattermost-$RELEASE_ID.tar.gz"

REMOTE_INSTALL_STATE="$(ssh "${SSH_OPTS[@]}" "$REMOTE" "if [[ -e '$CHAT_SERVER_DEPLOY_PATH/current' || -f '$CHAT_SERVER_DEPLOY_PATH/shared/.env' ]]; then printf established; else printf first-install; fi")"
if [[ "$REMOTE_INSTALL_STATE" == established ]]; then
  if ! ssh "${SSH_OPTS[@]}" "$REMOTE" "if [[ -r '$CHAT_SERVER_DEPLOY_PATH/current/.env' ]]; then cat '$CHAT_SERVER_DEPLOY_PATH/current/.env'; elif [[ -r '$CHAT_SERVER_DEPLOY_PATH/shared/.env' ]]; then cat '$CHAT_SERVER_DEPLOY_PATH/shared/.env'; else exit 42; fi" > "$ESTABLISHED_ENV"; then
    echo 'Established deployment is missing a readable release environment; refusing implicit secret replacement.' >&2
    exit 1
  fi
  chmod 600 "$ESTABLISHED_ENV"
fi

established_secret() {
  local runtime_name="$1" local_name="$2" supplied="$3" existing=''
  if [[ "$REMOTE_INSTALL_STATE" == established ]]; then
    if ! existing="$(node "$SCRIPT_DIR/env-file.mjs" get "$ESTABLISHED_ENV" "$runtime_name")" || [[ -z "$existing" ]]; then
      echo "Established deployment is missing a readable $runtime_name; refusing to rotate it implicitly." >&2
      echo 'Use the explicit secret rotation workflow.' >&2
      exit 1
    fi
    if [[ -n "$supplied" && "$supplied" != "$existing" ]]; then
      echo "Local $local_name differs from the established value; routine deploy cannot rotate it." >&2
      echo 'Use the explicit secret rotation workflow.' >&2
      exit 1
    fi
    printf '%s' "$existing"
  elif [[ -n "$supplied" ]]; then
    printf '%s' "$supplied"
  else
    openssl rand -hex 32
  fi
}

REMOTE_POSTGRES_PASSWORD="$(established_secret POSTGRES_PASSWORD CHAT_SERVER_POSTGRES_PASSWORD "${CHAT_SERVER_POSTGRES_PASSWORD:-}")"
REMOTE_COOKIE_SECRET="$(established_secret COOKIE_SECRET CHAT_SERVER_COOKIE_SECRET "${CHAT_SERVER_COOKIE_SECRET:-}")"
REMOTE_TOKEN_HASH_SECRET="$(established_secret TOKEN_HASH_SECRET CHAT_SERVER_TOKEN_HASH_SECRET "${CHAT_SERVER_TOKEN_HASH_SECRET:-}")"
if [[ ! "$REMOTE_POSTGRES_PASSWORD" =~ ^[A-Za-z0-9._~-]+$ ]]; then
  echo 'CHAT_SERVER_POSTGRES_PASSWORD must use URL-safe characters.' >&2
  exit 1
fi
reject_placeholder_secret CHAT_SERVER_POSTGRES_PASSWORD "$REMOTE_POSTGRES_PASSWORD"
reject_placeholder_secret CHAT_SERVER_COOKIE_SECRET "$REMOTE_COOKIE_SECRET"
reject_placeholder_secret CHAT_SERVER_TOKEN_HASH_SECRET "$REMOTE_TOKEN_HASH_SECRET"

cd "$REPO_ROOT"
while IFS= read -r -d '' name && IFS= read -r -d '' value; do
  printf -v "DEPLOY_$name" '%s' "$value"
  export "DEPLOY_$name"
done < <(node "$SCRIPT_DIR/schema-policy.mjs" emit-nul "$REPO_ROOT")
if [[ ${COUNCIL_CODE_RELEASE:-0} == 1 ]]; then
  CURRENT_SCHEMA="$(ssh "${SSH_OPTS[@]}" "$REMOTE" "node -e 'const fs=require(\"node:fs\");const p=\"$CHAT_SERVER_DEPLOY_PATH/current/release-manifest.json\";const x=JSON.parse(fs.readFileSync(p));process.stdout.write(x.schema.migration_set_digest)'" 2>/dev/null || true)"
  [[ -n "$CURRENT_SCHEMA" && "$CURRENT_SCHEMA" == "$DEPLOY_MIGRATION_SET_DIGEST" ]] || {
    echo 'Council code-only release requires an unchanged migration set' >&2
    exit 1
  }
fi
LOCK_BEFORE="$(sha256sum package-lock.json | cut -d' ' -f1)"
npm ci
LOCK_AFTER="$(sha256sum package-lock.json | cut -d' ' -f1)"
if [[ "$LOCK_BEFORE" != "$LOCK_AFTER" ]]; then
  echo 'npm ci changed package-lock.json; refusing a non-reproducible deployment.' >&2
  exit 1
fi
if [[ "$SKIP_TESTS" != 1 ]]; then npm run typecheck; npm run lint; npm run test:unit; fi
npm run build
tar --exclude='./.git' --exclude='./data' --exclude='./output' --exclude='./playwright-report' --exclude='./test-results' --exclude='./.env' --exclude='./.env.*' --exclude='./deploy/ssh_known_hosts' --exclude='./mmcli_linux_bin' --exclude='./ethersage.project.yaml' --exclude='./private' --exclude='./backups' --exclude='./shared' --exclude='./releases' --exclude='./.playwright-cli' -czf "$ARTIFACT" .
CODE_DIGEST="$(sha256sum "$ARTIFACT" | cut -d' ' -f1)"

export DEPLOY_RUNTIME_PORT="$REMOTE_APP_PORT" DEPLOY_POSTGRES_PASSWORD="$REMOTE_POSTGRES_PASSWORD" DEPLOY_COOKIE_SECRET="$REMOTE_COOKIE_SECRET" DEPLOY_TOKEN_HASH_SECRET="$REMOTE_TOKEN_HASH_SECRET"
export DEPLOY_BUILD_HASH="$BUILD_HASH" DEPLOY_BUILD_DATE="$BUILD_DATE" DEPLOY_RELEASE_ID="$RELEASE_ID"
node "$SCRIPT_DIR/env-file.mjs" render-runtime "$RUNTIME_ENV_FILE"
CONFIG_DIGEST="$(node "$SCRIPT_DIR/env-file.mjs" digest "$RUNTIME_ENV_FILE")"
POSTGRES_VERSION="$(node "$SCRIPT_DIR/env-file.mjs" fingerprint "$RUNTIME_ENV_FILE" POSTGRES_PASSWORD)"
COOKIE_VERSION="$(node "$SCRIPT_DIR/env-file.mjs" fingerprint "$RUNTIME_ENV_FILE" COOKIE_SECRET)"
TOKEN_VERSION="$(node "$SCRIPT_DIR/env-file.mjs" fingerprint "$RUNTIME_ENV_FILE" TOKEN_HASH_SECRET)"

export DEPLOY_RELEASE_PATH="$REMOTE_RELEASE" DEPLOY_CODE_DIGEST="$CODE_DIGEST" DEPLOY_CONFIG_DIGEST="$CONFIG_DIGEST"
export DEPLOY_POSTGRES_VERSION="$POSTGRES_VERSION" DEPLOY_COOKIE_VERSION="$COOKIE_VERSION" DEPLOY_TOKEN_VERSION="$TOKEN_VERSION"
export DEPLOY_PREFLIGHT_PORT="$PREFLIGHT_PORT" DEPLOY_TLS_ENABLED="$TLS_ENABLED" DEPLOY_TLS_PORT="$REMOTE_TLS_PORT" DEPLOY_TAILSCALE_CERT_HOST="$TAILSCALE_CERT_HOST"
node "$SCRIPT_DIR/release-manifest.mjs" create "$MANIFEST_FILE"

REMOTE_STAGE="$CHAT_SERVER_DEPLOY_PATH/releases/.stage-$RELEASE_ID"
ssh "${SSH_OPTS[@]}" "$REMOTE" "mkdir -p '$CHAT_SERVER_DEPLOY_PATH/releases'; [[ ! -e '$REMOTE_RELEASE' && ! -e '$REMOTE_STAGE' ]]; mkdir '$REMOTE_STAGE'"
ssh "${SSH_OPTS[@]}" "$REMOTE" "umask 077; cat > '$REMOTE_STAGE/.artifact.tar.gz'" < "$ARTIFACT"
ssh "${SSH_OPTS[@]}" "$REMOTE" "umask 077; cat > '$REMOTE_STAGE/.env'" < "$RUNTIME_ENV_FILE"
ssh "${SSH_OPTS[@]}" "$REMOTE" "umask 077; cat > '$REMOTE_STAGE/release-manifest.json'" < "$MANIFEST_FILE"
REMOTE_DIGEST="$(ssh "${SSH_OPTS[@]}" "$REMOTE" "sha256sum '$REMOTE_STAGE/.artifact.tar.gz' | cut -d' ' -f1")"
if [[ "$REMOTE_DIGEST" != "$CODE_DIGEST" ]]; then
  echo 'Remote artifact digest mismatch.' >&2
  exit 1
fi
ssh "${SSH_OPTS[@]}" "$REMOTE" "tar -xzf '$REMOTE_STAGE/.artifact.tar.gz' -C '$REMOTE_STAGE'; printf '%s\\n' '$SOURCE_REVISION' > '$REMOTE_STAGE/SOURCE_REVISION'; chmod -R a-w '$REMOTE_STAGE'; chmod 400 '$REMOTE_STAGE/.artifact.tar.gz' '$REMOTE_STAGE/release-manifest.json' '$REMOTE_STAGE/SOURCE_REVISION'; chmod 600 '$REMOTE_STAGE/.env'; mv '$REMOTE_STAGE' '$REMOTE_RELEASE'; node '$REMOTE_RELEASE/scripts/release-manifest.mjs' verify '$REMOTE_MANIFEST'; [[ \"\$(stat -c '%a' '$REMOTE_RELEASE/.env')\" == 600 ]]; [[ \"\$(node '$REMOTE_RELEASE/scripts/env-file.mjs' digest '$REMOTE_RELEASE/.env')\" == '$CONFIG_DIGEST' ]]"

echo "Staged immutable ChatterMost release $RELEASE_ID"
echo "Manifest: $REMOTE_MANIFEST"
if [[ "$PHASE" == stage ]]; then
  printf '{"status":"staged","nativeReleaseId":"%s","revision":"%s","artifactSha256":"%s","sideEffect":"remote-release-staged"}\n' "$RELEASE_ID" "$SOURCE_REVISION" "$CODE_DIGEST"
  exit 0
fi

PREVIOUS_RELEASE="$(ssh "${SSH_OPTS[@]}" "$REMOTE" "readlink -f '$CHAT_SERVER_DEPLOY_PATH/current' 2>/dev/null || true")"
PREVIOUS_ARTIFACT_SHA=""
if [[ -n "$PREVIOUS_RELEASE" ]]; then
  PREVIOUS_ARTIFACT_SHA="$(ssh "${SSH_OPTS[@]}" "$REMOTE" "sha256sum '$PREVIOUS_RELEASE/.artifact.tar.gz' 2>/dev/null | cut -d' ' -f1" || true)"
fi
run_transaction all "$REMOTE_MANIFEST"
INSTALLED_REVISION="$(ssh "${SSH_OPTS[@]}" "$REMOTE" "test \"\$(readlink -f '$CHAT_SERVER_DEPLOY_PATH/current')\" = '$REMOTE_RELEASE' && cat '$REMOTE_RELEASE/SOURCE_REVISION'")"
[[ "$INSTALLED_REVISION" == "$SOURCE_REVISION" ]] || { echo 'Installed source revision differs after activation.' >&2; exit 1; }
echo "Deployed ChatterMost release $RELEASE_ID to $CHAT_SERVER_DEPLOY_HOST (artifact $CODE_DIGEST, config $CONFIG_DIGEST)"
printf '{"status":"deployed","nativeReleaseId":"%s","revision":"%s","installedRevision":"%s","artifactSha256":"%s","backup":"%s","backupSha256":"%s","previousReleaseId":"%s","health":"passed","functionalFlows":["public-config-client"],"rollbackCommand":"bash scripts/deploy.sh --rollback %s --expected-current %s"}\n' "$RELEASE_ID" "$SOURCE_REVISION" "$INSTALLED_REVISION" "$CODE_DIGEST" "$PREVIOUS_RELEASE" "$PREVIOUS_ARTIFACT_SHA" "${PREVIOUS_RELEASE##*/}" "${PREVIOUS_RELEASE##*/}" "$RELEASE_ID"
