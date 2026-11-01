#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${1:-$REPO_ROOT/.env}"
KNOWN_HOSTS_FILE="$REPO_ROOT/deploy/ssh_known_hosts"
LOCAL_STAGING=''
REMOTE_STAGING=''
REMOTE=''
SSH_OPTS=()

cleanup() {
  if [[ -n "$REMOTE_STAGING" && -n "${REMOTE:-}" ]]; then
    ssh "${SSH_OPTS[@]}" "$REMOTE" "rm -rf -- '$REMOTE_STAGING'" >/dev/null 2>&1 || true
  fi
  if [[ -n "$LOCAL_STAGING" && -d "$LOCAL_STAGING" ]]; then
    rm -rf -- "$LOCAL_STAGING"
  fi
}
trap cleanup EXIT

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

: "${CHAT_SERVER_URL:?CHAT_SERVER_URL is required}"
: "${CHAT_SERVER_DEPLOY_USER:?CHAT_SERVER_DEPLOY_USER is required}"
: "${CHAT_SERVER_DEPLOY_HOST:?CHAT_SERVER_DEPLOY_HOST is required}"

certificate_host="${CHAT_SERVER_DEPLOY_TAILSCALE_CERT:-}"
if [[ -z "$certificate_host" || "$certificate_host" =~ ^(1|true)$ ]]; then
  certificate_host="${CHAT_SERVER_URL#http://}"
  certificate_host="${certificate_host#https://}"
  certificate_host="${certificate_host%%/*}"
  certificate_host="${certificate_host%%:*}"
fi
if [[ ! "$certificate_host" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$ ]]; then
  echo "Invalid Tailscale certificate hostname: $certificate_host" >&2
  exit 1
fi

SSH_KEY_PATH="${CHAT_SERVER_DEPLOY_SSH_KEY:-$HOME/.ssh/chattermost_deploy_ed25519}"
REMOTE="${CHAT_SERVER_DEPLOY_USER}@${CHAT_SERVER_DEPLOY_HOST}"
SSH_OPTS=(-o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$KNOWN_HOSTS_FILE" -o HostKeyAlgorithms=ssh-ed25519)
if [[ -f "$SSH_KEY_PATH" ]]; then
  SSH_OPTS=(-i "$SSH_KEY_PATH" "${SSH_OPTS[@]}")
fi

remote_sudo() {
  local command="$1"
  if [[ -n "${CHAT_SERVER_DEPLOY_SUDO_PASSWORD:-}" ]]; then
    printf '%s\n' "$CHAT_SERVER_DEPLOY_SUDO_PASSWORD" | ssh "${SSH_OPTS[@]}" "$REMOTE" "sudo -S -p '' bash -lc $(printf '%q' "$command")"
  else
    ssh "${SSH_OPTS[@]}" "$REMOTE" "sudo bash -lc $(printf '%q' "$command")"
  fi
}

LOCAL_STAGING="$(mktemp -d "${TMPDIR:-/tmp}/chattermost-cert-renew.XXXXXX")"
sed "s#__TAILSCALE_HOST__#$certificate_host#g" \
  "$REPO_ROOT/deploy/chattermost-cert-renew.sh" > "$LOCAL_STAGING/chattermost-cert-renew"
cp "$REPO_ROOT/deploy/chattermost-cert-renew.service" "$LOCAL_STAGING/"
cp "$REPO_ROOT/deploy/chattermost-cert-renew.timer" "$LOCAL_STAGING/"
chmod 0700 "$LOCAL_STAGING/chattermost-cert-renew"

REMOTE_STAGING="$(ssh "${SSH_OPTS[@]}" "$REMOTE" 'mktemp -d /tmp/chattermost-cert-renew.XXXXXX')"
if [[ ! "$REMOTE_STAGING" =~ ^/tmp/chattermost-cert-renew\.[A-Za-z0-9]+$ ]]; then
  echo "Unexpected remote staging path: $REMOTE_STAGING" >&2
  exit 1
fi
scp "${SSH_OPTS[@]}" \
  "$LOCAL_STAGING/chattermost-cert-renew" \
  "$LOCAL_STAGING/chattermost-cert-renew.service" \
  "$LOCAL_STAGING/chattermost-cert-renew.timer" \
  "$REMOTE:$REMOTE_STAGING/"

remote_sudo "set -euo pipefail
install -o root -g root -m 0750 '$REMOTE_STAGING/chattermost-cert-renew' /usr/local/sbin/chattermost-cert-renew
install -o root -g root -m 0644 '$REMOTE_STAGING/chattermost-cert-renew.service' /etc/systemd/system/chattermost-cert-renew.service
install -o root -g root -m 0644 '$REMOTE_STAGING/chattermost-cert-renew.timer' /etc/systemd/system/chattermost-cert-renew.timer
systemd-analyze verify /etc/systemd/system/chattermost-cert-renew.service /etc/systemd/system/chattermost-cert-renew.timer
systemctl daemon-reload
systemctl enable --now chattermost-cert-renew.timer
systemctl start chattermost-cert-renew.service
rm -rf -- '$REMOTE_STAGING'"
REMOTE_STAGING=''

ssh "${SSH_OPTS[@]}" "$REMOTE" \
  'systemctl is-enabled chattermost-cert-renew.timer && systemctl is-active chattermost-cert-renew.timer && systemctl show chattermost-cert-renew.service -p Result -p ExecMainStatus --no-pager'
