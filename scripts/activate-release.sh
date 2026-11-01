#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

: "${CHATTERMOST_DEPLOY_PATH:?}"
: "${CHATTERMOST_DEPLOY_USER:?}"
: "${CHATTERMOST_RELEASE:?}"
: "${CHATTERMOST_INTERNAL_PORT:?}"
: "${CHATTERMOST_PUBLIC_URL:?}"
: "${CHATTERMOST_CODE_DIGEST:?}"
: "${CHATTERMOST_CONFIG_DIGEST:?}"
: "${CHATTERMOST_SCHEMA_GENERATION:?}"
: "${CHATTERMOST_MIGRATION_SET_DIGEST:?}"
: "${CHATTERMOST_SCHEMA_LINEAGE_DIGEST:?}"
: "${CHATTERMOST_INFRASTRUCTURE_RELEASE:?}"
: "${CHATTERMOST_TLS_ENABLED:?}"

CURRENT="$CHATTERMOST_DEPLOY_PATH/current"
LEDGER="$CHATTERMOST_DEPLOY_PATH/shared/release-transactions.jsonl"
PREVIOUS=''
if [[ -L "$CURRENT" ]]; then
  PREVIOUS="$(readlink -f "$CURRENT")"
fi
INFRASTRUCTURE_ROOT="$CHATTERMOST_DEPLOY_PATH/shared/infrastructure"
LEGACY_INFRASTRUCTURE="$INFRASTRUCTURE_ROOT/legacy"
mkdir -p "$LEGACY_INFRASTRUCTURE"
PREVIOUS_SYSTEMD=''
PREVIOUS_NGINX_AVAILABLE=''
PREVIOUS_NGINX_ENABLED=''

snapshot_infrastructure_path() {
  local target="$1" label="$2" destination=''
  if [[ -L "$target" ]]; then
    readlink -f "$target"
    return
  fi
  if [[ -f "$target" ]]; then
    destination="$LEGACY_INFRASTRUCTURE/${label}-$(date -u +%Y%m%d%H%M%S)-$$"
    install -m 0644 "$target" "$destination"
    printf '%s' "$destination"
  fi
}

switch_link() {
  local target="$1" destination="$2"
  local next="${destination}.next-$PPID-$RANDOM"
  ln -s "$target" "$next"
  mv -Tf "$next" "$destination"
}

restore_link() {
  local previous="$1" destination="$2"
  if [[ -n "$previous" ]]; then
    switch_link "$previous" "$destination"
  else
    rm -f -- "$destination"
  fi
}

switch_current() {
  local target="$1"
  local next="$CHATTERMOST_DEPLOY_PATH/.current-$PPID-$RANDOM"
  ln -s "$target" "$next"
  mv -Tf "$next" "$CURRENT"
}

append_ledger() {
  local status="$1"
  local internal_health="$2"
  local public_health="$3"
  STATUS="$status" INTERNAL_HEALTH="$internal_health" PUBLIC_HEALTH="$public_health" PREVIOUS_RELEASE="$PREVIOUS" \
    node --input-type=module - "$LEDGER" <<'NODE'
import { appendFile, chmod } from 'node:fs/promises';
const [ledger] = process.argv.slice(2);
const record = {
  recorded_at: new Date().toISOString(),
  release_id: process.env.CHATTERMOST_RELEASE.split('/').pop(),
  status: process.env.STATUS,
  code_digest: process.env.CHATTERMOST_CODE_DIGEST,
  configuration_digest: process.env.CHATTERMOST_CONFIG_DIGEST,
  migration_state: 'applied',
  schema: {
    generation: Number(process.env.CHATTERMOST_SCHEMA_GENERATION),
    migration_set_digest: process.env.CHATTERMOST_MIGRATION_SET_DIGEST,
    lineage_digest: process.env.CHATTERMOST_SCHEMA_LINEAGE_DIGEST
  },
  secret_versions: {
    postgres: process.env.CHATTERMOST_POSTGRES_VERSION,
    cookie: process.env.CHATTERMOST_COOKIE_VERSION,
    token_hash: process.env.CHATTERMOST_TOKEN_VERSION
  },
  health_evidence: {
    internal: process.env.INTERNAL_HEALTH,
    public: process.env.PUBLIC_HEALTH
  },
  rollback_target: process.env.PREVIOUS_RELEASE || null
};
await appendFile(ledger, JSON.stringify(record) + '\n', { mode: 0o600 });
await chmod(ledger, 0o600);
NODE
  chown "$CHATTERMOST_DEPLOY_USER" "$LEDGER"
}

