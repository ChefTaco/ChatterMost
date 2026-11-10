# ChatterMost Agent Guide

Optional Oathweave suite sign-in is documented in `docs/oathweave.md`. Preserve
explicit account links, native client compatibility, encrypted session contexts
and online revocation checks. Never downgrade bound sessions into ordinary native
sessions or expose their identity credentials through APIs, logs or WebSocket URLs.

Use this file as the operating skill for future coding work in this repo. Keep changes grounded in the actual checkout and verify with the real commands below.

## Installation runbook for agents

Use this runbook when asked to install ChatterMost or connect a Hermes Agent.
Read [PRIVACY.md](PRIVACY.md) and [container installation](docs/containers.md) first.
For source development, use [docs/development.md](docs/development.md).

1. Establish the intended host and HTTPS origin, and check whether an installation
   already exists. Existing Compose installations use their current manager,
   secrets, volumes and project identity; follow [upgrades](docs/upgrading.md).
   Do not run `setup` over an installation or regenerate its credentials.
2. For a **new** Linux AMD64/ARM64 installation, require Docker Engine, Compose
   v2.24+ (or v5), patched Python 3.11.4+, `curl`, `tar` and `sha256sum`. Use a
   directory outside every Git worktree. Replace the example HTTPS origin below
   with the requested origin; the default app listener is loopback port 8065.

   ```bash
   set -eu
   umask 077
   VERSION=0.4.4
   INSTALL_DIR="$HOME/chattermost-installation"
   test ! -e "$INSTALL_DIR"
   DOWNLOAD_DIR="$(mktemp -d)"
   cd "$DOWNLOAD_DIR"
   curl --fail --location --remote-name "https://github.com/ChefTaco/ChatterMost/releases/download/v$VERSION/chattermost-$VERSION.tar.gz"
   curl --fail --location --remote-name "https://github.com/ChefTaco/ChatterMost/releases/download/v$VERSION/SHA256SUMS"
   awk -v archive="chattermost-$VERSION.tar.gz" '$2 == archive { print; found=1 } END { if (!found) exit 1 }' SHA256SUMS > archive.sha256
   sha256sum --check archive.sha256
   tar xzf "chattermost-$VERSION.tar.gz"
   ./chattermost-"$VERSION"/chattermost --directory "$INSTALL_DIR" setup --server-url https://chat.example.test
   "$INSTALL_DIR/chattermost" --directory "$INSTALL_DIR" start
   "$INSTALL_DIR/chattermost" --directory "$INSTALL_DIR" status
   ```

   Supply verified trusted-proxy CIDRs through `--trusted-proxies` at setup when
   known. Follow the container guide for publisher attestation verification and
   HTTPS/WebSocket proxy configuration. Setup does not install a proxy,
   certificates, a host service or a backup schedule. Use one application writer.
3. Read the generated admin credentials and seeded `HERMES_BOT_TOKEN` privately
   from `$INSTALL_DIR/secrets/runtime.env`; preserve mode 600 and ownership. Do
   not print or transmit the whole file, put tokens in command arguments, or
   commit the installation directory. Confirm the public ping/client config,
   browser login and an authenticated WebSocket `posted` event before reporting
   a working installation. Record exact version/digests and recovery evidence
   only in protected operator storage.
4. Hermes uses its bundled `mattermost-platform` **platform plugin**. On the
   intended Hermes host/profile, run `hermes gateway setup`, select **Mattermost**
   (the upstream adapter name), and set `MATTERMOST_URL` to the ChatterMost HTTPS
   origin, `MATTERMOST_TOKEN` to the existing bot token, and
   `MATTERMOST_ALLOWED_USERS` to the intended humans' 26-character user IDs.
   Keep the gateway allowlist explicit. ChatterMost's legacy
   `HERMES_ALLOWED_USER_IDS` field does not enforce Hermes access control.
5. Start a new gateway with `hermes gateway run`, or restart an existing one through
   its current supervisor. Keep one gateway per bot token. Verify a human-to-bot
   DM and its reply; channel conversations require `@bot` by default. Keep proof
   private. See [Hermes setup](docs/hermes-compatibility.md) for additional bot
   provisioning, profile configuration, token coordination and troubleshooting.

Documentation work does not authorize installation, gateway reconfiguration,
credential rotation or deployment. Published releases are immutable; documentation
updates on `main` do not change the installed 0.4.4 image or bundle.

