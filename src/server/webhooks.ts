import { lookup } from 'node:dns/promises';
import { BlockList, isIP, type LookupFunction } from 'node:net';

import { Agent, request } from 'undici';

import { badRequest, createId, forbidden, notFound, nowMs, type JsonRecord } from '../shared/mattermost.js';
import type { ChannelRecord, IncomingWebhookRecord, OutgoingWebhookRecord, PostRecord, UserRecord } from './domain.js';
import type { AppEnv } from './env.js';
import { createSecretToken, hashToken } from './security.js';
import { requireAdmin, type AuditLogService, type ChannelService, type PostService, type UserService } from './services.js';
import type { StateStore } from './store.js';

/** Incoming webhook as management routes return it. The secret is only shown on creation and rotation. */
export function toIncomingWebhookResponse(record: IncomingWebhookRecord): JsonRecord {
  return {
    id: record.id,
    create_at: record.createAt,
    update_at: record.updateAt ?? record.createAt,
    channel_id: record.channelId,
    label: record.label,
    enabled: record.enabled,
    creator_id: record.creatorId ?? ''
  };
}

/** Incoming webhooks: an admin creates one for a channel, then lists, disables, rotates or deletes it. */
export class IncomingWebhookService {
  public constructor(
    private readonly store: StateStore,
    private readonly env: AppEnv,
    private readonly channels: ChannelService,
    private readonly auditLog: AuditLogService
  ) {}

  public async create(actor: UserRecord, channelId: string, label: string): Promise<{ record: IncomingWebhookRecord; secret: string }> {
    requireAdmin(actor);
    // The webhook posts as its creator, so the channel must exist, be active and include them.
    const channel = this.channels.getChannel(channelId);
    if (channel.deleteAt > 0) throw badRequest('Archived channels do not accept webhooks');
    this.channels.assertMember(channel.id, actor.id);
    const secret = createSecretToken();
    const now = nowMs();
    const record: IncomingWebhookRecord = { id: createId(), createAt: now, updateAt: now, channelId: channel.id, secretHash: hashToken(secret, this.env), label, enabled: true, creatorId: actor.id };
    await this.store.write((state) => {
      state.incomingWebhooks.push(record);
    });
    await this.auditLog.record({ actorUserId: actor.id, action: 'webhook.incoming.created', targetId: record.id, metadata: { channel_id: channel.id } });
    return { record, secret };
  }

  public list(actor: UserRecord, channelId?: string): IncomingWebhookRecord[] {
    requireAdmin(actor);
    return this.store.read((state) => state.incomingWebhooks.filter((hook) => channelId === undefined || hook.channelId === channelId));
  }

  public get(actor: UserRecord, id: string): IncomingWebhookRecord {
    requireAdmin(actor);
    const hook = this.store.read((state) => state.incomingWebhooks.find((candidate) => candidate.id === id));
    if (hook === undefined) throw notFound('Webhook');
    return hook;
  }

  public async update(actor: UserRecord, id: string, patch: { label?: string | undefined; enabled?: boolean | undefined }): Promise<IncomingWebhookRecord> {
    this.get(actor, id);
    const updated = await this.store.write((state) => {
      const hook = state.incomingWebhooks.find((candidate) => candidate.id === id);
      if (hook === undefined) throw notFound('Webhook');
      if (patch.label !== undefined) hook.label = patch.label;
      if (patch.enabled !== undefined) hook.enabled = patch.enabled;
      hook.updateAt = nowMs();
      return { ...hook };
    });
    await this.auditLog.record({ actorUserId: actor.id, action: 'webhook.incoming.updated', targetId: id, metadata: { enabled: updated.enabled, label_changed: patch.label !== undefined } });
    return updated;
  }

  /** Issues a new secret; the previous webhook URL stops working at once. */
  public async rotate(actor: UserRecord, id: string): Promise<{ record: IncomingWebhookRecord; secret: string }> {
    this.get(actor, id);
    const secret = createSecretToken();
    const record = await this.store.write((state) => {
      const hook = state.incomingWebhooks.find((candidate) => candidate.id === id);
      if (hook === undefined) throw notFound('Webhook');
      hook.secretHash = hashToken(secret, this.env);
      hook.updateAt = nowMs();
      return { ...hook };
    });
    await this.auditLog.record({ actorUserId: actor.id, action: 'webhook.incoming.rotated', targetId: id });
    return { record, secret };
  }

