# Admin Guide

Admins sign in with the configured administrator account. Compose setup stores
its initial credentials in the protected installation `secrets/runtime.env`;
source/native installations bootstrap from `.env` or `CHAT_SERVER_ADMIN_*` values.
Keep the current administrator password in the protected readiness configuration
when changing it through HiveXUI or the API. See [container operations](containers.md) and
[upgrades/recovery](upgrading.md) before installation-level changes.

People can connect official apps to the same backend using the [client guide](clients.md).
For agents, configure Hermes' bundled `mattermost-platform` platform plugin using
[Hermes setup](hermes-compatibility.md#quick-setup). ChatterMost no longer ships its
own web UI: [HiveXUI](https://github.com/ChefTaco/HiveXUI) is the browser UI for the
Hive:Magnus product line, and its chat module administers ChatterMost through the
admin API and the [browser contracts](#browser-administration-contracts) below.
The old `/`, `/login`, `/signup` and `/admin/system-console` paths serve a short
notice, or redirect to HiveXUI when `HIVEXUI_URL` is set.

## Conversations

The official apps and HiveXUI provide channels, DMs, threads, reactions, pins,
attachments and emoji through the Mattermost-compatible API. Private channels are
visible only to listed members; channel admins and system admins can add members.
Direct messages are fixed one-to-one conversations and group direct messages are
fixed multi-user conversations.

Slash commands are text-only. One-to-one bot DMs need no mention. Group DMs and channels with one bot target it automatically; conversations with multiple bots require one explicit `@bot`. Hermes enforces the sender's command access and any confirmation prompt.

## Administration

Administrators use HiveXUI's chat module, or the admin API directly, to:

- Create one-use invites, and review or revoke active invites.
- List users, revoke user sessions, deactivate, reactivate and reset passwords.
- Dry-run and apply cleanup for generated `testotron-*` users and `Test*` channels.
- Manage privacy and compatibility settings: telemetry, diagnostics, security alert
  checks, email/full-name visibility, file uploads, public links, custom emoji and
  bot creation.
- Switch supervision between audit-only and pre-moderation. Backend policy support also includes disabled and post-moderation modes.

Use agent administration to register native AI agents, edit structured permissions/allowlists/memory policy, and run policy simulation.

Use Hermes administration to review bot-token configuration, bot accounts, WSS connection count, last bot post, recent agent events, and to rotate the bot token intentionally. A rotated token is shown only in the rotation response; update Hermes immediately.
This reports backend bot state; it does not install or start a Hermes
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
outbox compaction and never contain or replay the one-time token. Older clients can
continue to omit this optional contract.

After an interrupted request, query `GET /admin/bot-operations/{operation_id}`.
A committed receipt confirms the effect; a lost one-time token requires a new,
explicit rotation after review. A missing receipt leaves the outcome pending and
must not cause an automatic repeat. Receipts are never automatically pruned; a
full receipt ledger refuses further bound mutations until reviewed maintenance.