## Project Shape

ChatterMost is a strictly typed TypeScript/Hono Mattermost-compatible backend for official clients, supervised chat and Hermes Agent communication. It exposes Mattermost-compatible REST under `/api/v4`, WebSocket at `/api/v4/websocket`, and a lightweight web UI from `src/web/assets.ts`.

Important paths:

- `src/server/app.ts`: Hono app, REST routes, middleware, response/error shapes.
- `src/server/index.ts`: Node server startup and direct `ws` upgrade bridge.
- `src/server/services.ts`: service layer and business rules.
- `src/server/store.ts`: JSON file-backed runtime store and metrics state.
- `src/server/domain.ts`: internal record types.
- `src/server/mappers.ts`: Mattermost-compatible snake_case response builders.
- `src/shared/mattermost.ts`: public API types, ID generation, app errors.
- `src/web/assets.ts`: CSS/HTML/JS strings for the web UI.
- `prisma/schema.prisma` and `prisma/migrations/`: deployment database schema/migration artifacts.
- `tests/vitest/` and `tests/playwright/`: unit/integration and browser coverage.
- `scripts/deploy.sh`, `scripts/setup-ssh-cert-auth.sh`, `deploy/nginx.conf`, `deploy/chattermost.service`: deployment tools.
- `BUILD_LOG.md`: short build-session summary replacing the old completed checklist and backlog files.

Runtime state has two backends behind the same service boundary:

- Local/unit tests usually use `JsonStore` or in-memory store paths.
- Production deploy writes `STORE_BACKEND=postgres` and persists runtime state in Postgres through the `RuntimeState` table.

Do not bypass the service layer to write application records directly. The current Postgres runtime store persists the full `StoreState` document; normalized Prisma tables remain compatibility/migration artifacts and future deeper persistence work.

## Non-Negotiable Gates

Before finishing code changes, run:

```bash
npm run privacy:check
npm run typecheck
npm run lint
npm run test:unit
npm run build
npx playwright test
```

For UI-affecting changes, also capture and inspect screenshots with Playwright. Existing final screenshot examples live under `output/playwright/visual/`.

The lint gate is strict typed ESLint with `--max-warnings=0`. Do not weaken rules to make a change pass.

## Local Runtime

Use a patched Node version supported by `package.json`; `.nvmrc` pins source
development, while the Dockerfile pins the container runtime. The production service entrypoint is:

```bash
node dist/src/server/index.js
```

The local dev server is:

```bash
npm run dev
```

`.env` must be mode `600`; startup validation intentionally rejects group/world-readable env files.

For local Postgres smoke, Docker Compose requires `POSTGRES_PASSWORD`:

```bash
env POSTGRES_PASSWORD=dev-postgres-password docker compose up -d postgres
```

If Prisma migration deployment fails, inspect the recorded `_prisma_migrations` evidence in `shared/release-transactions.jsonl`. The deploy fallback is deliberately limited to a byte-matched historical untracked schema; all tracked, drifted, network, permission, checksum, and later-migration failures stop deployment.

Real Postgres runtime smoke:

```bash
CHATTERMOST_POSTGRES_TEST_URL="postgresql://chattermost_app:dev-postgres-password@127.0.0.1:55432/chattermost?schema=public" npx vitest run tests/vitest/postgres-store.test.ts
```

## Mattermost-compatible interfaces

Preserve these compatibility constraints:

- 26-character lowercase alphanumeric public IDs.
- Unix millisecond timestamps.
- Mattermost-compatible errors: `id`, `message`, `detailed_error`, `request_id`, `status_code`.
- External API fields remain snake_case even when internal code is camelCase.
- Version advertisement is controlled by `ALLOW_VERSION_ADVERTISEMENT`.
- Current compatibility version/profile: `11.8.0` / `mattermost-v11.8`.

Auth/CSRF: the Web UI uses the `SameSite=Lax` session cookie (`SESSION_COOKIE_NAME`, default `MMSID`). Cookie-authenticated writes require a same-origin `Origin`/`Referer` matching `SERVER_URL`; bearer-token clients are exempt. Test API calls that authenticate by an accumulated cookie must send an `Origin` header, mirroring a browser (see `tests/playwright/helpers.ts`). Cookie-authenticated WebSocket upgrades require a matching `Origin` (CSWSH guard in `src/server/index.ts` via `isSameWebSocketOrigin`); clients without an `Origin` must use a bearer token.

