# Source development

For a server installation, use the [published container distribution](containers.md).
This guide is for changing ChatterMost from a source checkout. The runtime is
strict TypeScript/Hono with Mattermost-compatible REST at `/api/v4` and WebSocket
at `/api/v4/websocket`. The compiler enables strict nullability, exact optional
properties, checked indexed access and unused-code/implicit-return checks.

Local JSON storage is useful for development. Production Compose uses Postgres
with one `RuntimeState` document behind the same service layer; the normalized
Prisma tables also define the migration/compatibility schema. Keep one writer.

Use a patched Node version supported by [`package.json`](../package.json); `.nvmrc` pins the
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

For UI changes, also capture and inspect screenshots. Keep local screenshots and
traces under ignored `output/playwright/`; never publish live evidence.

Optional real-Postgres runtime smoke, against a disposable database configured
with the synthetic credentials below:

```bash
CHATTERMOST_POSTGRES_TEST_URL="postgresql://chattermost_app:dev-postgres-password@127.0.0.1:55432/chattermost?schema=public" \
  npx vitest run tests/vitest/postgres-store.test.ts
```
