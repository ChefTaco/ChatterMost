#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'
umask 077

ENV_FILE="${1:-.env}"
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

BACKUP_DIR="${BACKUP_DIR:-./data/backups/$(date -u +%Y%m%d%H%M%S)}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-chattermost}"
mkdir -p -m 700 "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

docker compose -p "$COMPOSE_PROJECT_NAME" --env-file "$ENV_FILE" exec -T postgres pg_dump -U chattermost_app chattermost > "$BACKUP_DIR/postgres.sql"
storage_paths=()
for storage_path in "${FILE_STORAGE_PATH:-./data/files}" "${PROFILE_IMAGE_STORAGE_PATH:-./data/profile-images}"; do
  if [[ -e "$storage_path" ]]; then
    storage_paths+=("$storage_path")
  fi
done
if ((${#storage_paths[@]})); then
  tar -czf "$BACKUP_DIR/files.tar.gz" -- "${storage_paths[@]}"
else
  tar -czf "$BACKUP_DIR/files.tar.gz" --files-from /dev/null
fi
cp "$ENV_FILE" "$BACKUP_DIR/env.redacted"
sed -i -E 's/^([A-Za-z_][A-Za-z0-9_]*(PASSWORD|SECRET|TOKEN)[A-Za-z0-9_]*)=.*/\1=<redacted>/g' "$BACKUP_DIR/env.redacted"
chmod 600 "$BACKUP_DIR"/*
echo "Backup written to $BACKUP_DIR"