Install the compatibility CLI separately and set `MMCTL` to its absolute path:

```bash
"$MMCTL"
```

Useful smoke pattern:

```bash
"$MMCTL" --config /tmp/chattermost-mmctl/config auth login "$CHAT_SERVER_URL" --name live-chattermost --username "$CHAT_SERVER_ADMIN_USERNAME" --password-file /tmp/password
"$MMCTL" --config /tmp/chattermost-mmctl/config --json system status
"$MMCTL" --config /tmp/chattermost-mmctl/config --json team list
```

Broader scripted smoke:

```bash
scripts/mmctl-compat-smoke.sh
```

`@hono/node-server` 2.x exports a WebSocket helper, but ChatterMost intentionally retains the direct Node `ws` upgrade bridge in `src/server/index.ts`. That bridge owns Mattermost-specific bearer/cookie authentication, CSWSH enforcement, reconnect sequence handling, frame tracing, payload limits, and graceful shutdown. Preserve those behaviors if the integration is ever replaced.

Mattermost-compatible WebSocket `posted` events are public compatibility payloads, not internal records. Emit `data.post` using `toMattermostPost(...)` and include `channel_id`, `channel_type`, `team_id`, and `sender_name`. Hermes Agent uses `channel_type: "D"` to identify direct messages and skip channel mention gating.

## Web UI Notes

The UI is intentionally compact and operational, not a landing page. Avoid marketing-style rewrites. Keep mobile and desktop layouts free of overlapping or clipped text.

Known UI race: WebSocket fanout can re-render the app while a user is typing. Preserve `state.drafts` behavior in `src/web/assets.ts` so composer drafts survive live refreshes.

Channel creation is panel-based, not prompt-based. `+ Channel` opens the New panel, supports public/private channels, and newly created private channels should land on Members so the creator can add users immediately. The System console rail button should open the System panel, not the Users admin panel.

Direct messaging is panel-based too. `+ DM` opens Direct messages, supports searching people and bot accounts, and should show `Open` for existing conversations or `Message` for new one-to-one DMs. Direct and group conversations have fixed membership; the Members rail should show conversation members only and must not show irrelevant add-user controls.

The desktop inspector has purpose-specific tabs: Members, Files, Pinned, Policy, DMs, New, Profile, and admin-only Users/System/Supervision/Agents/Hermes. Keep controls in the tab where the user expects them; avoid adding a button that only reveals another empty area.

The mobile composer is a fixed footer. Keep message entry, attachment selection, emoji selection, and Send reachable at the bottom of the viewport on iPhone-sized screens. The attachment control should produce visible attachment chips after selection; the emoji control should open a usable grid of emoji choices.

Bot conversations support Hermes slash commands. The web composer submits slash-prefixed text through `/api/v4/commands/execute` and shows a compact command deck; dynamic installed skills remain discoverable through Hermes `/commands`, but only explicitly declared triggers may be forwarded. Preserve exact command text in one-to-one bot DMs, auto-mention the sole bot outside DMs, and require one explicit target when several bots are present. Commands must remain user-authored posts so Hermes receives the original sender identity and enforces its own access policy.

The Light/Dark control in the chat header stores `chattermost-theme` in `localStorage`. When changing theme CSS, verify readable text contrast in both modes rather than relying on visual preference alone.

After visual changes, inspect at least:

- desktop login
- desktop app after login
- mobile app after login
- deployed app screenshot when deployment is part of the task

## Deployment

Deployment settings are private operator configuration in the ignored, mode-600 `.env`. Use `docs/deployment.md` for generic setup and `deploy/ROLLBACK.md` for schema-aware rollback. Never copy a real host, tailnet domain, account, certificate, public host-key pin, or deployment receipt into tracked documentation.

Check `CHAT_SERVER_DEPLOY_MODE` before choosing a deployment workflow. When it is
`compose`, manage the installation at `CHAT_SERVER_COMPOSE_PATH` with its published
`chattermost` manager over the existing pinned SSH connection. Do not invoke the
native `scripts/deploy.sh` workflow or start the retired native service. The mode
is operator routing metadata; legacy scripts intentionally retain their contracts
and do not interpret it. Read `docs/container-migration.md` before crossing a
native/Compose boundary. The container manager's `rollback` command covers prior
container releases, not the retired native installation; migration recovery needs
the protected, installation-specific procedure and current forward data.