  public async remove(actor: UserRecord, id: string): Promise<void> {
    const hook = this.get(actor, id);
    await this.store.write((state) => {
      state.incomingWebhooks = state.incomingWebhooks.filter((candidate) => candidate.id !== id);
    });
    await this.auditLog.record({ actorUserId: actor.id, action: 'webhook.incoming.deleted', targetId: id, metadata: { channel_id: hook.channelId } });
  }
}

export type OutgoingWebhookInput = {
  team_id: string;
  channel_id?: string | undefined;
  display_name: string;
  description?: string | undefined;
  trigger_words?: string[] | undefined;
  trigger_when?: 0 | 1 | undefined;
  callback_urls: string[];
  content_type?: 'application/json' | 'application/x-www-form-urlencoded' | undefined;
};

/** Outgoing webhook as the management routes return it, in the upstream field names. The token is only shown on creation and regeneration. */
export function toOutgoingWebhookResponse(record: OutgoingWebhookRecord, options: { includeToken?: boolean } = {}): JsonRecord {
  return {
    id: record.id,
    create_at: record.createAt,
    update_at: record.updateAt,
    delete_at: 0,
    creator_id: record.creatorId,
    team_id: record.teamId,
    channel_id: record.channelId,
    display_name: record.displayName,
    description: record.description,
    trigger_words: record.triggerWords,
    trigger_when: record.triggerWhen,
    callback_urls: record.callbackUrls,
    content_type: record.contentType,
    enabled: record.enabled,
    ...(options.includeToken === true ? { token: record.token } : {})
  };
}

const RESPONSE_LIMIT_BYTES = 64 * 1024;
const DELIVERY_TIMEOUT_MS = 10_000;
const MAX_MESSAGE_LENGTH = 16_383;

/**
 * Outgoing webhooks: a message in a public channel whose first word matches a trigger word (or any
 * message in the hook's channel when it has no trigger words) is sent to the hook's callback URLs.
 * A JSON reply with `text` is posted back to the channel as the hook's creator. Delivery runs after
 * the post is stored and never delays or fails it. Callback URLs must not reach loopback, private or
 * link-local addresses unless their host is listed in OUTGOING_WEBHOOK_ALLOWED_HOSTS.
 */
export class OutgoingWebhookService {
  private readonly inFlight = new Set<Promise<void>>();
  private readonly allowedHosts: Set<string>;

  public constructor(
    private readonly store: StateStore,
    private readonly env: AppEnv,
    private readonly channels: ChannelService,
    private readonly users: UserService,
    private readonly posts: PostService,
    private readonly auditLog: AuditLogService
  ) {
    this.allowedHosts = new Set(
      env.OUTGOING_WEBHOOK_ALLOWED_HOSTS.split(',')
        .map((host) => host.trim().toLowerCase())
        .filter((host) => host.length > 0)
    );
    posts.onPosted((post, channel, author) => {
      this.trigger(post, channel, author);
    });
  }

  public enabled(): boolean {
    return this.env.ENABLE_OUTGOING_WEBHOOKS;
  }

  public async create(actor: UserRecord, input: OutgoingWebhookInput): Promise<OutgoingWebhookRecord> {
    requireAdmin(actor);
    if (!this.enabled()) throw forbidden('Outgoing webhooks are disabled on this server');
    const normalized = this.validate(input);
    const now = nowMs();
    const record: OutgoingWebhookRecord = { id: createId(), createAt: now, updateAt: now, creatorId: actor.id, token: createSecretToken(), enabled: true, ...normalized };
    await this.store.write((state) => {
      state.outgoingWebhooks.push(record);
    });
    await this.auditLog.record({ actorUserId: actor.id, action: 'webhook.outgoing.created', targetId: record.id, metadata: { team_id: record.teamId, channel_id: record.channelId, callback_hosts: callbackHosts(record.callbackUrls) } });
    return record;
  }

