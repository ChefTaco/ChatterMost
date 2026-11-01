#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

PHASE="${1:-all}"
: "${CHATTERMOST_MANIFEST:?}"
case "$PHASE" in
  all|migrate|activate) ;;
  *) echo "Unknown release transaction phase: $PHASE" >&2; exit 2 ;;
esac

RELEASE_ROOT="$(cd "$(dirname "$CHATTERMOST_MANIFEST")" && pwd)"
node "$RELEASE_ROOT/scripts/release-manifest.mjs" verify "$CHATTERMOST_MANIFEST"
while IFS= read -r -d '' name && IFS= read -r -d '' value; do
  printf -v "$name" '%s' "$value"
done < <(node "$RELEASE_ROOT/scripts/release-manifest.mjs" emit-nul "$CHATTERMOST_MANIFEST")

[[ "$RELEASE_ROOT" == "$RELEASE_PATH" ]]
[[ "$(sha256sum "$RELEASE_PATH/.artifact.tar.gz" | cut -d' ' -f1)" == "$CODE_DIGEST" ]]
[[ "$(node "$RELEASE_PATH/scripts/env-file.mjs" digest "$RELEASE_PATH/.env")" == "$CONFIG_DIGEST" ]]

exec 9>"$DEPLOY_PATH/.deploy.lock"
if ! flock -n 9; then
  echo 'Another ChatterMost deployment transaction is active; refusing this transaction.' >&2
  exit 73
fi
mkdir -p "$DEPLOY_PATH/shared/deployment-state" "$DEPLOY_PATH/shared/files" "$DEPLOY_PATH/shared/profile-images"
chmod 700 "$DEPLOY_PATH/shared/deployment-state"
printf '%s\n' "$RELEASE_ID" > "$DEPLOY_PATH/shared/deployment-state/active"
chmod 600 "$DEPLOY_PATH/shared/deployment-state/active"
cleanup() {
  rm -f -- "$DEPLOY_PATH/shared/deployment-state/active"
}
trap cleanup EXIT

migrate() {
  docker ps --filter publish=55432 -q | xargs -r docker rm -f
  cd "$RELEASE_PATH"
  docker compose -p chattermost --env-file .env up -d postgres
  env \
    CHATTERMOST_RELEASE="$RELEASE_PATH" \
    CHATTERMOST_DEPLOY_PATH="$DEPLOY_PATH" \
    CHATTERMOST_DEPLOY_USER="$DEPLOY_USER" \
    MIGRATION_POLICY="$MIGRATION_POLICY" \
    MIGRATION_SET_DIGEST="$MIGRATION_SET_DIGEST" \
    SCHEMA_LINEAGE_ALGORITHM="$SCHEMA_LINEAGE_ALGORITHM" \
    SCHEMA_LINEAGE_DIGEST="$SCHEMA_LINEAGE_DIGEST" \
    SCHEMA_LINEAGE_DEPTH="$SCHEMA_LINEAGE_DEPTH" \
    LEGACY_UNTRACKED_SCHEMA_DIGEST="$LEGACY_UNTRACKED_SCHEMA_DIGEST" \
    REPAIRED_SCHEMA_DIGEST="$REPAIRED_SCHEMA_DIGEST" \
    "$RELEASE_PATH/scripts/migrate-release.sh"
  printf '%s\n' "$MANIFEST_INTEGRITY" > "$DEPLOY_PATH/shared/deployment-state/$RELEASE_ID.migrated"
  chmod 600 "$DEPLOY_PATH/shared/deployment-state/$RELEASE_ID.migrated"
}

