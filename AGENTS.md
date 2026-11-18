# ChatterMost Agent Guide

ChatterMost is the Hive:Magnus suite's Mattermost-compatible TypeScript/Hono backend for
official clients and Hermes Agent. The desktop client loads the native web UI, which also
serves standalone installs and native sign-in. New suite UI belongs in HiveXUI's chat module.
Read [PRIVACY.md](PRIVACY.md) and [CONTRIBUTING.md](CONTRIBUTING.md) before editing.

## Installation runbook for agents

1. Confirm the target host, HTTPS origin and whether an installation exists. For an existing
   Compose stack, retain its manager, secrets, volumes and project identity. Follow
   [upgrades](docs/upgrading.md) and never run `setup` again.
2. For a fresh Linux AMD64/ARM64 install, follow the [container runbook](docs/containers.md#install-a-release)
   for prerequisites, exact release and checksum verification before extraction,
   publisher attestation, and `setup`, `start` and `status`. Work outside Git
   worktrees and use a new installation directory and one application writer.
   Configure HTTPS/WebSocket proxying separately, with verified `--trusted-proxies`
   CIDRs when known. Setup does not install a proxy, certificates, host service or backups.
3. Read initial admin credentials and `HERMES_BOT_TOKEN` privately from
   `$INSTALL_DIR/secrets/runtime.env`. Preserve ownership and mode 600. Keep tokens
   out of arguments and logs. Verify public ping and client config, browser sign-in
   and an authenticated WebSocket `posted` event. Record versions, digests and
   recovery evidence in protected operator storage.
4. Follow [Hermes setup](docs/hermes-compatibility.md) on the intended host/profile.
   In `hermes gateway setup`, select **Mattermost**, the bundled `mattermost-platform`
   adapter. Set `MATTERMOST_URL` to the HTTPS origin, `MATTERMOST_TOKEN` to the
   existing bot token and `MATTERMOST_ALLOWED_USERS` to the permitted humans' exact
   26-character IDs. The legacy `HERMES_ALLOWED_USER_IDS` field does not enforce access.
5. Use `hermes gateway run` for a new gateway or its existing supervisor for a restart.
   Keep one gateway per bot token. Verify a human-to-bot DM and reply privately.
   Channel conversations require an `@bot` mention by default.

Documentation work does not authorize installation, gateway changes, credential rotation
or deployment. Released images and bundles are immutable.

## Code map and development

- `src/server/app.ts` owns Hono routes and middleware, `src/server/index.ts` owns
  startup and WebSocket upgrades, and `src/server/services.ts` owns application rules.
- `src/server/{store,domain,mappers}.ts` holds persistence, internal records and
  wire mapping. `src/shared/mattermost.ts` holds API types, IDs and errors.
- `src/web/assets.ts` serves native HTML/CSS/JS. `tests/vitest/` and
  `tests/playwright/` cover API/runtime and browser behavior. `BUILD_LOG.md` tracks sessions.
- Local tests use JSON or in-memory stores. Production uses `STORE_BACKEND=postgres`
  and stores the entire `StoreState` in `RuntimeState`. Normalized Prisma tables
  are compatibility/migration artifacts. Write records through the service layer.
- Use the patched Node version from `.nvmrc` for source and the Dockerfile pin for
  containers. Use `npm run dev` locally. The production entry point is
  `node dist/src/server/index.js`. Startup rejects group/world-readable `.env` files.
  See [local development](docs/development.md) for disposable Postgres and its runtime smoke test.
- Leave unrelated `data/`, `dist/`, `output/` and `node_modules/` alone.
  Add route tests for API changes and Playwright tests for changed user flows.

## Verification

Run the CI gates in [CONTRIBUTING.md](CONTRIBUTING.md) before finishing code changes.
CI also validates the Prisma migration chain with a shadow database. Keep strict
typed ESLint and `--max-warnings=0`. For UI changes, inspect desktop login plus
signed-in desktop and mobile screenshots, and the deployed UI when deployment is
in scope. Keep evidence private under `output/playwright/`.

## Mattermost compatibility

- Keep public IDs 26-character lowercase alphanumeric, timestamps Unix milliseconds,
  wire fields snake_case, and error fields `id`, `message`, `detailed_error`,
  `request_id`, `status_code`. Compatibility is advertised via
  `ALLOW_VERSION_ADVERTISEMENT`. Check the current version/profile in the
  [compatibility guide](docs/compatibility.md).
- Cookie writes require a same-origin `Origin`/`Referer` matching `SERVER_URL`.
  Cookie-authenticated WebSocket upgrades require a matching `Origin` through
  `isSameWebSocketOrigin`. Use bearer tokens for clients without an origin. Browser
  tests with accumulated cookies send `Origin`. Keep the `SameSite=Lax`
  `SESSION_COOKIE_NAME` cookie (default `MMSID`).
- Preserve the direct Node `ws` bridge at `/api/v4/websocket` and its bearer/cookie
  authentication, CSWSH checks, reconnect sequencing, tracing, payload limits
  and graceful shutdown. Check `AuthContext.stillValid` before each delivery and
  client action. Revocation calls `hub.closeUnauthorized()`. Sweep idle sockets
  every 15 seconds and close unauthenticated sockets after 30 seconds.
- Emit `posted` with `data.post` from `toMattermostPost(...)` and include
  `channel_id`, `channel_type`, `team_id` and `sender_name`. Hermes uses
  `channel_type: "D"` to bypass channel mention gating for DMs.
- For client smoke, install verified `mmctl`, set `MMCTL` to its absolute path
  and use the [compatibility smoke commands](docs/compatibility.md#mmctl-smoke).

## Native web UI

- Keep the UI compact, legible in both themes and clear of clipped text on desktop
  and mobile. Preserve `state.drafts` across WebSocket re-renders and the
  `chattermost-theme` preference in `localStorage`.
- `+ Channel` opens New for public/private creation. A new private channel opens
  Members. System opens its own panel. Keep inspector controls in their relevant
  tabs and restrict Users, System, Supervision, Agents and Hermes to admins.
- `+ DM` searches people and bots and shows Open for existing conversations or
  Message for new ones. Direct/group membership is fixed. Show only members in
  their Members rail and omit add-user controls.
- Keep the mobile composer fixed at the bottom with entry, attachment chips, an
  emoji grid and Send reachable on iPhone-sized screens.
- Slash commands go through `/api/v4/commands/execute` as user-authored posts.
  Keep the command deck and discovery via Hermes `/commands`. Forward only
  declared triggers, preserve exact text in one-to-one bot DMs, auto-mention the
  sole bot elsewhere and require one explicit target when multiple bots are present.

## Deployment and release

- Keep deployment configuration in the ignored, mode-600 `.env`. Consult
  [deployment](docs/deployment.md) and [rollback](deploy/ROLLBACK.md) and check
  `CHAT_SERVER_DEPLOY_MODE` first. Update the guide and `.env.example` when topology
  or deployment commands change.
- For `compose`, run the published manager at `CHAT_SERVER_COMPOSE_PATH` over the
  pinned SSH connection. The legacy scripts do not read this routing flag. Keep
  the retired native service stopped. Before crossing that boundary, use
  [container migration](docs/container-migration.md) and the protected
  installation-specific recovery procedure with current forward data. Manager
  rollback covers previous container releases.
- For native mode, prove SSH key auth or use `scripts/setup-ssh-cert-auth.sh`,
  then `scripts/deploy.sh --force` for authorized deployment. Use an independently
  verified pin in ignored `deploy/ssh_known_hosts` and strict host checking.
- Halt routine deploys on Postgres, cookie or token-hash secret mismatches and use
  the explicit rotation workflow. Preserve immutable manifests, digest checks,
  stable Compose project identity, transaction lock, read-only preflight, schema
  lineage and atomic activation/rollback. On Prisma failure, inspect
  `_prisma_migrations` evidence in `shared/release-transactions.jsonl`. Only the
  byte-matched historical untracked schema qualifies for deploy fallback.
- Verify ping, client config and active service against build hash and release ID.
  In Compose, verify `state.json`, the installed manifest, selected image digests
  and manager `status`. In native mode, verify the resolved `current` symlink and
  native manifest. Redis only supplies abuse counters. Keep WebSocket delivery
  process-local, `ENABLE_REDIS_FANOUT=true` rejected and multi-process safety flags false.
- `distribution/compose.yaml` and `distribution/chattermost` ship together.
  Source `docker-compose.yml` serves development/native deployment. Build
  `deploy/Dockerfile` targets `runtime` and `migrator` separately. Verify with
  synthetic data, isolated Compose projects and no distribution runs in Git worktrees.
- Match package version and reviewed `upgrade_from` paths in
  `distribution/release-policy.json`. See [the release guide](docs/releases.md).
  Run `npm run container:test` and `python3 tests/container/lifecycle.py VERSION --plan`.
  The lifecycle run without `--plan` proves each path against public artifacts,
  including backup/restore, rollback, retained credentials/data and post-upgrade writes.
  Keep published 0.3.2 in policies for newer releases. Historical 0.3.2 testing
  uses its published 0.2.3 policy. Native release jobs prove the published baseline
  against candidate images before assembling the release. Preserve links when
  `docs/containers.md` becomes the bundle README.
- Keep transaction, migration and backup evidence private. Never auto-restore
  after a failed upgrade or bypass schema validation. Follow the container
  runbook for authenticated restore rehearsals. `AUTHENTICATED_REHEARSAL`
  requires `HIVE_REHEARSAL`, volatile authentication and exact peer TLS checks.
  Preserve durable state. This mode grants no activation or password resets.

## Oathweave and publication privacy

- Preserve explicit identity links, native clients, encrypted session contexts and
  online revocation. Keep credentials out of APIs, logs and socket URLs. Bound
  sessions cannot downgrade to native sessions. See [Oathweave](docs/oathweave.md).
- Installation-owned provisioning uses the live server's loopback-only TLS endpoint
  and separate `HIVE_ADMIN_PROVISIONING_SECRET`. Keep it disabled when absent.
  Preserve exact operation/issuer/subject/native-ID binding, permanent receipts and
  existing users, memberships, sessions and messages. IAM roles alone grant no
  account link. Never start a second writer. Follow the
  [provisioning contract](docs/oathweave.md#hive-administrator-provisioning).
- Use synthetic fixtures and reserved domains. Keep `.env` values, SSH pins,
  exports, attachments, logs, screenshots, traces and operator metadata out of
  commits and messages. Inspect the staged diff and author metadata, run
  `npm run privacy:check` after staging and keep the hooks/allowlists strict.
  Audit all reachable history before first publication of any Git refs.
- Describe the project as **Mattermost-compatible**. Preserve necessary protocol
  identifiers, fixture user agents, upstream adapter names, Apache-2.0 and
  third-party notices. Avoid claims of affiliation, endorsement or full parity.
