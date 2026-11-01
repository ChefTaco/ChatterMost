# Admin Guide

Admins sign in with the configured administrator account. Compose setup stores
its initial credentials in the protected installation `secrets/runtime.env`;
source/native installations bootstrap from `.env` or `CHAT_SERVER_ADMIN_*` values.
Keep the current administrator password in the protected readiness configuration
when changing it through the UI. See [container operations](containers.md) and
[upgrades/recovery](upgrading.md) before installation-level changes.

## Navigation

- `+ Channel` opens the New panel for public/private channel creation.
- `+ DM` opens Direct messages. Search for a person or bot, then choose `Message` for a new DM or `Open` for an existing conversation.
- `Members` opens the right-side member rail. Direct and group conversations show fixed conversation members only; channels show current members and add-user controls.
- `Files`, `Pinned`, and `Policy` are channel inspector tabs for attachments, pinned messages, and channel-level agent controls.
- The moon/sun icon in the chat header toggles light/dark mode and stores `chattermost-theme` in browser `localStorage`.
- The profile card opens Profile settings for display details and profile images.

## Channels And DMs

Private channels are visible only to listed members. Channel admins and system admins can add users from the Members panel.

Direct messages are fixed one-to-one conversations. Group direct messages are fixed multi-user conversations. Use `+ DM` to start or reopen them.

The composer supports:

- Text messages.
- File/image attachment selection and an attachment tray before send.
- Paste/drop file attachments, upload status, and recoverable send errors.
- Searchable emoji selection with recent emoji and admin-managed custom emoji.
- Thread replies from `Reply in thread` on a post.
- Pin/unpin message actions. Pinned messages appear in the Pinned inspector tab.
- A command deck when `/` is typed in a bot conversation. Use `/commands` for the connected Hermes gateway's live command and installed-skill list.

On mobile, the composer is fixed at the bottom of the viewport so message entry, attachments, emoji, and send remain reachable.

Slash commands are text-only. One-to-one bot DMs need no mention. Group DMs and channels with one bot target it automatically; conversations with multiple bots require one explicit `@bot`. A rejected command remains in the composer so it can be corrected. Hermes enforces the sender's command access and any confirmation prompt.

## Administration

Use the Admin users and invites panel to:

- Create one-use invites.
- Review and revoke active invites.
- List users.
- Revoke user sessions.
- Deactivate users.
- Reactivate users.
- Reset passwords.
- Dry-run and apply cleanup for generated `testotron-*` users and `Test*` channels.

Use System to manage privacy and compatibility settings:

- Telemetry.
- Diagnostics.
- Security alert checks.
- Email/full-name visibility.
- File uploads.
- Public links.
- Custom emoji.
- Bot creation.

Custom emoji can be added and removed from System when enabled. Users see active custom emoji in the composer picker.

Use Supervision to switch between audit-only and pre-moderation from the current web UI. Backend policy support also includes disabled and post-moderation modes.

Use Agents to register native AI agents, edit structured permissions/allowlists/memory policy, and run policy simulation.

Use Hermes to review bot-token configuration, bot accounts, WSS connection count, last bot post, recent agent events, and to rotate the bot token intentionally. A rotated token is shown only in the rotation response; update Hermes immediately.
For the environment-seeded bot, also coordinate `HERMES_BOT_TOKEN` in the
protected server configuration before the next restart: bootstrap otherwise
reapplies the old environment token. See [seeded bot configuration](hermes-compatibility.md#chattermost-bot-setup). Privileged bot API mutations also return an operation ID; administrators can reconcile it at `GET /admin/bot-operations/{operation_id}` without exposing the one-time token again.

## Import

The import helper runs from a source/operator checkout, not inside the production
image (which has no npm/TypeScript toolchain). It imports a supported subset of
channels/posts; it is not a complete account, credential or attachment migration.
Use the Mattermost-compatible helper to inspect a JSONL export:

```bash
npm run import:mm-export -- --file export.jsonl
```

Add `--server-url`, `--token`, and `--apply` to submit normalized channels and posts to `/api/v4/import/mattermost`.

The dry run prints sample channel/post content. Treat exports and output as private;
use synthetic exports in public reports. Supplying `--token` exposes that argument
to the local process argument list and potentially shell history, so use a protected operator workflow.
This helper does not replace a consistent installation backup/restore.