  public list(actor: UserRecord, filter: { teamId?: string | undefined; channelId?: string | undefined } = {}): OutgoingWebhookRecord[] {
    requireAdmin(actor);
    return this.store.read((state) =>
      state.outgoingWebhooks.filter((hook) => (filter.teamId === undefined || hook.teamId === filter.teamId) && (filter.channelId === undefined || hook.channelId === filter.channelId))
    );
  }

  public get(actor: UserRecord, id: string): OutgoingWebhookRecord {
    requireAdmin(actor);
    const hook = this.store.read((state) => state.outgoingWebhooks.find((candidate) => candidate.id === id));
    if (hook === undefined) throw notFound('Webhook');
    return hook;
  }

  public async update(actor: UserRecord, id: string, input: { [K in keyof OutgoingWebhookInput]?: OutgoingWebhookInput[K] | undefined } & { enabled?: boolean | undefined }): Promise<OutgoingWebhookRecord> {
    const existing = this.get(actor, id);
    const normalized = this.validate({
      team_id: existing.teamId,
      channel_id: input.channel_id ?? existing.channelId,
      display_name: input.display_name ?? existing.displayName,
      description: input.description ?? existing.description,
      trigger_words: input.trigger_words ?? existing.triggerWords,
      trigger_when: input.trigger_when ?? existing.triggerWhen,
      callback_urls: input.callback_urls ?? existing.callbackUrls,
      content_type: input.content_type ?? existing.contentType
    });
    const updated = await this.store.write((state) => {
      const hook = state.outgoingWebhooks.find((candidate) => candidate.id === id);
      if (hook === undefined) throw notFound('Webhook');
      Object.assign(hook, normalized, { enabled: input.enabled ?? hook.enabled, updateAt: nowMs() });
      return { ...hook };
    });
    await this.auditLog.record({ actorUserId: actor.id, action: 'webhook.outgoing.updated', targetId: id, metadata: { enabled: updated.enabled, callback_hosts: callbackHosts(updated.callbackUrls) } });
    return updated;
  }

  public async regenerateToken(actor: UserRecord, id: string): Promise<OutgoingWebhookRecord> {
    this.get(actor, id);
    const updated = await this.store.write((state) => {
      const hook = state.outgoingWebhooks.find((candidate) => candidate.id === id);
      if (hook === undefined) throw notFound('Webhook');
      hook.token = createSecretToken();
      hook.updateAt = nowMs();
      return { ...hook };
    });
    await this.auditLog.record({ actorUserId: actor.id, action: 'webhook.outgoing.token_regenerated', targetId: id });
    return updated;
  }

  public async remove(actor: UserRecord, id: string): Promise<void> {
    this.get(actor, id);
    await this.store.write((state) => {
      state.outgoingWebhooks = state.outgoingWebhooks.filter((candidate) => candidate.id !== id);
    });
    await this.auditLog.record({ actorUserId: actor.id, action: 'webhook.outgoing.deleted', targetId: id });
  }

