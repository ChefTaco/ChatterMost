# Compatibility

Current profile: `mattermost-v11.8`

ChatterMost is an independently developed Mattermost-compatible backend for the
official mobile and desktop apps and Hermes Agent's gateway. It implements
Mattermost-compatible JSON, 26-character lowercase public IDs, millisecond
timestamps, snake_case external fields, REST under `/api/v4`, and WebSocket at
`/api/v4/websocket`. Start with [client setup](clients.md) for app connection steps
and the distinction between native mobile clients and the desktop web shell.

## Supported Surfaces

Supported endpoint groups include:

- System ping/status/version, client config, license, timezones, notices, logs, metrics, and HA status.
- Login/type, login/logout, cookie sessions, bearer tokens, bot tokens, and personal access tokens.
- Users, profile images, teams, team membership, channels, channel membership, DMs, group DMs, unread/view markers, and channel privacy.
- Posts, threads, edit history, search, pins, ephemeral messages, reactions, files, file metadata, thumbnails/previews, preferences, typing, and statuses.
- Slash-command listing, autocomplete, suggestions, and execution for Hermes bot conversations; Mattermost-compatible import; push/notification no-op compatibility; desktop compatibility metadata; and disabled-by-default SSO discovery.
- Admin users/invites, supervision policy/events, native agent registry, agent bindings, incoming webhooks, and policy simulation.
- Mattermost-compatible WebSocket events for hello, posted, typing, reactions, status, channel, user, and thread changes.

Some discovery endpoints return compatible empty or free-tier responses. An
acknowledgement does not mean the corresponding upstream feature is implemented.
Calls, the upstream plugin/marketplace runtime, SSO and mobile background push
delivery are unsupported. The current [client limits and test coverage](clients.md#current-limits-and-coverage)
also describe upload types, public-link denial and native-device verification.

## Version Advertising

Version advertisement is controlled by `ALLOW_VERSION_ADVERTISEMENT`.

- Development default: off, returns `0.0.0-compatible`.
- Native deploy script and Compose setup default: on, returns `11.8.0` and `mattermost-v11.8`.

The compatibility profile is distinct from the ChatterMost release (for example,
0.5.0). Container `BuildHash` is the full source revision and `ReleaseId` is the
selected distribution version. Use the release manifest for upgrade identity.

Keep mobile smoke tests passing before advertising a Mattermost-compatible
version. The profile is a protocol target, not certification of every native app
version; record actual client versions separately from request-fixture coverage.

## Slash Commands

`GET /api/v4/commands` and the team autocomplete endpoints return Mattermost-compatible, snake_case definitions for the supported Hermes gateway commands. `POST /api/v4/commands` rejects custom URL commands because ChatterMost does not provide a hardened outbound integration dispatcher. `POST /api/v4/commands/execute` resolves the trigger against the supported definitions before it validates the conversation and creates one visible user-authored post; unknown commands are rejected without exposing their arguments in chat.

One-to-one bot DMs preserve the command exactly. Group DMs and channels with one bot add that bot's mention automatically because Hermes normally mention-gates non-DM traffic. Conversations with several bots require exactly one explicit `@bot` mention. Commands are rejected when the trigger is unknown, the user is not a member, no bot is present, or an addressed bot is outside the conversation. Hermes remains responsible for its user allowlists, command tiers, confirmation prompts, models, sessions, and execution semantics after a supported command is posted.

## Authentication And CSRF

- The Web UI authenticates with a `HttpOnly`, `SameSite=Lax` session cookie (`SESSION_COOKIE_NAME`, default `MMSID`).
- Cookie-authenticated methods other than `GET`/`HEAD`/`OPTIONS` must carry a same-origin `Origin` or `Referer` matching `SERVER_URL`.
- Cookie-authenticated WebSocket upgrades must also be same-origin to prevent Cross-Site WebSocket Hijacking.
- Bearer-token API clients such as Hermes, `mmctl`, and scripted tests are exempt from CSRF/CSWSH origin checks because browsers do not attach bearer tokens automatically.
- WebSocket clients may authenticate either with a bearer token on upgrade or by sending an `authentication_challenge` frame.

## Authorization And Account Safety

- Creating a team channel (`POST /api/v4/channels`, type `O`/`P`) requires membership in the target team. System admins may create channels in any team; direct and group channels are exempt because they carry no team.
- Single-use and limited-use invites enforce `max_uses` even under concurrent redemption: the use is reserved inside a serialized write, so two racing signups cannot both consume the last use. A failed signup (for example a duplicate username) releases the reserved use.
- Changing a password revokes the account's other active sessions. A self-service change keeps only the caller's current session; an admin reset of another user revokes all of that user's sessions so a compromised session cannot survive the reset.

## Mobile And Proxy Notes

- TLS must use a valid chain and TLS 1.2 or newer.
- Reverse proxies must pass `Upgrade` and `Connection: upgrade`.
- Long WebSocket read timeouts are required.
- Proxies must preserve `Origin` and `Referer`.
- The web UI has responsive mobile layouts, a fixed mobile composer, attachment selection, and emoji picker controls.
- Mobile app request/response fixtures for login type, login, client config, and websocket upgrade guard live in `tests/fixtures/mobile-app-compatibility.json` and are replayed by `tests/vitest/mobile-fixtures.test.ts`.
- Client config includes stable, non-empty `DiagnosticId` and `TelemetryId` values plus string-valued email/username login capability flags so Mattermost-compatible native mobile clients can identify the server and present its password login form.
- Team selection supports the native mobile channel bootstrap contract: joined channels, the current user's channel memberships, and Mattermost-compatible sidebar categories are returned together.
- WebSocket authentication and heartbeat handling follow the native client's challenge, `ping`, and Mattermost-compatible `pong` sequence so mobile connections remain online.
- Server event sequence numbers are contiguous and connection-local, begin at zero after a fresh connection, and do not develop gaps when events for other users are filtered out; repeated bearer authentication does not emit a duplicate `hello`.
- Challenge-authenticated sockets emit `hello` before the authentication response, matching the compatible hub-registration order required by iOS reliable WebSocket initialization.
- Reliable reconnect URLs can safely resume an inactive 26-character connection ID at the requested non-negative event sequence; active-ID collisions fall back to a fresh isolated stream.
- Built-in Mattermost-compatible roles are available by name with posting, reaction, upload, and channel permissions; channel memberships default to `channel_user` so native clients do not incorrectly render writable DMs as read-only.

## mmctl Smoke

Install `mmctl` separately, verify its upstream provenance and license, and set `MMCTL` to its absolute path. Basic and expanded smoke coverage is scripted:

```bash
CHAT_SERVER_URL=https://chat.example.test:9443 \
CHAT_SERVER_ADMIN_USERNAME=<admin> \
CHAT_SERVER_ADMIN_PASSWORD=<secret> \
scripts/mmctl-compat-smoke.sh
```

The script logs in with a temp config/password file, then checks system status, teams, channels, user search, post create, and post list without printing secrets. For CLI versions without file or reaction subcommands, the smoke also uses authenticated Mattermost-compatible REST calls to upload a file, create a file-backed post, add a reaction, and list reactions. The output prints only proof summaries and IDs.

## Compatibility-Sensitive WebSocket Details

`posted` events must carry Mattermost-compatible post JSON in `data.post` and include channel metadata:

- `channel_id`
- `channel_type`
- `team_id`
- `sender_name`

Hermes depends on `channel_type: "D"` to treat direct messages as DMs and skip channel mention gating.
