#!/usr/bin/env tsx
type CleanupUser = { username: string };
type CleanupChannel = { display_name: string };
type CleanupResponse = {
  dry_run: boolean;
  matched_user_count?: number;
  cleaned_user_count?: number;
  matched_channel_count?: number;
  cleaned_channel_count?: number;
  users?: CleanupUser[];
  channels?: CleanupChannel[];
};

const baseUrl = requiredEnv('CHAT_SERVER_URL').replace(/\/+$/u, '');
const adminUsername = requiredEnv('CHAT_SERVER_ADMIN_USERNAME');
const adminPassword = requiredEnv('CHAT_SERVER_ADMIN_PASSWORD');
const apply = process.argv.includes('--apply');
const usernamePrefix = readArg('--username-prefix') ?? 'testotron-';
const channelNamePrefix = readArg('--channel-prefix') ?? 'Test';
const olderThanHours = Number(readArg('--older-than-hours') ?? '0');

const adminToken = await login(adminUsername, adminPassword);
const result = await cleanup(adminToken, {
  dry_run: !apply,
  username_prefix: usernamePrefix,
  channel_name_prefix: channelNamePrefix,
  older_than_hours: olderThanHours,
  confirm: apply ? 'cleanup test artifacts' : ''
});

console.log(
  JSON.stringify(
    {
      dry_run: result.dry_run,
      user_count: result.matched_user_count ?? result.cleaned_user_count ?? 0,
      channel_count: result.matched_channel_count ?? result.cleaned_channel_count ?? 0,
      usernames: (result.users ?? []).map((user) => user.username),
      channels: (result.channels ?? []).map((channel) => channel.display_name)
    },
    null,
    2
  )
);

async function login(loginId: string, password: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v4/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl },
    body: JSON.stringify({ login_id: loginId, password })
  });
  if (!response.ok) {
    throw new Error(`Login failed: ${response.status}`);
  }
  const token = response.headers.get('token');
  if (token === null) {
    throw new Error('Login did not return a token');
  }
  return token;
}

async function cleanup(
  token: string,
  body: {
    dry_run: boolean;
    username_prefix: string;
    channel_name_prefix: string;
    older_than_hours: number;
    confirm: string;
  }
): Promise<CleanupResponse> {
  const response = await fetch(`${baseUrl}/admin/test-artifacts/cleanup`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`/admin/test-artifacts/cleanup failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as CleanupResponse;
}

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}