activate() {
  local migration_marker="$DEPLOY_PATH/shared/deployment-state/$RELEASE_ID.migrated"
  if [[ ! -f "$migration_marker" || "$(< "$migration_marker")" != "$MANIFEST_INTEGRITY" ]]; then
    echo "Release $RELEASE_ID has no matching successful migration phase." >&2
    exit 1
  fi

  local preflight_env preflight_log preflight_pid
  preflight_env="$(mktemp "${TMPDIR:-/tmp}/chattermost-preflight-env.XXXXXX")"
  preflight_log="$(mktemp "${TMPDIR:-/tmp}/chattermost-preflight-log.XXXXXX")"
  node "$RELEASE_PATH/scripts/env-file.mjs" render-preflight "$RELEASE_PATH/.env" "$preflight_env" "$PREFLIGHT_PORT"
  (
    cd "$RELEASE_PATH"
    exec env CHATTERMOST_ENV_FILE="$preflight_env" node dist/src/server/index.js > "$preflight_log" 2>&1
  ) &
  preflight_pid=$!
  trap 'kill "$preflight_pid" 2>/dev/null || true; rm -f -- "$preflight_env" "$preflight_log"; cleanup' EXIT
  for attempt in {1..30}; do
    if curl -fsS "http://127.0.0.1:$PREFLIGHT_PORT/api/v4/system/ping" >/dev/null; then break; fi
    if [[ "$attempt" == 30 ]]; then cat "$preflight_log" >&2; exit 1; fi
    sleep 1
  done
  kill "$preflight_pid"
  wait "$preflight_pid" 2>/dev/null || true
  rm -f -- "$preflight_env" "$preflight_log"
  trap cleanup EXIT

  local infrastructure_root infrastructure_release nginx_test_config
  infrastructure_root="$DEPLOY_PATH/shared/infrastructure"
  infrastructure_release="$infrastructure_root/releases/$RELEASE_ID"
  install -d -m 0755 "$infrastructure_root/releases"
  install -d -m 0755 "$infrastructure_release"
  sed "s#__DEPLOY_PATH__#$DEPLOY_PATH#g; s#__DEPLOY_USER__#$DEPLOY_USER#g" \
    "$RELEASE_PATH/deploy/chattermost.service" > "$infrastructure_release/chattermost.service"
  chmod 0644 "$infrastructure_release/chattermost.service"
  systemd-analyze verify "$infrastructure_release/chattermost.service"
  if [[ "$TAILSCALE_ENABLED" == 1 ]] && command -v tailscale >/dev/null 2>&1; then
    tailscale cert "$TAILSCALE_CERT_HOST"
  fi
  if [[ "$TLS_ENABLED" == 1 ]]; then
    command -v nginx >/dev/null 2>&1 || { echo 'nginx must be installed before TLS release activation.' >&2; exit 1; }
    sed "s#__TAILSCALE_HOST__#$TAILSCALE_CERT_HOST#g; s#__APP_PORT__#$INTERNAL_PORT#g; s#__TLS_PORT__#$TLS_PORT#g" \
      "$RELEASE_PATH/deploy/nginx.conf" > "$infrastructure_release/nginx.conf"
    chmod 0644 "$infrastructure_release/nginx.conf"
    nginx_test_config="$(mktemp "${TMPDIR:-/tmp}/chattermost-nginx-test.XXXXXX")"
    {
      printf '%s\n' "pid ${TMPDIR:-/tmp}/chattermost-nginx-test-$$.pid;"
      printf '%s\n' 'error_log stderr;'
      printf '%s\n' 'events {}'
      printf '%s\n' 'http {'
      printf '%s\n' '  include /etc/nginx/mime.types;'
      printf '  include %s;\n' "$infrastructure_release/nginx.conf"
      printf '%s\n' '}'
    } > "$nginx_test_config"
    nginx -t -c "$nginx_test_config"
    rm -f -- "$nginx_test_config"
  fi
  chmod -R a-w "$infrastructure_release"

  env \
    CHATTERMOST_DEPLOY_PATH="$DEPLOY_PATH" \
    CHATTERMOST_DEPLOY_USER="$DEPLOY_USER" \
    CHATTERMOST_RELEASE="$RELEASE_PATH" \
    CHATTERMOST_INTERNAL_PORT="$INTERNAL_PORT" \
    CHATTERMOST_PUBLIC_URL="$PUBLIC_URL" \
    CHATTERMOST_CODE_DIGEST="$CODE_DIGEST" \
    CHATTERMOST_CONFIG_DIGEST="$CONFIG_DIGEST" \
    CHATTERMOST_POSTGRES_VERSION="$POSTGRES_VERSION" \
    CHATTERMOST_COOKIE_VERSION="$COOKIE_VERSION" \
    CHATTERMOST_TOKEN_VERSION="$TOKEN_VERSION" \
    CHATTERMOST_SCHEMA_GENERATION="$SCHEMA_GENERATION" \
    CHATTERMOST_MIGRATION_SET_DIGEST="$MIGRATION_SET_DIGEST" \
    CHATTERMOST_SCHEMA_LINEAGE_DIGEST="$SCHEMA_LINEAGE_DIGEST" \
    CHATTERMOST_INFRASTRUCTURE_RELEASE="$infrastructure_release" \
    CHATTERMOST_TLS_ENABLED="$TLS_ENABLED" \
    "$RELEASE_PATH/scripts/activate-release.sh"
  ln -sfn "$DEPLOY_PATH/current/.env" "$DEPLOY_PATH/shared/.env"
}

case "$PHASE" in
  migrate) migrate ;;
  activate) activate ;;
  all) migrate; activate ;;
esac