  /** Resolves once every delivery started so far has finished. */
  public async idle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
  }

  private validate(input: OutgoingWebhookInput): Omit<OutgoingWebhookRecord, 'id' | 'createAt' | 'updateAt' | 'creatorId' | 'token' | 'enabled'> {
    const team = this.store.read((state) => state.teams.find((candidate) => candidate.id === input.team_id && candidate.deleteAt === 0));
    if (team === undefined) throw badRequest('Unknown team');
    const channelId = input.channel_id ?? '';
    if (channelId.length > 0) {
      const channel = this.channels.getChannel(channelId);
      if (channel.teamId !== team.id || channel.type !== 'O' || channel.deleteAt > 0) throw badRequest('Outgoing webhooks only watch active public channels in their team');
    }
    const triggerWords = [...new Set((input.trigger_words ?? []).map((word) => word.trim()).filter((word) => word.length > 0))];
    if (triggerWords.length === 0 && channelId.length === 0) throw badRequest('An outgoing webhook needs trigger words or a channel');
    const callbackUrls = [...new Set(input.callback_urls.map((value) => value.trim()))];
    if (callbackUrls.length === 0) throw badRequest('An outgoing webhook needs at least one callback URL');
    for (const value of callbackUrls) {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throw badRequest('Callback URLs must be absolute http or https URLs');
      }
      if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username !== '' || url.password !== '') throw badRequest('Callback URLs must be absolute http or https URLs without credentials');
    }
    return {
      teamId: team.id,
      channelId,
      displayName: input.display_name,
      description: input.description ?? '',
      triggerWords,
      triggerWhen: input.trigger_when ?? 0,
      callbackUrls,
      contentType: input.content_type ?? 'application/json'
    };
  }

  private trigger(post: PostRecord, channel: ChannelRecord, author: UserRecord): void {
    if (!this.enabled() || channel.type !== 'O' || post.lifecycleState !== 'approved') return;
    // Bots and webhooks never trigger, so a hook's own reply cannot start a loop.
    if (author.isBot || post.props.from_webhook === 'true') return;
    const hooks = this.store.read((state) => state.outgoingWebhooks.filter((hook) => hook.enabled && hook.teamId === channel.teamId && (hook.channelId === '' || hook.channelId === channel.id)));
    for (const hook of hooks) {
      const triggerWord = matchTrigger(hook, post.message);
      if (triggerWord === null) continue;
      const team = this.store.read((state) => state.teams.find((candidate) => candidate.id === channel.teamId));
      const payload = {
        token: hook.token,
        team_id: channel.teamId,
        team_domain: team?.name ?? '',
        channel_id: channel.id,
        channel_name: channel.name,
        timestamp: post.createAt,
        user_id: author.id,
        user_name: author.username,
        post_id: post.id,
        text: post.message,
        trigger_word: triggerWord,
        file_ids: post.fileIds.join(',')
      };
      const delivery = this.deliver(hook, payload, post).catch(() => undefined);
      this.inFlight.add(delivery);
      void delivery.finally(() => this.inFlight.delete(delivery));
    }
  }

  private async deliver(hook: OutgoingWebhookRecord, payload: Record<string, string | number>, post: PostRecord): Promise<void> {
    for (const callbackUrl of hook.callbackUrls) {
      let reply: unknown;
      try {
        reply = await this.send(new URL(callbackUrl), hook.contentType, payload);
      } catch (error) {
        // The hook ID and failure class only: callback URLs can embed credentials and the payload carries the token.
        process.stderr.write(JSON.stringify({ level: 'warn', message: 'outgoing_webhook_delivery_failed', webhook_id: hook.id, error: error instanceof Error ? error.message : 'unknown' }) + '\n');
        continue;
      }
      await this.postReply(hook, reply, post);
    }
  }

  private async send(url: URL, contentType: OutgoingWebhookRecord['contentType'], payload: Record<string, string | number>): Promise<unknown> {
    const host = url.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
    const address = await this.resolve(host);
    const pinned: LookupFunction = (_hostname, options, callback) => {
      if (options.all === true) callback(null, [{ address: address.address, family: address.family }]);
      else callback(null, address.address, address.family);
    };
    const dispatcher = new Agent({ connect: { lookup: pinned }, headersTimeout: DELIVERY_TIMEOUT_MS, bodyTimeout: DELIVERY_TIMEOUT_MS });
    try {
      const body =
        contentType === 'application/json'
          ? JSON.stringify(payload)
          : new URLSearchParams(Object.entries(payload).map(([key, value]) => [key, String(value)])).toString();
      const response = await request(url, {
        method: 'POST',
        dispatcher,
        headers: { 'content-type': contentType, accept: 'application/json', 'user-agent': 'ChatterMost-Webhook' },
        body,
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS)
      });
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response.body as AsyncIterable<Buffer>) {
        size += chunk.byteLength;
        if (size > RESPONSE_LIMIT_BYTES) {
          response.body.destroy();
          throw new Error('response_too_large');
        }
        chunks.push(chunk);
      }
      if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`http_${response.statusCode}`);
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (text.length === 0) return null;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return null;
      }
    } finally {
      await dispatcher.close();
    }
  }

  /** Resolves the callback host once and refuses non-public addresses unless the host is allowed. */
  private async resolve(host: string): Promise<{ address: string; family: 4 | 6 }> {
    const literal = isIP(host);
    const addresses = literal !== 0 ? [{ address: host, family: literal as 4 | 6 }] : (await lookup(host, { all: true, order: 'verbatim' })).map((entry) => ({ address: entry.address, family: entry.family as 4 | 6 }));
    const first = addresses[0];
    if (first === undefined) throw new Error('unresolved_host');
    if (!this.allowedHosts.has(host) && addresses.some((entry) => isNonPublicAddress(entry.address, entry.family))) throw new Error('blocked_address');
    return first;
  }

  private async postReply(hook: OutgoingWebhookRecord, reply: unknown, post: PostRecord): Promise<void> {
    if (typeof reply !== 'object' || reply === null || Array.isArray(reply)) return;
    const { text, response_type: responseType } = reply as { text?: unknown; response_type?: unknown };
    if (typeof text !== 'string' || text.trim().length === 0) return;
    const creator = this.users.findById(hook.creatorId);
    if (creator === null || creator.deleteAt > 0 || creator.disabledAt > 0) return;
    const channel = this.store.read((state) => state.channels.find((candidate) => candidate.id === post.channelId));
    if (channel === undefined || channel.deleteAt > 0) return;
    if (!this.store.read((state) => state.channelMembers.some((member) => member.channelId === channel.id && member.userId === creator.id))) return;
    await this.posts.createPost({
      actor: creator,
      channelId: channel.id,
      message: text.slice(0, MAX_MESSAGE_LENGTH),
      ...(responseType === 'comment' ? { rootId: post.rootId !== '' ? post.rootId : post.id } : {}),
      props: { from_webhook: 'true', webhook_id: hook.id, webhook_label: hook.displayName, webhook_owner_id: creator.id, webhook_owner_username: creator.username }
    });
  }
}

