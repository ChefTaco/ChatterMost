import type { StoreState } from './domain.js';

type Sample = { labels?: Record<string, string>; value: number };
type Family = { name: string; help: string; type: 'counter' | 'gauge'; samples: Sample[] };

export type PrometheusInputs = {
  state: Readonly<StoreState>;
  websocketConnections: number;
  abuse: Record<string, unknown>;
  version: string;
  compatibilityProfile: string;
  startedAtMs: number;
  nowMs: number;
};

/**
 * Server metrics in the Prometheus text exposition format (version 0.0.4). Counters come from
 * the persisted metrics, so they survive restarts; gauges are computed from the current state.
 * Labels carry only fixed vocabularies, never names, IDs or message content.
 */
export function renderPrometheusMetrics(input: PrometheusInputs): string {
  const { state } = input;
  const metrics = state.metrics;
  const users = state.users;
  const families: Family[] = [
    { name: 'chattermost_build_info', help: 'Build information; always 1.', type: 'gauge', samples: [{ labels: { version: input.version, compatibility_profile: input.compatibilityProfile }, value: 1 }] },
    { name: 'chattermost_process_start_time_seconds', help: 'Start time of the server process since the Unix epoch.', type: 'gauge', samples: [{ value: Math.floor(input.startedAtMs / 1000) }] },
    { name: 'chattermost_http_requests_total', help: 'HTTP requests received.', type: 'counter', samples: [{ value: metrics.httpRequests }] },
    { name: 'chattermost_http_errors_total', help: 'HTTP requests answered with an error.', type: 'counter', samples: [{ value: metrics.errors }] },
    { name: 'chattermost_websocket_connections_opened_total', help: 'WebSocket connections accepted.', type: 'counter', samples: [{ value: metrics.websocketConnections }] },
    { name: 'chattermost_websocket_connections', help: 'Open WebSocket connections on this process.', type: 'gauge', samples: [{ value: input.websocketConnections }] },
    { name: 'chattermost_messages_posted_total', help: 'Messages posted.', type: 'counter', samples: [{ value: metrics.messagesPosted }] },
    { name: 'chattermost_bot_messages_posted_total', help: 'Messages posted by bot accounts.', type: 'counter', samples: [{ value: metrics.hermesBotMessages }] },
    { name: 'chattermost_reactions_added_total', help: 'Reactions added.', type: 'counter', samples: [{ value: metrics.reactionsAdded }] },
    { name: 'chattermost_files_uploaded_total', help: 'Files uploaded.', type: 'counter', samples: [{ value: metrics.filesUploaded }] },
    { name: 'chattermost_moderation_actions_total', help: 'Supervision and moderator actions.', type: 'counter', samples: [{ value: metrics.moderationActions }] },
    {
      name: 'chattermost_users',
      help: 'Accounts by state.',
      type: 'gauge',
      samples: [
        { labels: { state: 'active' }, value: users.filter((user) => user.deleteAt === 0 && user.disabledAt === 0 && !user.isBot).length },
        { labels: { state: 'deactivated' }, value: users.filter((user) => (user.deleteAt > 0 || user.disabledAt > 0) && !user.isBot).length },
        { labels: { state: 'bot' }, value: users.filter((user) => user.isBot && user.deleteAt === 0).length }
      ]
    },
    {
      name: 'chattermost_channels',
      help: 'Active channels by type.',
      type: 'gauge',
      samples: (['O', 'P', 'D', 'G'] as const).map((type) => ({ labels: { type }, value: state.channels.filter((channel) => channel.type === type && channel.deleteAt === 0).length }))
    },
    { name: 'chattermost_posts', help: 'Stored posts, deleted tombstones included.', type: 'gauge', samples: [{ value: state.posts.length }] },
    { name: 'chattermost_files', help: 'Stored file attachments.', type: 'gauge', samples: [{ value: state.files.length }] },
    { name: 'chattermost_file_bytes', help: 'Total size of stored file attachments.', type: 'gauge', samples: [{ value: state.files.reduce((total, file) => total + file.size, 0) }] },
    { name: 'chattermost_active_sessions', help: 'Sessions that are neither revoked nor expired.', type: 'gauge', samples: [{ value: state.sessions.filter((session) => session.revokedAt === 0 && session.expiresAt > input.nowMs).length }] },
    { name: 'chattermost_audit_outbox_pending', help: 'Audit events waiting to be published.', type: 'gauge', samples: [{ value: state.auditOutbox.filter((event) => event.publishedAt === 0).length }] }
  ];
  for (const [key, value] of Object.entries(input.abuse)) {
    if (typeof value === 'number' && /^[a-z_]+$/u.test(key)) {
      families.push({ name: `chattermost_abuse_${key}_total`, help: `Abuse control: ${key.replaceAll('_', ' ')}.`, type: 'counter', samples: [{ value }] });
    } else if (key === 'trusted_proxy_decisions' && typeof value === 'object' && value !== null) {
      families.push({
        name: 'chattermost_abuse_proxy_decisions_total',
        help: 'Client address decisions by trusted-proxy outcome.',
        type: 'counter',
        samples: Object.entries(value as Record<string, unknown>)
          .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && /^[a-z_]+$/u.test(entry[0]))
          .map(([decision, count]) => ({ labels: { decision }, value: count }))
      });
    }
  }
  return families.map(renderFamily).join('');
}

function renderFamily(family: Family): string {
  const lines = [`# HELP ${family.name} ${family.help}`, `# TYPE ${family.name} ${family.type}`];
  for (const sample of family.samples) {
    const labels = sample.labels === undefined ? '' : `{${Object.entries(sample.labels).map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(',')}}`;
    lines.push(`${family.name}${labels} ${Number.isFinite(sample.value) ? sample.value : 0}`);
  }
  return lines.join('\n') + '\n';
}

function escapeLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
}