For native-mode installations, run `scripts/setup-ssh-cert-auth.sh` when key authentication has not been proven, then `scripts/deploy.sh --force` for an authorized deployment. Create the ignored `deploy/ssh_known_hosts` from a host key verified through an independent trusted channel. Scripts require that pin and strict SSH host checking. Never bypass host verification.

Routine deploys fail closed on established Postgres, cookie, or token-hash secret mismatches. Use the explicit secret-rotation scripts for coordinated rotation; do not generate replacements to work around a failed deployment. Preserve the stable Compose project name, immutable release manifests, digest verification, transaction lock, schema lineage and compatibility checks, read-only preflight, and atomic activation/rollback boundaries.

After an authorized deployment, verify ping, client config and the active service
against the build hash and release ID using private operator configuration. For
Compose, check installed `state.json`, the verified release manifest, selected
image digests and manager `status`; the native `current` symlink is not the active
container release selector. For native installs, verify the resolved `current`
release and native manifest. Redis provides abuse counters only; WebSocket delivery remains process-local. Preserve `ENABLE_REDIS_FANOUT=true` rejection and the false multi-process safety flags.

## Publication privacy and naming

Read `PRIVACY.md` and `CONTRIBUTING.md` before editing. Run `npm run privacy:check` after staging changes and before each commit. Use synthetic records and reserved example domains. Keep `.env`, SSH trust pins, exports, attachments, logs, screenshots, traces, private project metadata, and operational history out of commits. Do not bypass the privacy gate with broad allowlists. Inspect staged diffs and commit author metadata; ignored files can still be force-added.

Describe this project as **Mattermost-compatible**. Keep necessary protocol identifiers, header names, API fields, fixture user agents, and upstream adapter configuration names intact. Do not imply affiliation, certification, endorsement, or full feature parity. Preserve the Apache-2.0 license and third-party notices. Before publishing any Git refs, audit their complete reachable history; deleting a file at HEAD does not remove earlier copies.

## Editing Discipline

- Keep `.env` secret values out of logs and final messages.
- Keep `.env` at `600`.
- Leave unrelated generated data under `data/`, `dist/`, `output/`, and `node_modules/` alone unless the task explicitly concerns them.
- Prefer existing service boundaries over direct route-handler storage changes.
- Add route tests when changing API behavior; add Playwright tests when changing user-visible flows.
- If a task changes deployment, update `docs/deployment.md`, `.env.example`, and this file when the topology or commands change.

## Container distribution

The independent distribution is `distribution/compose.yaml`; `docker-compose.yml`
retains its development/SSH deployment contract. Build `deploy/Dockerfile` targets
`runtime` and `migrator` separately. Read `docs/containers.md`. Use isolated unique
Compose project names and synthetic data for verification. Do not run distribution
commands in the source checkout or touch the existing installation without an
explicit migration instruction. Publication-only work must not trigger deployment.

The standalone lifecycle manager is `distribution/chattermost`. Its release policy
is explicit in `distribution/release-policy.json`; update the package version and
reviewed upgrade paths together. Run `python3 -m unittest discover -s tests/container
-p 'test_*.py'` for lifecycle boundary coverage. Native release jobs exercise the
published baseline plus candidate images before assembling a versioned release;
`tests/container/lifecycle.py VERSION` repeats the proof against public artifacts.
Backups, migration evidence and transaction records are private installation state.
Never auto-restore a database after a failed upgrade or bypass schema validation.

Documentation entry points are `README.md`, `docs/containers.md`,
`docs/upgrading.md` and `docs/releases.md`. Keep supported upgrade sources explicit
and tested; do not infer support from version ordering. `tests/container/lifecycle.py`
tests every `upgrade_from` entry; releases after 0.3.2 must include published 0.3.2.
Run `python3 tests/container/lifecycle.py VERSION --plan` to validate a candidate
policy before builds or publication. Each path proves source backup/restoration,
rollback, retained credentials/data and writes made after upgrading. Historical
0.3.2 verification still uses its published 0.2.3 policy. Keep cross-guide links usable when
`docs/containers.md` is packaged as the distribution's root `README.md`.

For isolated authenticated restore verification, follow the guarded mode in `docs/containers.md`. `AUTHENTICATED_REHEARSAL` requires `HIVE_REHEARSAL`, uses volatile authentication only and never authorizes activation or password resets. Preserve durable state and verify exact peer TLS endpoints.