rollback() {
  trap - ERR
  if [[ -n "$PREVIOUS" ]]; then
    "$CHATTERMOST_RELEASE/scripts/schema-policy.mjs" rollback-compatible "$PREVIOUS" "$CHATTERMOST_RELEASE" "$CHATTERMOST_SCHEMA_GENERATION" "$CHATTERMOST_MIGRATION_SET_DIGEST" "$CHATTERMOST_SCHEMA_LINEAGE_DIGEST" || {
      append_ledger rollback_refused pending pending || true
      echo 'Automatic application rollback refused: previous release does not support the migrated schema.' >&2
      exit 1
    }
  fi
  restore_link "$PREVIOUS_SYSTEMD" /etc/systemd/system/chattermost.service
  if [[ "$CHATTERMOST_TLS_ENABLED" == 1 ]]; then
    restore_link "$PREVIOUS_NGINX_AVAILABLE" /etc/nginx/sites-available/chattermost
    restore_link "$PREVIOUS_NGINX_ENABLED" /etc/nginx/sites-enabled/chattermost
  fi
  systemctl daemon-reload || true
  if [[ "$CHATTERMOST_TLS_ENABLED" == 1 ]]; then systemctl reload nginx || true; fi
  append_ledger rollback pending pending || true
  if [[ -n "$PREVIOUS" ]]; then
    switch_current "$PREVIOUS"
    systemctl restart chattermost.service || true
  fi
  exit 1
}
trap rollback ERR

if [[ -n "$PREVIOUS" ]]; then
  "$CHATTERMOST_RELEASE/scripts/schema-policy.mjs" rollback-compatible "$PREVIOUS" "$CHATTERMOST_RELEASE" "$CHATTERMOST_SCHEMA_GENERATION" "$CHATTERMOST_MIGRATION_SET_DIGEST" "$CHATTERMOST_SCHEMA_LINEAGE_DIGEST"
fi
PREVIOUS_SYSTEMD="$(snapshot_infrastructure_path /etc/systemd/system/chattermost.service systemd)"
switch_link "$CHATTERMOST_INFRASTRUCTURE_RELEASE/chattermost.service" /etc/systemd/system/chattermost.service
if [[ "$CHATTERMOST_TLS_ENABLED" == 1 ]]; then
  PREVIOUS_NGINX_AVAILABLE="$(snapshot_infrastructure_path /etc/nginx/sites-available/chattermost nginx-available)"
  PREVIOUS_NGINX_ENABLED="$(snapshot_infrastructure_path /etc/nginx/sites-enabled/chattermost nginx-enabled)"
  switch_link "$CHATTERMOST_INFRASTRUCTURE_RELEASE/nginx.conf" /etc/nginx/sites-available/chattermost
  switch_link "$CHATTERMOST_INFRASTRUCTURE_RELEASE/nginx.conf" /etc/nginx/sites-enabled/chattermost
fi
systemctl daemon-reload
if [[ "$CHATTERMOST_TLS_ENABLED" == 1 ]]; then
  nginx -t
  systemctl reload nginx
fi
switch_current "$CHATTERMOST_RELEASE"
systemctl restart chattermost.service
for attempt in {1..30}; do
  if curl -fsS "http://127.0.0.1:${CHATTERMOST_INTERNAL_PORT}/api/v4/system/ping" >/dev/null; then
    break
  fi
  [[ "$attempt" == 30 ]] && exit 1
  sleep 1
done
curl -fsS "${CHATTERMOST_PUBLIC_URL%/}/api/v4/system/ping" >/dev/null
curl -fsS "${CHATTERMOST_PUBLIC_URL%/}/api/v4/config/client" >/dev/null
trap - ERR
append_ledger activated passed passed
