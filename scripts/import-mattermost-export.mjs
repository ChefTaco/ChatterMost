#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const args = parseArgs(process.argv.slice(2));

if (!args.file) {
  fail('Usage: npm run import:mm-export -- --file export.jsonl [--server-url URL --token TOKEN --apply]');
}

const payload = await readExport(args.file);

if (!args.apply) {
  console.log(
    JSON.stringify(
      {
        dry_run: true,
        planned_channels: payload.channels.length,
        planned_posts: payload.posts.length,
        sample: {
          channels: payload.channels.slice(0, 3),
          posts: payload.posts.slice(0, 3)
        }
      },
      null,
      2
    )
  );
  process.exit(0);
}

if (!args.serverUrl || !args.token) {
  fail('--apply requires --server-url and --token');
}

const response = await fetch(new URL('/api/v4/import/mattermost', args.serverUrl), {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${args.token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ ...payload, dry_run: false })
});

const text = await response.text();
if (!response.ok) {
  fail(`Import failed with HTTP ${response.status}: ${text}`);
}
console.log(text);

function parseArgs(values) {
  const parsed = {
    apply: false,
    file: '',
    serverUrl: '',
    token: ''
  };
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    const next = values[index + 1] ?? '';
    if (key === '--apply') {
      parsed.apply = true;
    } else if (key === '--file') {
      parsed.file = next;
      index += 1;
    } else if (key === '--server-url') {
      parsed.serverUrl = next;
      index += 1;
    } else if (key === '--token') {
      parsed.token = next;
      index += 1;
    }
  }
  return parsed;
}

async function readExport(file) {
  const channels = [];
  const posts = [];
  const stream = createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  for await (const line of stream) {
    if (line.trim().length === 0) {
      continue;
    }
    const item = JSON.parse(line);
    const normalized = normalizeItem(item);
    if (!normalized) {
      continue;
    }
    if (normalized.kind === 'channel') {
      channels.push(normalized.channel);
    } else {
      posts.push(normalized.post);
    }
  }
  return { channels, posts };
}

function normalizeItem(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const type = stringValue(item.type);
  const channel = objectValue(item.channel) ?? (type === 'channel' ? item : null);
  if (channel) {
    const name = stringValue(channel.name) || stringValue(channel.channel_name);
    if (name.length > 0) {
      return {
        kind: 'channel',
        channel: {
          name,
          display_name: stringValue(channel.display_name) || name,
          type: stringValue(channel.type) === 'P' ? 'P' : 'O',
          header: stringValue(channel.header),
          purpose: stringValue(channel.purpose)
        }
      };
    }
  }

  const post = objectValue(item.post) ?? (type === 'post' ? item : null);
  if (post) {
    return {
      kind: 'post',
      post: {
        channel_id: stringValue(post.channel_id) || stringValue(post.channel) || stringValue(post.channel_name),
        message: stringValue(post.message),
        root_id: stringValue(post.root_id),
        props: objectValue(post.props) ?? {}
      }
    };
  }

  return null;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function stringValue(value) {
  return typeof value === 'string' ? value : '';
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
