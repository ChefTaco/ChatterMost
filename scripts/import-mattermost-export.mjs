#!/usr/bin/env node
// Imports a Mattermost bulk export (JSONL) into ChatterMost in batches. See docs/admin-guide.md#importing-a-mattermost-export.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const USAGE = `Usage: npm run import:mm-export -- --file export.jsonl [--team NAME] [--server-url URL] [--apply] [--batch-bytes N]

Without --apply nothing is written: the report lists what the import keeps and loses.
With --server-url the server also checks each batch (unknown channels, unmapped authors).
The admin token is read from CHATTERMOST_IMPORT_TOKEN or from --token-file PATH (mode 600).`;

const DEFAULT_BATCH_BYTES = 4 * 1024 * 1024;
const MAX_BATCH_BYTES = 15 * 1024 * 1024;
const MAX_BATCH_THREADS = 1000;

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    await main(process.argv.slice(2), process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export async function main(argv, env) {
  const args = parseArgs(argv);
  if (!args.file) throw new Error(USAGE);
  const parsed = await readExport(args.file, { team: args.team });
  const batches = toBatches(parsed, args.batchBytes);
  const report = { dry_run: !args.apply, export: parsed.summary, batches: batches.length };
  if (!args.serverUrl) {
    if (args.apply) throw new Error('--apply requires --server-url');
    console.log(JSON.stringify(report, null, 2));
    return report;
  }
  const token = await readToken(args, env);
  const server = await sendBatches(new URL('/api/v4/import/mattermost', args.serverUrl), token, batches, !args.apply);
  const result = { ...report, server };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

export function parseArgs(values) {
  const parsed = { apply: false, file: '', serverUrl: '', tokenFile: '', team: '', batchBytes: DEFAULT_BATCH_BYTES };
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    const next = () => {
      const value = values[index + 1];
      if (value === undefined) throw new Error(`${key} needs a value\n\n${USAGE}`);
      index += 1;
      return value;
    };
    if (key === '--apply') parsed.apply = true;
    else if (key === '--file') parsed.file = next();
    else if (key === '--server-url') parsed.serverUrl = next();
    else if (key === '--token-file') parsed.tokenFile = next();
    else if (key === '--team') parsed.team = next();
    else if (key === '--batch-bytes') {
      const bytes = Number(next());
      if (!Number.isSafeInteger(bytes) || bytes < 1024 || bytes > MAX_BATCH_BYTES) throw new Error(`--batch-bytes must be between 1024 and ${MAX_BATCH_BYTES}`);
      parsed.batchBytes = bytes;
    } else if (key === '--token' || key.startsWith('--token=')) {
      // A token on the command line is visible to other local users and kept in shell history.
      throw new Error('--token is no longer accepted. Set CHATTERMOST_IMPORT_TOKEN or pass --token-file PATH (mode 600).');
    } else throw new Error(`Unknown option ${key}\n\n${USAGE}`);
  }
  return parsed;
}

export async function readToken(args, env) {
  if (args.tokenFile) {
    const info = await stat(args.tokenFile);
    if ((info.mode & 0o077) !== 0) throw new Error('--token-file must not be readable by group or others (chmod 600)');
    const token = (await readFile(args.tokenFile, 'utf8')).trim();
    if (token.length === 0) throw new Error('--token-file is empty');
    return token;
  }
  const token = (env.CHATTERMOST_IMPORT_TOKEN ?? '').trim();
  if (token.length === 0) throw new Error('Set CHATTERMOST_IMPORT_TOKEN or pass --token-file PATH to reach the server');
  return token;
}

/**
 * Reads a bulk export into channels and threads (a root post with its replies). Authors, timestamps
 * and reactions are kept; everything the import cannot carry is counted in `summary.lost`.
 */
export async function readExport(file, options = {}) {
  const channels = [];
  const threads = [];
  const legacyById = new Map();
  const legacyReplies = [];
  const summary = {
    channels: 0,
    posts: 0,
    replies: 0,
    direct_posts: 0,
    authors: 0,
    reactions: 0,
    lost: { attachments: 0, flagged: 0, pinned: 0, edited: 0, users: 0, teams: 0, direct_channels: 0, emoji: 0, other_lines: 0 }
  };
  const authors = new Set();
  const keyCounts = new Map();
  const uniqueKey = (base) => {
    const count = (keyCounts.get(base) ?? 0) + 1;
    keyCounts.set(base, count);
    return count === 1 ? base : `${base}.${count}`;
  };
  const stream = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of stream) {
    lineNumber += 1;
    if (line.trim().length === 0) continue;
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      throw new Error(`Line ${lineNumber} is not valid JSON`);
    }
    const type = stringValue(item?.type);
    if (type === 'version' || type === 'scheme' || type === 'role') continue;
    if (type === 'team') {
      summary.lost.teams += 1;
      continue;
    }
    if (type === 'user') {
      summary.lost.users += 1;
      continue;
    }
    if (type === 'emoji') {
      summary.lost.emoji += 1;
      continue;
    }
    if (type === 'direct_channel') {
      summary.lost.direct_channels += 1;
      continue;
    }
    const channel = objectValue(item?.channel) ?? (type === 'channel' ? item : null);
    if (type === 'channel' || (type === '' && channel)) {
      const name = stringValue(channel.name) || stringValue(channel.channel_name);
      if (name.length === 0) throw new Error(`Line ${lineNumber}: channel has no name`);
      channels.push({
        ...(teamFor(channel, options) ? { team: teamFor(channel, options) } : {}),
        name,
        display_name: stringValue(channel.display_name) || name,
        type: stringValue(channel.type) === 'P' ? 'P' : 'O',
        header: stringValue(channel.header),
        purpose: stringValue(channel.purpose)
      });
      summary.channels += 1;
      continue;
    }
    const direct = type === 'direct_post' ? objectValue(item.direct_post) : null;
    const post = direct ?? objectValue(item?.post) ?? (type === 'post' ? item : null);
    if (!post) {
      summary.lost.other_lines += 1;
      continue;
    }
    const members = direct ? arrayValue(direct.channel_members).map(stringValue).filter((name) => name.length > 0) : [];
    const channelName = stringValue(post.channel) || stringValue(post.channel_id) || stringValue(post.channel_name);
    const root = normalizePost(post, summary, authors);
    const location = direct ? `dm:${[...members].sort().join(',')}` : `${teamFor(post, options)}/${channelName}`;
    root.import_id = stringValue(post.id) ? `mm:${stringValue(post.id)}` : uniqueKey(`mmx:${digest([location, root.user ?? '', root.create_at ?? 0, root.message])}`);
    root.replies = arrayValue(post.replies).map((reply) => {
      const normalized = normalizePost(objectValue(reply) ?? {}, summary, authors);
      normalized.import_id = stringValue(reply?.id) ? `mm:${stringValue(reply.id)}` : uniqueKey(`${root.import_id}/${digest([normalized.user ?? '', normalized.create_at ?? 0, normalized.message])}`);
      return normalized;
    });
    const thread = direct
      ? { ...root, direct_members: members }
      : { ...root, channel_id: channelName, ...(teamFor(post, options) ? { team: teamFor(post, options) } : {}) };
    if (direct) summary.direct_posts += 1 + root.replies.length;
    else {
      summary.posts += 1;
      summary.replies += root.replies.length;
    }
    // Older flat exports name the root by ID instead of nesting replies.
    const legacyRoot = stringValue(post.root_id);
    if (legacyRoot) {
      legacyReplies.push({ rootId: legacyRoot, thread });
      if (!direct) {
        summary.posts -= 1;
        summary.replies += 1;
      }
    } else {
      threads.push(thread);
      if (stringValue(post.id)) legacyById.set(stringValue(post.id), thread);
    }
  }
  for (const { rootId, thread } of legacyReplies) {
    const root = legacyById.get(rootId);
    const { replies, channel_id: _channel, team: _team, direct_members: _members, ...reply } = thread;
    if (root) root.replies.push(reply, ...replies);
    else threads.push({ ...thread, root_id: rootId });
  }
  summary.authors = authors.size;
  return { channels, threads, summary };
}

function normalizePost(post, summary, authors) {
  const user = stringValue(post.user) || stringValue(post.username);
  if (user) authors.add(user);
  const createAt = Number.isSafeInteger(post.create_at) && post.create_at > 0 ? post.create_at : undefined;
  const reactions = arrayValue(post.reactions)
    .map((reaction) => ({ user: stringValue(reaction?.user), emoji_name: stringValue(reaction?.emoji_name), ...(Number.isSafeInteger(reaction?.create_at) && reaction.create_at > 0 ? { create_at: reaction.create_at } : {}) }))
    .filter((reaction) => reaction.user.length > 0 && reaction.emoji_name.length > 0);
  summary.reactions += reactions.length;
  summary.lost.attachments += arrayValue(post.attachments).length + arrayValue(post.file_ids).length;
  summary.lost.flagged += arrayValue(post.flagged_by).length;
  if (post.is_pinned === true) summary.lost.pinned += 1;
  if (Number(post.edit_at) > 0) summary.lost.edited += 1;
  return {
    ...(user ? { user } : {}),
    message: stringValue(post.message),
    ...(createAt !== undefined ? { create_at: createAt } : {}),
    props: objectValue(post.props) ?? {},
    reactions
  };
}

/** Groups threads into requests below `batchBytes`; a thread is never split across requests. */
export function toBatches(parsed, batchBytes = DEFAULT_BATCH_BYTES) {
  const batches = [];
  let current = { channels: parsed.channels, posts: [] };
  let bytes = Buffer.byteLength(JSON.stringify(parsed.channels));
  for (const thread of parsed.threads) {
    const size = Buffer.byteLength(JSON.stringify(thread)) + 1;
    if (size > MAX_BATCH_BYTES) throw new Error(`A thread in channel ${thread.channel_id ?? 'direct'} is larger than ${MAX_BATCH_BYTES} bytes and cannot be imported`);
    if (current.posts.length > 0 && (bytes + size > batchBytes || current.posts.length >= MAX_BATCH_THREADS)) {
      batches.push(current);
      current = { channels: [], posts: [] };
      bytes = 2;
    }
    current.posts.push(thread);
    bytes += size;
  }
  if (current.posts.length > 0 || current.channels.length > 0) batches.push(current);
  return batches;
}

/**
 * Sends each batch in order and stops at the first failure. Every batch is applied atomically and
 * already-imported posts are skipped, so rerunning the same command resumes after a failure.
 */
export async function sendBatches(url, token, batches, dryRun, fetchImpl = fetch) {
  const totals = { batches_sent: 0, created_channels: 0, created_direct_channels: 0, imported_posts: 0, imported_replies: 0, imported_reactions: 0, skipped_duplicates: 0, memberships_added: 0, held_by_supervision: 0, lost_reactions: 0, lost_direct_posts: 0 };
  const unmapped = new Set();
  for (const [index, batch] of batches.entries()) {
    // A dry run writes nothing, so later batches need the channels the first one would create.
    const body = dryRun && index > 0 ? { ...batch, channels: batches[0].channels } : batch;
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, dry_run: dryRun })
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Batch ${index + 1} of ${batches.length} failed with HTTP ${response.status}: ${text}\n${index > 0 && !dryRun ? `Batches 1-${index} were imported; rerun the same command to resume.` : 'Nothing from this batch was imported.'}`);
    }
    const result = JSON.parse(text);
    totals.batches_sent += 1;
    if (!dryRun || index === 0) {
      totals.created_channels += result.created_channels ?? 0;
      totals.created_direct_channels += result.created_direct_channels ?? 0;
    }
    for (const field of ['imported_posts', 'imported_replies', 'imported_reactions', 'skipped_duplicates', 'memberships_added', 'held_by_supervision']) totals[field] += result[field] ?? 0;
    totals.lost_reactions += result.lost?.reactions ?? 0;
    totals.lost_direct_posts += result.lost?.direct_posts ?? 0;
    for (const name of result.unmapped_users ?? []) unmapped.add(name);
  }
  return { ...totals, unmapped_users: [...unmapped].sort() };
}

function teamFor(record, options) {
  return options.team || stringValue(record.team) || stringValue(record.team_name);
}

function digest(parts) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function stringValue(value) {
  return typeof value === 'string' ? value : '';
}
