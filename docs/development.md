# Source development

For a server installation, use the [published container distribution](containers.md).
This guide is for changing ChatterMost from a source checkout. The runtime is
strict TypeScript/Hono with Mattermost-compatible REST at `/api/v4` and WebSocket
at `/api/v4/websocket`. The compiler enables strict nullability, exact optional
properties, checked indexed access and unused-code/implicit-return checks.

Local JSON storage is useful for development. Production Compose uses Postgres
with one `RuntimeState` document behind the same service layer; the normalized
Prisma tables also define the migration/compatibility schema. Keep one writer.
See [storage scaling](#storage-scaling) for how writes are persisted.

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

## Storage scaling

The whole `StoreState` lives in memory and is persisted as one document (the
`RuntimeState` row `default`, or the JSON store file). Each write runs against a
copy-on-write draft (`createDraft` in `src/server/store.ts`): a top-level field
such as `posts` or `sessions` is copied only when the writer reads or assigns it,
and untouched fields are shared with the previous state, which is never mutated.
Postgres then stores only the touched fields with one atomic
`UPDATE ... SET value = value || patch`; the first write after startup stores the
whole hydrated document, and a missing row falls back to a whole-document write.
The JSON store rewrites its file compactly. A write that does not touch posts
therefore costs the same with 100 or 100,000 posts, which
`tests/vitest/store-scaling.test.ts` guards. A write that touches `posts` still
copies and sends the whole posts array, so its cost grows with history.

The document layout is unchanged, so operator scripts that read
`RuntimeState.value`, backups and rollback to earlier releases keep working.

Planned next steps, in order:

1. **Per-entity rows for history.** Add an expansion-only migration with a
   generic `RuntimeEntity ("collection", "id", "value" JSONB, "update_at")` table
   and move `posts`, `postEditHistory`, `reactions` and `files` there. The
   service layer records which entity IDs a write inserts, changes or removes,
   and the store writes those rows plus the document patch in one transaction,
   so a crash leaves either the old or the new state.
2. **Crash-safe migration.** On first start of that release, one transaction
   copies the arrays into `RuntimeEntity` (`ON CONFLICT DO NOTHING`), empties
   them in the document and sets `storageLayout: 2`; an interrupted migration
   rolls back completely and reruns. The release raises `schema_generation` in
   `deploy/schema-policy.json`, because earlier images would read an empty
   history: rolling back past it requires restoring the pre-upgrade backup,
   which the manager's schema-generation check enforces.
3. **Stop holding all history in memory.** Serve channel pages, search and
   `since=` changes from indexed queries instead of the in-memory arrays.

