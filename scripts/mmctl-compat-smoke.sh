#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MMCTL="${MMCTL:-$(command -v mmctl || true)}"
SERVER_URL="${CHAT_SERVER_URL:-${SERVER_URL:-http://127.0.0.1:8065}}"
ADMIN_USERNAME="${CHAT_SERVER_ADMIN_USERNAME:-${ADMIN_USERNAME:-admin}}"
ADMIN_PASSWORD="${CHAT_SERVER_ADMIN_PASSWORD:-${ADMIN_PASSWORD:-}}"
TEAM_NAME="${CHAT_SERVER_TEAM_NAME:-${TEAM_NAME:-supervised-chat}}"
CHANNEL_NAME="${CHAT_SERVER_CHANNEL_NAME:-${CHANNEL_NAME:-town-square}}"
SMOKE_TAG="mmctl-smoke-$(date +%s)"

if [[ ! -x "$MMCTL" ]]; then
  echo "Install mmctl separately and set MMCTL to its absolute executable path: $MMCTL" >&2
  exit 1
fi
if [[ -z "$ADMIN_PASSWORD" ]]; then
  echo "CHAT_SERVER_ADMIN_PASSWORD or ADMIN_PASSWORD is required" >&2
  exit 1
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
CONFIG_DIR="$WORK_DIR/config"
PASSWORD_FILE="$WORK_DIR/password"
printf '%s' "$ADMIN_PASSWORD" > "$PASSWORD_FILE"
chmod 600 "$PASSWORD_FILE"

"$MMCTL" --config "$CONFIG_DIR" auth login "$SERVER_URL" \
  --name chattermost-smoke \
  --username "$ADMIN_USERNAME" \
  --password-file "$PASSWORD_FILE" >/dev/null

echo "mmctl login: ok"
"$MMCTL" --config "$CONFIG_DIR" --json system status | node -e 'let data=""; process.stdin.on("data",(c)=>data+=c); process.stdin.on("end",()=>{const parsed=JSON.parse(data); console.log(JSON.stringify({system_status: parsed.status ?? parsed.Status ?? "unknown", version: parsed.version ?? parsed.Version ?? ""}));});'
"$MMCTL" --config "$CONFIG_DIR" --json team list | node -e 'let data=""; process.stdin.on("data",(c)=>data+=c); process.stdin.on("end",()=>{const parsed=JSON.parse(data); const list=Array.isArray(parsed) ? parsed : []; console.log(JSON.stringify({teams: list.map((team)=>team.name ?? team.Name).filter(Boolean)}));});'
"$MMCTL" --config "$CONFIG_DIR" --json channel list "$TEAM_NAME" | node -e 'let data=""; process.stdin.on("data",(c)=>data+=c); process.stdin.on("end",()=>{const parsed=JSON.parse(data); const list=Array.isArray(parsed) ? parsed : []; console.log(JSON.stringify({channel_count: list.length, channels: list.slice(0,5).map((channel)=>channel.name ?? channel.Name).filter(Boolean)}));});'
"$MMCTL" --config "$CONFIG_DIR" --json user search "$ADMIN_USERNAME" | node -e 'let data=""; process.stdin.on("data",(c)=>data+=c); process.stdin.on("end",()=>{const parsed=JSON.parse(data); const list=Array.isArray(parsed) ? parsed : []; console.log(JSON.stringify({user_matches: list.map((user)=>user.username ?? user.Username).filter(Boolean)}));});'
"$MMCTL" --config "$CONFIG_DIR" post create "$TEAM_NAME:$CHANNEL_NAME" --message "$SMOKE_TAG created through mmctl" >/dev/null
"$MMCTL" --config "$CONFIG_DIR" post list "$TEAM_NAME:$CHANNEL_NAME" --number 5 --show-ids | SMOKE_TAG="$SMOKE_TAG" node -e 'let data=""; process.stdin.on("data",(c)=>data+=c); process.stdin.on("end",()=>{console.log(JSON.stringify({post_list_contains_smoke: data.includes(process.env.SMOKE_TAG ?? ""), post_list_lines: data.trim().split(/\n/u).filter(Boolean).slice(0,5).length}));});'

SERVER_URL="$SERVER_URL" \
ADMIN_USERNAME="$ADMIN_USERNAME" \
ADMIN_PASSWORD="$ADMIN_PASSWORD" \
TEAM_NAME="$TEAM_NAME" \
CHANNEL_NAME="$CHANNEL_NAME" \
SMOKE_TAG="$SMOKE_TAG" \
node --input-type=module <<'NODE'
const serverUrl = required('SERVER_URL').replace(/\/$/u, '');
const username = required('ADMIN_USERNAME');
const password = required('ADMIN_PASSWORD');
const teamName = required('TEAM_NAME');
const channelName = required('CHANNEL_NAME');
const smokeTag = required('SMOKE_TAG');

function required(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function api(path, options = {}) {
  const response = await fetch(`${serverUrl}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers ?? {})
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${options.method ?? 'GET'} ${path} failed: ${response.status} ${text.slice(0, 300)}`);
  }
  return response;
}

const login = await api('/api/v4/users/login', {
  method: 'POST',
  headers: { Origin: serverUrl },
  body: JSON.stringify({ login_id: username, password })
});
const token = login.headers.get('token');
if (token === null || token.length === 0) {
  throw new Error('login response did not include a token header');
}
const bearer = { Authorization: `Bearer ${token}` };

const team = await (await api(`/api/v4/teams/name/${encodeURIComponent(teamName)}`, { headers: bearer })).json();
const channel = await (await api(`/api/v4/teams/${team.id}/channels/name/${encodeURIComponent(channelName)}`, { headers: bearer })).json();
const posts = await (await api(`/api/v4/channels/${channel.id}/posts`, { headers: bearer })).json();
const createdPost = Object.values(posts.posts ?? {}).find((post) => post?.message === `${smokeTag} created through mmctl`);
if (createdPost === undefined) {
  throw new Error('could not find the post created through mmctl');
}

const form = new FormData();
form.set('channel_id', channel.id);
form.append('files', new Blob([`ChatterMost compatibility smoke ${smokeTag}\n`], { type: 'text/plain' }), `${smokeTag}.txt`);
const uploaded = await (await api('/api/v4/files', { method: 'POST', headers: bearer, body: form })).json();
const fileId = uploaded.file_infos?.[0]?.id;
if (typeof fileId !== 'string' || fileId.length === 0) {
  throw new Error('file upload response did not include a file id');
}

const attachmentPost = await (await api('/api/v4/posts', {
  method: 'POST',
  headers: bearer,
  body: JSON.stringify({
    channel_id: channel.id,
    message: `${smokeTag} file attachment compatibility proof`,
    file_ids: [fileId]
  })
})).json();

const reaction = await (await api('/api/v4/reactions', {
  method: 'POST',
  headers: bearer,
  body: JSON.stringify({ post_id: createdPost.id, emoji_name: 'white_check_mark' })
})).json();
const reactions = await (await api(`/api/v4/posts/${createdPost.id}/reactions`, { headers: bearer })).json();

console.log(JSON.stringify({
  rest_compatibility: 'ok',
  note: 'This mmctl build has no file or reaction subcommands; file and reaction coverage uses the Mattermost-compatible REST API after mmctl login/post smoke.',
  team: team.name,
  channel: channel.name,
  mmctl_post_id: createdPost.id,
  attachment_post_id: attachmentPost.id,
  uploaded_file_id: fileId,
  reaction: reaction.emoji_name,
  reaction_count: Array.isArray(reactions) ? reactions.length : 0
}));
NODE

echo "mmctl compatibility smoke: ok"
