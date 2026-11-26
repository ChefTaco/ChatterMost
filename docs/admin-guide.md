# Admin Guide

Admins sign in with the configured administrator account. Compose setup stores
its initial credentials in the protected installation `secrets/runtime.env`;
source/native installations bootstrap from `.env` or `CHAT_SERVER_ADMIN_*` values.
Keep the current administrator password in the protected readiness configuration
when changing it through the UI. See [container operations](containers.md) and
[upgrades/recovery](upgrading.md) before installation-level changes.

People can connect official apps to the same backend using the [client guide](clients.md).
For agents, configure Hermes' bundled `mattermost-platform` platform plugin using
[Hermes setup](hermes-compatibility.md#quick-setup). User/invite/bot administration
below describes the included ChatterMost web UI, not the native mobile interface.

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

Use Agents to register native AI agents, edit structured permissions/allowlists/memory policy, and run policy simulation. The simulator checks the rules ChatterMost enforces: the channel exists and is not archived, and the posting account is a member. It also reports who would see the post, the supervision mode and the channel's retention limit. Agent registry permissions, routing, memory flags and allowlists are recorded for agents to read; ChatterMost does not enforce them, so they do not change the result.

A channel's Policy panel sets **Retention days**. Leave it empty to keep messages indefinitely. With a limit, an hourly job (first run a minute after startup) permanently deletes posts older than the limit, with their edit history, reactions and attachments. It also deletes uploads in that channel that are older than the limit and not attached to a kept post. Each purge writes a `channel.retention_purged` audit entry with the counts. Purged posts cannot be recovered except from a backup. The same limit is available as `retention_days` on the channel patch API.

Use Hermes to review bot-token configuration, bot accounts, WSS connection count, last bot post, recent agent events, and to rotate the bot token intentionally. A rotated token is shown only in the rotation response; update Hermes immediately.
This panel reports backend bot state; it does not install or start a Hermes
gateway. Fresh Compose setup already generates a token for the seeded `hermes`
bot. Obtain it privately from `secrets/runtime.env`; creating another gateway uses
a dedicated bot through `POST /admin/bots`. Repeating that provisioning call for
an existing bot rotates its token, so do not use it as a read-only lookup.
For the environment-seeded bot, also coordinate `HERMES_BOT_TOKEN` in the
protected server configuration before the next restart: bootstrap otherwise
reapplies the old environment token. See [seeded bot configuration](hermes-compatibility.md#chattermost-bot-setup). Privileged bot API mutations also return an operation ID; administrators can reconcile it at `GET /admin/bot-operations/{operation_id}` without exposing the one-time token again.

File uploads currently accept PNG, JPEG, GIF, WebP and plain text. General
audio/video/document uploads and mobile background push transport are not
implemented. The public-links toggle affects metadata; the unauthenticated public
file route remains denied. See [client limits](clients.md#current-limits-and-coverage).

## Import

The import helper runs from a source/operator checkout, not inside the production
image (which has no npm/TypeScript toolchain). It reads a Mattermost bulk export
(JSONL) and imports channels, posts, threads, reactions and direct messages. It
does not create accounts and does not copy credentials, attachments, pins, saved
(flagged) posts, edit history or custom emoji. Inspect the export first; nothing
is written without `--apply`:

```bash
npm run import:mm-export -- --file export.jsonl
```

The report counts channels, posts, replies and direct messages, and lists under
`lost` what will not be carried over. To have the server check the plan as well
(unknown teams or channels, and authors without a matching account), add
`--server-url https://chat.example.test`. The admin token comes from the
`CHATTERMOST_IMPORT_TOKEN` environment variable or from `--token-file PATH`,
which must not be readable by group or others (`chmod 600`). A token on the
command line is rejected because other local users and shell history can see it.
Review the report, then rerun with `--apply`.

How the import maps the export:

- **Authors.** Each post is attributed to the active account with the export's
  username, who is added to the channel if needed. An author without an active
  account in the target team is listed in `unmapped_users`; their posts are
  attributed to the importing admin with `props.imported_username`. Create those
  accounts (and add them to the team) before applying to keep authorship.
- **Timestamps and threads.** Posts keep their export `create_at`. Replies stay
  attached to their root, whether nested (`replies`) or flat (`root_id` naming
  the root's export `id`).
- **Teams and channels.** Posts go to the team named in the export; pass
  `--team NAME` to import everything into one existing team. Teams are not
  created. An existing channel with the same name in the team is reused.
- **Direct messages.** Conversations between people who all have accounts are
  imported; others are counted as lost.
- **Batches and retries.** The helper sends threads in batches (4 MiB by default,
  `--batch-bytes`) and stops at the first failure. Each batch is applied in one
  write, so a failed batch leaves nothing behind. Imported posts carry their
  export identity, so rerunning the same command skips what was already imported
  and resumes. Each batch writes one `import.mattermost_archive` audit entry.

Channels with a retention limit purge imported posts older than the limit at the
next retention sweep. Treat exports and output as private; use synthetic exports
in public reports. This helper does not replace a consistent installation
backup/restore; take a backup before a large import.

## Browser administration contracts

`npm run contracts:browser -- --output NEW_DIRECTORY` exports the product-owned
committed public Zod DTOs from `src/shared/browser-admin.ts` and their provenance
checksum. Uncommitted source edits and local environment files are excluded. Browser
clients consume this release artifact without importing backend implementation.

The capabilities endpoint `GET /admin/browser-capabilities` requires an active
administrator and advertises `bot_operation_ids: caller-bound-v1`. New browser
clients supply a fresh 26-character lowercase alphanumeric operation ID before a
bot mutation: `operation_id` for provisioning/identity updates, or the
`X-Bot-Operation-ID` header for token rotation. The ID is bound atomically to the
administrator, action, inputs and committed target. A duplicate or changed request
fails before any credential change. Durable non-secret receipts survive audit
outbox compaction and never contain or replay the one-time token. Existing native
clients can continue to omit this optional contract.

After an interrupted request, query `GET /admin/bot-operations/{operation_id}`.
A committed receipt confirms the effect; a lost one-time token requires a new,
explicit rotation after review. A missing receipt leaves the outcome pending and
must not cause an automatic repeat. Receipts are never automatically pruned; a
full receipt ledger refuses further bound mutations until reviewed maintenance.
