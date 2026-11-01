#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${1:-$REPO_ROOT/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

while IFS= read -r -d '' name && IFS= read -r -d '' value; do
  printf -v "$name" '%s' "$value"
  export "$name"
done < <(node "$SCRIPT_DIR/env-file.mjs" emit-nul "$ENV_FILE")

: "${CHAT_SERVER_DEPLOY_USER:?CHAT_SERVER_DEPLOY_USER is required}"
: "${CHAT_SERVER_DEPLOY_HOST:?CHAT_SERVER_DEPLOY_HOST is required}"

KEY_PATH="${CHAT_SERVER_DEPLOY_SSH_KEY:-$HOME/.ssh/chattermost_deploy_ed25519}"
REMOTE="${CHAT_SERVER_DEPLOY_USER}@${CHAT_SERVER_DEPLOY_HOST}"
KNOWN_HOSTS_FILE="$REPO_ROOT/deploy/ssh_known_hosts"

mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"

if [[ ! -f "$KEY_PATH" ]]; then
  ssh-keygen -t ed25519 -a 64 -f "$KEY_PATH" -N "" -C "chattermost-deploy"
fi

if command -v sshpass >/dev/null 2>&1 && [[ -n "${CHAT_SERVER_DEPLOY_PASSWORD:-}" ]]; then
  sshpass -p "$CHAT_SERVER_DEPLOY_PASSWORD" ssh-copy-id -i "$KEY_PATH.pub" -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$KNOWN_HOSTS_FILE" -o HostKeyAlgorithms=ssh-ed25519 "$REMOTE"
else
  echo "sshpass or CHAT_SERVER_DEPLOY_PASSWORD missing; run this copy manually if key auth is not set:" >&2
  echo "ssh-copy-id -i '$KEY_PATH.pub' '$REMOTE'" >&2
fi

ssh -i "$KEY_PATH" -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$KNOWN_HOSTS_FILE" -o HostKeyAlgorithms=ssh-ed25519 "$REMOTE" 'printf "ssh certificate/key authentication ok\n"'
