# ChatterMost

ChatterMost is a strictly typed TypeScript/Hono server that exposes a Mattermost-compatible facade for supervised chat, mobile-style clients, and Hermes Agent communication. It serves Mattermost-compatible REST under `/api/v4`, WebSocket at `/api/v4/websocket`, and a compact operational web UI from `src/web/assets.ts`.

Local tests can use the JSON-backed `JsonStore`, while production deployment uses `STORE_BACKEND=postgres` and persists runtime state in Postgres through the `RuntimeState` table. Prisma/Postgres migrations are part of the operational runtime, not just future scaffolding.

The compiler gate enables strict nullability, exact optional properties, checked indexed access, unused-code checks, implicit-return checks, and unreachable-code checks. Runtime inputs are validated separately at HTTP, WebSocket, environment, and persistence boundaries.

## Install the published distribution

Use the versioned Compose bundle from [GitHub Releases](https://github.com/ChefTaco/ChatterMost/releases).
The current published lifecycle release is [0.3.2](https://github.com/ChefTaco/ChatterMost/releases/tag/v0.3.2).
No source checkout, Node installation, registry login, or local image build is needed
on the installation host. See [container installation](docs/containers.md) for
requirements, download/integrity checks, protected setup and HTTPS proxy configuration.

Public images are available for `linux/amd64` and `linux/arm64`:

| Image | Purpose |
| --- | --- |
| [`ghcr.io/cheftaco/chattermost`](https://github.com/users/ChefTaco/packages/container/package/chattermost) | Non-root application runtime |
| [`ghcr.io/cheftaco/chattermost-migrator`](https://github.com/users/ChefTaco/packages/container/package/chattermost-migrator) | One-off locked schema validation/migration |

Select an explicit version; the bundle pins application, migrator, Postgres and
optional Redis image digests. Keep one application instance. Redis supplies abuse
counters; WebSocket delivery and runtime writes are not distributed.

For existing installations, follow [upgrades and recovery](docs/upgrading.md).
The reviewed container upgrade is **0.2.3 → 0.3.2**. A native-to-Compose move needs
the separate [migration procedure](docs/container-migration.md). Do not use `setup`
to replace an existing installation or its credentials.

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

Use a patched Node version supported by `package.json`; `.nvmrc` pins the
source-development version. Install dependencies and create a private development
environment without overwriting an existing `.env`:

```bash
npm ci
cp -n .env.example .env
chmod 600 .env
# Set unique ADMIN_PASSWORD, COOKIE_SECRET, and TOKEN_HASH_SECRET in .env.
npm run dev
```

The default `STORE_BACKEND=json` uses local files. Startup bootstraps the configured
administrator and default records; a separate seed command is unnecessary. The
listener uses `PORT` (default `8065`); `SERVER_URL` is the browser-facing origin and
does not change the listening port. `.env` must remain mode `600`.

For optional local Postgres development, set `STORE_BACKEND=postgres`, a unique
`POSTGRES_PASSWORD` and a matching `DATABASE_URL` in the private `.env`. The source
Compose file exposes only Postgres on loopback port `55432`; use a distinct project
so it cannot reuse an operator installation's volumes:

```bash
docker compose -p chattermost-dev up -d --wait postgres
npm run db:migrate
npm run dev
```

If port `55432` is occupied, set `POSTGRES_PORT` and update `DATABASE_URL` to match.
The source `docker-compose.yml` is a development/native Postgres helper; it is not
the distributable stack in `distribution/compose.yaml`.

## Verification

Run the full gate before finishing code changes:

```bash
npm audit --audit-level=moderate
npm run privacy:check
npm run privacy:test
npm run container:test
npm run typecheck
npm run lint
npm run test:unit
npm run build
npx playwright install chromium
npx playwright test
```

For UI changes, also capture and inspect screenshots. Existing examples live under `output/playwright/visual/`.

Optional real-Postgres runtime smoke, against a disposable database configured
with the synthetic credentials below:

```bash
CHATTERMOST_POSTGRES_TEST_URL="postgresql://chattermost_app:dev-postgres-password@127.0.0.1:55432/chattermost?schema=public" \
  npx vitest run tests/vitest/postgres-store.test.ts
```

## Operations and documentation

| Task | Guide |
| --- | --- |
| Install and manage the container stack | [Containers](docs/containers.md) |
| Upgrade, recover, restore or roll back | [Upgrade paths](docs/upgrading.md) |
| Move an existing native installation to Compose | [Native migration](docs/container-migration.md) |
| Maintain an existing native SSH/systemd installation | [Native deployment](docs/deployment.md) |
| Publish versions, GHCR images and release artifacts | [Maintainer releases](docs/releases.md) |
| Administer users, bots, channels and imports | [Admin guide](docs/admin-guide.md) |
| Configure Hermes | [Hermes compatibility](docs/hermes-compatibility.md) |
| Understand API support and privacy | [Compatibility](docs/compatibility.md), [runtime privacy](docs/privacy.md) |

Check private `CHAT_SERVER_DEPLOY_MODE` before choosing operations. A Compose
installation uses its installed `chattermost` manager, not `npm run deploy` or the
native deployment/rotation scripts. Keep deployment configuration, backups and
operational evidence outside Git.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [PRIVACY.md](PRIVACY.md) before opening a pull request. Run `npm run privacy:check` to check the staged publication surface. CI runs the same privacy check. Report vulnerabilities through the process in [SECURITY.md](SECURITY.md).

## License and compatibility naming

Copyright 2026 ChatterMost contributors. Licensed under the [Apache License, Version 2.0](LICENSE). Dependencies retain their own licenses; third-party tools are installed separately.

ChatterMost is Mattermost-compatible. Mattermost is a trademark of Mattermost, Inc. ChatterMost is independently developed and is not affiliated with, endorsed by, or sponsored by Mattermost, Inc. Compatibility describes the implemented interfaces, not complete feature parity or certification. Protocol names and identifiers are retained where required for interoperability. See [compatibility](docs/compatibility.md) for the supported surface.

The repository is public; `package.json` remains `private: true` to prevent
accidental npm publication. Supported binary distribution is through GHCR and
GitHub release bundles. Retain [NOTICE](NOTICE), dependency licenses and the image's
`THIRD_PARTY_NOTICES.json` when redistributing. See the [release guide](docs/releases.md)
for publication privacy and integrity checks.