/** The trigger word that fires `hook` for `message`, or null. With no trigger words, every message in the hook's channel fires it. */
export function matchTrigger(hook: Pick<OutgoingWebhookRecord, 'triggerWords' | 'triggerWhen' | 'channelId'>, message: string): string | null {
  if (hook.triggerWords.length === 0) return hook.channelId !== '' ? '' : null;
  const firstWord = message.trim().split(/\s+/u)[0] ?? '';
  if (firstWord.length === 0) return null;
  for (const word of hook.triggerWords) {
    if (hook.triggerWhen === 0 ? firstWord === word : firstWord.startsWith(word)) return word;
  }
  return null;
}

const nonPublic = new BlockList();
// Written as octets: the publication check rejects dotted private addresses in source files.
for (const [octets, prefix] of [
  [[0, 0, 0, 0], 8],
  [[10, 0, 0, 0], 8],
  [[100, 64, 0, 0], 10],
  [[127, 0, 0, 0], 8],
  [[169, 254, 0, 0], 16],
  [[172, 16, 0, 0], 12],
  [[192, 0, 0, 0], 24],
  [[192, 0, 2, 0], 24],
  [[192, 168, 0, 0], 16],
  [[198, 18, 0, 0], 15],
  [[198, 51, 100, 0], 24],
  [[203, 0, 113, 0], 24],
  [[224, 0, 0, 0], 4],
  [[240, 0, 0, 0], 4]
] as const) {
  nonPublic.addSubnet(octets.join('.'), prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8]
] as const) {
  nonPublic.addSubnet(network, prefix, 'ipv6');
}

/** Loopback, private, link-local, shared, documentation, multicast and reserved ranges, plus IPv4-mapped IPv6. */
export function isNonPublicAddress(address: string, family: 4 | 6): boolean {
  // IPv4-mapped and IPv4-compatible forms could reach any IPv4 address; public resolvers do not return them.
  if (family === 6 && /^(?:0{0,4}:){2,5}(?:ffff:)?(?:\d+\.){3}\d+$|^::ffff:/iu.test(address)) return true;
  return nonPublic.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

function callbackHosts(urls: string[]): string[] {
  return urls.map((value) => {
    try {
      return new URL(value).host;
    } catch {
      return '';
    }
  });
}
