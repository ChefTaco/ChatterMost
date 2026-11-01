# ChatterMost

ChatterMost is a strictly typed TypeScript/Hono server that exposes a Mattermost-compatible facade for supervised chat, mobile-style clients, and Hermes Agent communication. It serves Mattermost-compatible REST under `/api/v4`, WebSocket at `/api/v4/websocket`, and a compact operational web UI from `src/web/assets.ts`.

Local tests can use the JSON-backed `JsonStore`, while production deployment uses `STORE_BACKEND=postgres` and persists runtime state in Postgres through the `RuntimeState` table. Prisma/Postgres migrations are part of the operational runtime, not just future scaffolding.

The compiler gate enables strict nullability, exact optional properties, checked indexed access, unused-code checks, implicit-return checks, and unreachable-code checks. Runtime inputs are validated separately at HTTP, WebSocket, environment, and persistence boundaries.

## What Works

- Invite-only signup, login/logout, session cookies, bearer tokens, and bot tokens.
- Teams, public/private channels, direct messages, group messages, threads, reactions, files, profile images, preferences, and statuses.
- Admin panels for invites, users, privacy/system settings, supervision, and agent registry.
- Admin lifecycle controls for reset password, deactivate/reactivate, revoke sessions, invite revoke, and dry-run test-artifact cleanup.
- Direct-message UX from `+ DM`, including existing conversation discovery and dedicated bot accounts.
- Channel inspector tabs for Members, Files, Pinned messages, and channel agent policy.
- Message search, paste/drop file attachments, upload status, recent/searchable emoji, and admin-managed custom emoji.
- Fixed mobile composer with attachment and emoji controls.
- Hermes slash-command routing in bot conversations, with Mattermost-compatible command execution and a command palette in the web composer.
- Mattermost-compatible WebSocket events, including DM `posted` payloads with snake_case posts and `channel_type` for Hermes routing.
- Hermes bot seeding, token rotation, health panel, and repeatable DM smoke automation when `HERMES_BOT_TOKEN` is configured.

## Local Development

Use a patched Node version supported by `package.json` (see `.nvmrc` for the pinned development version).

```bash
npm ci
cp .env.example .env
chmod 600 .env
# Set unique ADMIN_PASSWORD, COOKIE_SECRET, and TOKEN_HASH_SECRET in .env.
env POSTGRES_PASSWORD=dev-postgres-password docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm run dev
```

The local dev server defaults to `http://localhost:8065` unless `SERVER_URL` or `CHAT_SERVER_URL` is changed. `.env` must be mode `600`; startup intentionally rejects group/world-readable env files.

## Verification

Run the full gate before finishing code changes:

```bash
npm run privacy:check
npm run privacy:test
npm run typecheck
npm run lint
npm run test:unit
npm run build
npx playwright test
```

For UI changes, also capture and inspect screenshots. Existing examples live under `output/playwright/visual/`.

Optional real-Postgres runtime smoke:

```bash
CHATTERMOST_POSTGRES_TEST_URL="postgresql://chattermost_app:dev-postgres-password@127.0.0.1:55432/chattermost?schema=public" \
  npx vitest run tests/vitest/postgres-store.test.ts
```

## Deployment

Deployment variables live in `.env`; keep it mode `600`. Set up key authentication first if needed:

```bash
scripts/setup-ssh-cert-auth.sh
scripts/deploy.sh --force
```

Configure your own host, deployment account, paths, secrets, and pinned SSH host key using the [deployment guide](docs/deployment.md). The examples use reserved domains and synthetic identities. Local operator files and runtime data are excluded from source control.

Redis backs distributed rate-limit counters. WebSocket delivery remains process-local; multi-process operation is unsupported.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [PRIVACY.md](PRIVACY.md) before opening a pull request. Run `npm run privacy:check` to check the staged publication surface. CI runs the same privacy check. Report vulnerabilities through the process in [SECURITY.md](SECURITY.md).

## License and compatibility naming

Copyright 2026 ChatterMost contributors. Licensed under the [Apache License, Version 2.0](LICENSE). Dependencies retain their own licenses; third-party tools are installed separately.

ChatterMost is Mattermost-compatible. Mattermost is a trademark of Mattermost, Inc. ChatterMost is independently developed and is not affiliated with, endorsed by, or sponsored by Mattermost, Inc. Compatibility describes the implemented interfaces, not complete feature parity or certification. Protocol names and identifiers are retained where required for interoperability. See [compatibility](docs/compatibility.md) for the supported surface.

## Container distribution

Install published images without a source checkout using the versioned bundles in
[Releases](https://github.com/ChefTaco/ChatterMost/releases). See the
[container installation guide](docs/containers.md) for private setup, HTTPS proxy
requirements, migration safeguards, and release verification.
