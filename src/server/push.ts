import { createHash } from 'node:crypto';

import { createId, nowMs } from '../shared/mattermost.js';
import type { ChannelRecord, PostRecord, StoreState, UserRecord } from './domain.js';
import type { AppEnv } from './env.js';
import type { PostService, WebSocketHub } from './services.js';
import type { StateStore } from './store.js';

const DELIVERY_TIMEOUT_MS = 5_000;
const FULL_MESSAGE_LIMIT = 500;
const CHANNEL_WIDE_MENTIONS = new Set(['channel', 'all', 'here']);

/** A session's registered device: `<platform>[-v2]:<token>`, as the official apps send it. */
export function parseDeviceId(deviceId: string): { platform: string; token: string; version: 'v2' | '' } | null {
  const separator = deviceId.indexOf(':');
  if (separator <= 0 || separator === deviceId.length - 1) return null;
  const rawPlatform = deviceId.slice(0, separator);
  const token = deviceId.slice(separator + 1);
  const version = rawPlatform.endsWith('-v2') ? 'v2' : '';
  const platform = version === 'v2' ? rawPlatform.slice(0, -3) : rawPlatform;
  if (!/^(?:apple|android)(?:_rn)?$/u.test(platform) || !/^[\w:.-]{1,512}$/u.test(token)) return null;
  return { platform, token, version };
}

type Recipient = { user: UserRecord; sessionId: string; device: NonNullable<ReturnType<typeof parseDeviceId>> };

/**
 * Background push for the official mobile apps. When PUSH_NOTIFICATION_SERVER is set, a post
 * notifies each channel member who has no open WebSocket, has a registered mobile device and
 * whose push preference matches (every message, mentions, or none; direct and group messages
 * always count as mentions). Notifications go to the push proxy's `/api/v1/send_push` in the
 * upstream payload format. By default they carry only the sender and channel, not the message
 * text (PUSH_NOTIFICATION_CONTENTS). A proxy answer of REMOVE unregisters that device.
 */
export class PushNotificationService {
  private readonly inFlight = new Set<Promise<void>>();

  public constructor(
    private readonly store: StateStore,
    private readonly env: AppEnv,
    private readonly hub: WebSocketHub,
    posts: PostService,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    posts.onPosted((post, channel, author) => {
      this.trigger(post, channel, author);
    });
  }

  public enabled(): boolean {
    return this.env.PUSH_NOTIFICATION_SERVER.length > 0;
  }

  /** Resolves once every delivery started so far has finished. */
  public async idle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
  }

  private trigger(post: PostRecord, channel: ChannelRecord, author: UserRecord): void {
    if (!this.enabled() || post.lifecycleState !== 'approved' || post.type !== '') return;
    const recipients = this.store.read((state) => this.recipients(state, post, channel, author));
    if (recipients.length === 0) return;
    const team = this.store.read((state) => state.teams.find((candidate) => candidate.id === channel.teamId));
    const serverId = createHash('sha256').update(this.env.SERVER_URL).digest('hex').slice(0, 26);
    for (const recipient of recipients) {
      const ackId = createId();
      const payload = {
        id: ackId,
        ack_id: ackId,
        server_id: serverId,
        platform: recipient.device.platform,
        device_id: recipient.device.token,
        version: recipient.device.version,
        type: 'message',
        category: 'CAN_REPLY',
        sound: 'none',
        badge: 1,
        post_id: post.id,
        root_id: post.rootId,
        channel_id: channel.id,
        team_id: team?.id ?? '',
        sender_id: author.id,
        sender_name: author.username,
        ...(this.env.PUSH_NOTIFICATION_CONTENTS === 'generic_no_channel' ? {} : { channel_name: channel.displayName || channel.name }),
        message: this.message(post, author)
      };
      const delivery = this.deliver(recipient, payload).catch(() => undefined);
      this.inFlight.add(delivery);
      void delivery.finally(() => this.inFlight.delete(delivery));
    }
  }

  private recipients(state: Readonly<StoreState>, post: PostRecord, channel: ChannelRecord, author: UserRecord): Recipient[] {
    const direct = channel.type === 'D' || channel.type === 'G';
    const mentions = new Set(Array.isArray(post.metadata.mentions) ? post.metadata.mentions.filter((value): value is string => typeof value === 'string').map((value) => value.toLowerCase()) : []);
    const channelWide = [...mentions].some((name) => CHANNEL_WIDE_MENTIONS.has(name));
    const now = nowMs();
    const recipients: Recipient[] = [];
    for (const member of state.channelMembers) {
      if (member.channelId !== channel.id || member.userId === author.id) continue;
      const user = state.users.find((candidate) => candidate.id === member.userId);
      if (user === undefined || user.deleteAt > 0 || user.disabledAt > 0 || user.isBot) continue;
      if (this.hub.hasConnection(user.id)) continue;
      const channelLevel = typeof member.notifyProps.push === 'string' ? member.notifyProps.push : 'default';
      const level = channelLevel === 'default' ? (typeof user.notifyProps.push === 'string' ? user.notifyProps.push : 'mention') : channelLevel;
      if (level === 'none') continue;
      if (level !== 'all' && !direct && !channelWide && !mentions.has(user.username.toLowerCase())) continue;
      for (const session of state.sessions) {
        if (session.userId !== user.id || session.revokedAt > 0 || session.expiresAt <= now) continue;
        const device = parseDeviceId(session.deviceId);
        if (device !== null) recipients.push({ user, sessionId: session.id, device });
      }
    }
    return recipients;
  }

  private message(post: PostRecord, author: UserRecord): string {
    if (this.env.PUSH_NOTIFICATION_CONTENTS === 'full') {
      const text = post.message.length > FULL_MESSAGE_LIMIT ? `${post.message.slice(0, FULL_MESSAGE_LIMIT)}…` : post.message;
      return `@${author.username}: ${text}`;
    }
    return `@${author.username} sent a message`;
  }

  private async deliver(recipient: Recipient, payload: Record<string, unknown>): Promise<void> {
    try {
      const response = await this.fetchImpl(new URL('/api/v1/send_push', this.env.PUSH_NOTIFICATION_SERVER), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'error',
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS)
      });
      const text = (await response.text()).slice(0, 4096);
      let status = '';
      try {
        const parsed = (JSON.parse(text) as { status?: unknown }).status;
        status = typeof parsed === 'string' ? parsed : '';
      } catch {
        status = '';
      }
      if (status === 'REMOVE') {
        await this.store.write((state) => {
          const session = state.sessions.find((candidate) => candidate.id === recipient.sessionId);
          if (session !== undefined) session.deviceId = '';
        });
        return;
      }
      if (!response.ok || status === 'FAIL') throw new Error(`push_proxy_${response.status}`);
    } catch (error) {
      // No device token, user or message content in logs.
      process.stderr.write(JSON.stringify({ level: 'warn', message: 'push_delivery_failed', error: error instanceof Error ? error.message : 'unknown' }) + '\n');
    }
  }
}
