# Connect Hermes Agent

ChatterMost connects Hermes Agent to the same Mattermost-compatible backend used
by your [mobile/desktop clients](clients.md). Hermes calls this a **platform
plugin**: the bundled `mattermost-platform` plugin registers the `mattermost`
messaging gateway adapter. Your Hermes model/provider settings remain independent.
ChatterMost itself is the separately installed server.

## Quick setup

1. [Install the published Compose distribution](containers.md#install-a-release)
   and configure HTTPS/WebSocket proxying. A fresh setup generates the seeded
   `hermes` bot token in the protected installation `secrets/runtime.env`.
   Read that existing `HERMES_BOT_TOKEN` privately. For an additional gateway,
   provision a dedicated bot as described below instead of sharing a token.
2. Create or invite the human accounts that may use the agent. While logged in
   as each human in the browser, open `/api/v4/users/me` on the ChatterMost origin
   and record its `id` privately. Those 26-character IDs belong in the gateway
   allowlist. Calling that endpoint with the bot token returns the bot's ID.
3. On the intended Hermes host/profile, run:

   ```bash
   hermes gateway setup
   ```

   Select **Mattermost**, the upstream adapter's name. Supply the ChatterMost
   HTTPS origin without `/api/v4`, the bot token, and allowed human IDs. The
   upstream setup wizard describes its own server's bot-management UI; use the
   ChatterMost token above or the ChatterMost admin API below for this backend.
   Hermes already bundles the platform plugin; a ChatterMost-specific plugin
   download or separate server SDK is unnecessary.
4. For a new foreground gateway, run `hermes gateway run`. For a gateway already
   managed by a service or container, use its existing supervisor to restart it;
   `hermes gateway restart` applies to a Hermes-managed service. Do not start a
   second gateway with the same token or replace another profile's configuration.
5. Open a DM to the bot from a client and confirm the reply arrives. In a channel
   containing the bot, mention its configured username, such as `@hermes`.
   Confirm files and threaded replies as needed, within the backend's
   [supported file and client surface](clients.md#current-limits-and-coverage).

These instructions use Hermes' bundled platform manifest and CLI setup/run
commands. See the upstream [setup guide](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/mattermost)
and [platform manifest](https://github.com/NousResearch/hermes-agent/blob/main/plugins/platforms/mattermost/plugin.yaml).
The upstream [plugin lifecycle guide](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugins)
explains that bundled platform plugins are discovered automatically; the gateway
configuration controls which messaging platforms connect.

## ChatterMost Bot Setup

For Compose, manage these values in the installation's protected
`secrets/runtime.env`, retaining mode 600 and the selected app UID/GID. The source
checkout's `.env` is not the container configuration. For source/native installs,
use their protected runtime env. Set these before startup or deployment:

```dotenv
HERMES_BOT_USERNAME="hermes"
HERMES_BOT_DISPLAY_NAME="Hermes Agent"
HERMES_BOT_TOKEN="<existing-private-bot-token>"
```

When `HERMES_BOT_TOKEN` is present, ChatterMost creates or updates the bot account and bot token hash during bootstrap. The bot is added to default teams and default public channels.

Admins can rotate the bot token from the Hermes panel. The new token is returned once in the UI/API response; it is stored hashed after that. Update the Hermes host's `MATTERMOST_TOKEN` and restart the Hermes gateway immediately
after rotation. For the environment-seeded bot, update the protected server
`HERMES_BOT_TOKEN` to the same value before its next restart; bootstrap reapplies
that configured token hash. Coordinate the server configuration recreation and
readiness check in a maintenance operation. Do not rotate `COOKIE_SECRET` or
`TOKEN_HASH_SECRET` to rotate one bot. Additional API-provisioned bots keep their
own persisted token hashes and are not seeded by this environment value.

For additional Hermes hosts, provision a dedicated hostname bot with `POST /admin/bots` using an admin bearer token:

```json
{"username":"gateway-bot","display_name":"Example gateway"}
```

The endpoint creates or reconciles the bot, adds it to the default team and public channels, and returns a new token once. Store that token as `MATTERMOST_TOKEN` only on the matching Hermes host. Reprovisioning the same hostname rotates its prior token.

Administrator-driven bot provisioning, identity updates, and token rotations return an `operation_id` in both the JSON body and `X-Operation-ID` header. ChatterMost durably accepts the bot mutation and its audit-outbox event in one serialized store write, then publishes the audit record asynchronously. An administrator can reconcile an uncertain response with `GET /admin/bot-operations/{operation_id}`; `accepted` means the mutation and outbox event are durable, while `published` means the audit record is also visible. Operation responses never expose a previously returned token.

`PUT /admin/bots/{user_id}` updates a bot username and display identity without changing its user ID or token. Provisioned `@bot.localhost` email is renamed with the username after a collision check, while an externally managed email is preserved. Connected clients receive `user_updated` after durable acceptance.

The bot can:

- Authenticate with `Authorization: Bearer <HERMES_BOT_TOKEN>`.
- Call `GET /api/v4/users/me`.
- Lookup users.
- Create/open DMs with `POST /api/v4/channels/direct`.
- Read channels, members, and posts.
- Create posts and threaded replies.
- Upload/download files.
- Connect to `/api/v4/websocket`.
- Receive slash commands submitted by the ChatterMost web composer or a Mattermost-compatible client.

## Slash Commands

The web composer shows a filtered bot command deck when a draft begins with `/` in a conversation containing a bot. It includes the supported core session, model, execution, and skill-management commands. `/tasks` and `/sources` require a gateway that implements them. `/commands` still asks the connected gateway for its authoritative live list, but ChatterMost forwards only triggers in its declared command definitions; unknown or dynamically installed `/<skill-name>` triggers are rejected until they are explicitly registered with the facade.

Mattermost-compatible clients submit through `POST /api/v4/commands/execute`. ChatterMost resolves the trigger before posting and turns a supported request into exactly one visible post authored by the authenticated user. Unknown triggers are rejected without posting their arguments. Custom URL commands are not accepted because the facade has no outbound integration dispatcher. In a one-to-one bot DM the text is unchanged. In a group DM or channel with one bot, ChatterMost adds `@bot` so Hermes' non-DM mention gate accepts it. With multiple bots, the user must mention exactly one target. Slash commands are text-only.

Hermes, not ChatterMost, handles the execution semantics for accepted commands such as `/reset`, `/new`, `/model`, `/status`, and `/commands`. Hermes' `MATTERMOST_ALLOWED_USERS`, per-user command access, and destructive-command confirmations continue to apply because the original user ID is preserved in the WebSocket post.

## Hermes Agent Settings

The setup wizard saves gateway credentials for the selected Hermes profile.
For manual configuration, merge the following into that profile's protected
`.env` (default `~/.hermes/.env`), preserving existing settings and mode 600:

```dotenv
MATTERMOST_URL="https://chat.example.test"
MATTERMOST_TOKEN="<existing-private-bot-token>"
MATTERMOST_ALLOWED_USERS="<human-user-id>,<another-human-user-id>"
MATTERMOST_ALLOW_ALL_USERS=false
MATTERMOST_REPLY_MODE=off
MATTERMOST_REQUIRE_MENTION=true
```

Use the token for the chosen bot; only the environment-seeded bot uses the server's
`HERMES_BOT_TOKEN`. Keep the allowlist explicit and retain other gateway settings.
ChatterMost's legacy `HERMES_ALLOWED_USER_IDS` environment field is currently
unused for enforcement; it is not a replacement for `MATTERMOST_ALLOWED_USERS` on
the Hermes host. Bundled platform discovery does not override an explicitly
disabled gateway/platform configuration; use the setup wizard to configure it.

Hermes adapter notes:

- `MATTERMOST_REPLY_MODE=off` posts flat replies.
- `MATTERMOST_REPLY_MODE=thread` replies under the source post for channels.
- One-to-one DMs bypass mention gating; the sender must still be authorized by Hermes.
- Public/private channels require the configured bot username by default when `MATTERMOST_REQUIRE_MENTION=true`.
- `MATTERMOST_ALLOWED_USERS` should use Mattermost-compatible user IDs, not display names.
- `MATTERMOST_ALLOWED_CHANNELS` restricts non-DM channels, including group DMs;
  one-to-one DMs bypass this channel filter but retain user authorization.
- `MATTERMOST_FREE_RESPONSE_CHANNELS` skips mention gating for selected channel
  IDs; it does not bypass the channel or user allowlists.
- `MATTERMOST_HOME_CHANNEL` selects the channel for proactive gateway delivery;
  the bot must be a member. ChatterMost does not run Hermes cron jobs itself.

## WebSocket Contract

Hermes authenticates by opening `/api/v4/websocket` and sending:

```json
{"seq":1,"action":"authentication_challenge","data":{"token":"<bot token>"}}
```

ChatterMost emits `hello` before the challenge's `OK` response. Post events are Mattermost-compatible:

```json
{
  "event": "posted",
  "data": {
    "channel_id": "<channel id>",
    "channel_type": "D",
    "team_id": "",
    "sender_name": "example-user",
    "post": "{\"id\":\"...\",\"user_id\":\"...\",\"channel_id\":\"...\",\"file_ids\":[]}"
  }
}
```

`channel_type` is important. Hermes uses `D` to identify a direct message and skip mention gating. The `post` field must contain Mattermost-compatible snake_case fields such as `user_id`, `channel_id`, `root_id`, and `file_ids`.

## Gateway smoke verification

Configure an instance and gateway with a dedicated bot token. Health/readiness
proves the backend can authenticate and open a WebSocket; a real gateway reply
is the end-to-end check that Hermes is running and permits the sender.
An allowlisted user should open a DM to that bot, send a message, receive the compatible `posted` event over WSS, and receive the gateway's response in the same channel. Use synthetic content and keep proof output private.

Repeatable smoke from a source/operator checkout with protected admin or smoke
credentials already in the process environment (the script does not load `.env`):

```bash
CHAT_SERVER_URL=https://chat.example.test:9443 \
CHAT_SERVER_SMOKE_BOT_USERNAME=hermes \
CHAT_SERVER_SMOKE_MESSAGE=/arxiv \
node --import tsx scripts/hermes-dm-smoke.ts
```

The script logs in as `CHAT_SERVER_SMOKE_LOGIN_ID`/`CHAT_SERVER_SMOKE_PASSWORD` when provided, otherwise it reuses the configured admin credentials. That actor must already be included in the gateway's `MATTERMOST_ALLOWED_USERS`; the smoke never weakens the allowlist or leaves disposable accounts behind. Ordinary messages require a reply carrying a random correlation value. Slash-command smoke appends a unique exact-response request and accepts only a later response from the selected bot carrying that value, so use a prompt-bearing command such as `/arxiv`. `CHAT_SERVER_SMOKE_BOT_USERNAME` defaults to `HERMES_BOT_USERNAME`, then `hermes`, for backward compatibility.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Gateway cannot authenticate | `MATTERMOST_URL` is the origin, the token belongs to the intended bot, and the account is active. Test `GET /api/v4/users/me` with the bot bearer credential privately. |
| Connected bot gives no reply | The human user ID is allowlisted in Hermes, the gateway is running in the intended profile, and the bot is a conversation member. |
| Channel or group DM is ignored | Non-DM channel allowlist and mention requirements; mention the actual bot username. |
| WebSocket fails or reconnects | Valid TLS, `/api/v4/websocket` proxy upgrade headers/timeouts, and a consistent public origin. |
| Token works until a server restart | For the seeded bot, the protected server `HERMES_BOT_TOKEN` must match the intentionally rotated token. |
| A slash command is rejected | ChatterMost must explicitly declare the trigger; `/commands` discovery does not register new triggers. |

Keep tokens, account IDs, conversations and gateway logs in private operator
storage. A docs update does not require restarting either server or gateway.
