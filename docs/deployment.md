# Deployment

ChatterMost deploys from this checkout to your deployment host through `scripts/deploy.sh`. Release archives exclude local environment files, SSH trust pins, private operator directories, and separately installed CLI binaries. The script builds once locally, transfers one immutable artifact and release manifest, verifies their SHA-256 digests remotely, then holds a non-blocking remote `flock` across migration, isolated preflight, reversible infrastructure promotion, and activation. Failed restart or health validation restores the previous code, environment, systemd unit, and nginx site only when the previous release declares support for the current schema generation.

All hostnames and identities below are synthetic. Store real values only in the ignored `.env` and private operator notes. `deploy/ssh_known_hosts`, private SSH keys, certificates, release receipts, and backups must never be committed. The public default key path is `~/.ssh/chattermost_deploy_ed25519`; set `CHAT_SERVER_DEPLOY_SSH_KEY` in `.env` for a different existing key. Provision a sudo-capable deploy account and a writable `CHAT_SERVER_DEPLOY_PATH` before the first deployment.

## Required Local State

- `.env` exists and is mode `600`.
- Node 22 or newer is available locally.
- SSH key auth to `CHAT_SERVER_DEPLOY_USER@CHAT_SERVER_DEPLOY_HOST` works, or `scripts/setup-ssh-cert-auth.sh` can install it. Create the ignored `deploy/ssh_known_hosts` with your server's ED25519 public host key, verified through an independent trusted channel; an unexpected host-key change fails closed. A host key obtained by `ssh-keyscan` alone is not verified.
- Docker is available on the deployment host for Postgres.
- Redis is available on the deployment host at `redis://127.0.0.1:6379` for distributed rate-limit counters. WebSocket fanout remains local to one Node process; `ENABLE_REDIS_FANOUT=true` is invalid, and multiple application instances would require sticky connections until real pub/sub fanout exists.

The deploy script requires these deployment variables:

```bash
CHAT_SERVER_URL=https://chat.example.test:9443
CHAT_SERVER_DEPLOY_USER=chattermost
CHAT_SERVER_DEPLOY_HOST=chat.example.test
CHAT_SERVER_DEPLOY_PATH=/srv/chattermost
CHAT_SERVER_ADMIN_USERNAME=admin
CHAT_SERVER_ADMIN_PASSWORD=<secret>
```

`CHAT_SERVER_COOKIE_SECRET`, `CHAT_SERVER_TOKEN_HASH_SECRET`, and `CHAT_SERVER_POSTGRES_PASSWORD` may be supplied locally for a first deployment. On an established target, the deploy script reads them from the protected active release environment at `current/.env` (with `shared/.env` accepted only as a compatibility fallback) when they are omitted locally, preserving sessions, tokens, and database access. Missing or unreadable protected values on an established target are fatal; routine deployment never generates replacements. Generation is limited to a target positively identified as a first installation.

The deploy script builds the complete runtime environment in a mode-600 local tempfile under `umask 077`, serializes every value with dotenv-compatible JSON quoting, and sends it only through SSH standard input to `<release>/.env`. Secret values are never interpolated into SSH command arguments. Spaces, `#`, quotes, backslashes, equals signs, and Unicode round-trip exactly.

Production runtime environments explicitly set `ENABLE_DEV_DEFAULTS=false`.
Application startup also rejects that switch when `NODE_ENV=production`, even
when every other setting is present, and refuses the repository's known
development/example admin, cookie-signing, and token-hashing values. Local test
helpers may enable the defaults only outside production.

`TOKEN_HASH_SECRET` independently keys API, bot, invite, and webhook token hashes. Existing installations are migrated by preserving the prior cookie secret as this token key, so a later cookie-secret rotation can invalidate browser sessions without silently breaking Hermes or personal access tokens.

Routine deployment compares the established token-hash secret exactly like the Postgres and cookie secrets and rejects any mismatch. Rotate it only through its dedicated preview and confirmation workflow:

```bash
scripts/rotate-token-hash-secret.sh --preview
scripts/rotate-token-hash-secret.sh --confirm ROTATE_CHATTERMOST_TOKEN_HASH_SECRET
```

The preview reports live counts for affected bot tokens, personal access tokens, invite codes, and webhooks, while confirming that browser sessions and database credentials are unchanged. The rotation retains the prior environment and restores it automatically if restart or health validation fails.

For a deployment using Tailscale certificates, replace the example hostname with your own eligible node hostname and use:

```bash
CHAT_SERVER_PORT=9443
CHAT_SERVER_INTERNAL_PORT=19065
CHAT_SERVER_TLS_PORT=9443
CHAT_SERVER_DEPLOY_TAILSCALE=true
CHAT_SERVER_DEPLOY_TAILSCALE_CERT=true
```

`CHAT_SERVER_DEPLOY_TAILSCALE_CERT=true` means "derive the certificate host from `CHAT_SERVER_URL`"; do not pass the literal string `true` to `tailscale cert`.

Install the ChatterMost-owned certificate renewal timer after first deployment or when moving certificate ownership from another service on the host:

```bash
scripts/install-cert-renewal.sh
```

The twice-weekly timer stages the renewed certificate and key, verifies certificate lifetime and hostname, validates the complete nginx configuration, and reloads nginx only after every check passes.

## Commands

```bash
scripts/setup-ssh-cert-auth.sh
scripts/deploy.sh --force
```

Protected values are rotated only through the confirmation-gated workflow:

```bash
scripts/rotate-deployment-secrets.sh --postgres --confirm ROTATE_CHATTERMOST_SECRETS
scripts/rotate-deployment-secrets.sh --cookie --confirm ROTATE_CHATTERMOST_SECRETS
scripts/rotate-deployment-secrets.sh --postgres --cookie --confirm ROTATE_CHATTERMOST_SECRETS
```

Rotation stops the service, retains a timestamped rollback environment, stages secrets over SSH stdin, coordinates the Postgres role password before switching the env, and checks the internal health endpoint. Cookie rotation snapshots runtime state, switches the signing secret, then clears browser sessions while preserving `TOKEN_HASH_SECRET`; a failed rotation restores the prior environment, database role, and runtime-state snapshot.

Useful deploy flags:

- `--skip-tests`: skip local typecheck/lint/Vitest inside the deploy script.
- `--stage`: build and upload an immutable release without starting Postgres, running migrations, changing systemd/nginx/certificates, or restarting the service.
- `--migrate --manifest <remote-path>`: migrate the exact staged manifest and write its migration-complete marker under the deployment lock.
- `--activate --manifest <remote-path>`: preflight and activate a successfully migrated manifest under the deployment lock.
- `--no-restart`: deprecated alias for the genuinely non-mutating `--stage` phase.
- `--env-file <path>`: deploy with a non-default env file.

The normal command performs all three phases while retaining one lock from migration through activation. For an operator-controlled split:

```bash
scripts/deploy.sh --stage --force
scripts/deploy.sh --migrate --manifest /srv/chattermost/releases/<release-id>/release-manifest.json
scripts/deploy.sh --activate --manifest /srv/chattermost/releases/<release-id>/release-manifest.json
```

Activation rejects a missing or mismatched migration marker and immediately rejects another active transaction. Release IDs combine UTC time, commit SHA, and a random 48-bit suffix rather than relying on one-second timestamps alone. Preflight sets `PREFLIGHT_MODE=true`, disables bootstrap/repair and Redis initialization, exposes only the ping route, rejects writes in the store, and adds PostgreSQL `default_transaction_read_only=on`.

Without `--skip-tests`, deploy runs:

```bash
npm ci
npm run typecheck
npm run lint
npm run test:unit
npm run build
```

Run `npx playwright test` separately before or after deploy for the browser gate.

The lockfile currently resolves `@hono/node-server` 2.x, whose engine floor is Node 20. ChatterMost requires Node 22 or newer and the deploy script verifies that minimum on the deployment host. Run `npm audit` after dependency changes; the supported tree is expected to report zero known vulnerabilities.

## Security Fusion Provisioning And Export

`SECURITY_FUSION_SERVICE_TOKEN_HASH` is optional. Leave it unset to disable the dedicated audit exporter; generated runtime environments omit the key entirely. When enabled, it must be the lowercase 64-character SHA-256 hash of the collector credential.
Configure the hash in the protected deployment `.env`. Keep the plaintext credential only in the collector's protected environment. Verify that authenticated reads of `/api/v4/security/events` return events from a synthetic login/logout. Syslog and other log transport are configured separately by each operator.

Run `npm run provision:security-fusion` only with `CHAT_SERVER_URL` set to an HTTPS ChatterMost origin (plain HTTP is accepted only on loopback) and `SECURITY_FUSION_CREDENTIAL_OUTPUT` set to a protected Magnus environment file. Provisioning verifies the public ChatterMost identity before sending admin credentials, refuses redirects, and bounds response time and size. An idempotent rerun preserves the existing `magnus-security` token from that output file. If the bot already exists but the credential file is unavailable, provisioning stops rather than rotating the live token; token rotation requires a separately designed coordinated rotation workflow.

The audit exporter returns durable decimal sequence cursors. Consumers must persist `nextCursor` after processing a page. A `410` response with `code: "CURSOR_EXPIRED"` reports `earliest_available_cursor` and `earliest_available_sequence`; Magnus should record the missing sequence range before resuming from the supplied earliest cursor.

## Remote Runtime

Each immutable release owns its runtime environment and integrity-checked manifest at:

```text
/srv/chattermost/releases/<release-id>/.env
/srv/chattermost/releases/<release-id>/release-manifest.json
```

Runtime data paths on the deployment host:

- Releases: `/srv/chattermost/releases/<release-id>`
- Current symlink: `/srv/chattermost/current`
- Runtime state: Postgres `RuntimeState` table with `STORE_BACKEND=postgres`
- JSON fallback path: `/srv/chattermost/shared/chattermost-store.json`
- Files: `/srv/chattermost/shared/files`
- Profile images: `/srv/chattermost/shared/profile-images`
- Postgres: Docker Compose project `chattermost`, published on `127.0.0.1:55432`
- Service: `chattermost.service`
- TLS/nginx public URL: `https://chat.example.test:9443`

## Live Verification

After deployment, prove ChatterMost is live:

```bash
curl -fsS https://chat.example.test:9443/api/v4/system/ping
curl -fsS https://chat.example.test:9443/api/v4/config/client
ssh -i ~/.ssh/chattermost_deploy_ed25519 -o BatchMode=yes chattermost@chat.example.test 'systemctl is-active chattermost.service'
node --input-type=module -e 'import WebSocket from "ws"; const ws = new WebSocket("wss://chat.example.test:9443/api/v4/websocket"); ws.once("open", () => { console.log("wss open"); ws.close(); }); ws.once("error", (error) => { console.error(error.message); process.exit(1); });'
```

Expected service state: `active`.

The ChatterMost ping includes:

```json
{
  "status": "OK",
  "version": "11.8.0",
  "build_number": "chattermost-0.1.0",
  "build_hash": "<git-short-sha>",
  "release_id": "<utc>-<commit>-<random>",
  "compatibility_profile": "mattermost-v11.8"
}
```

The deploy script writes `BUILD_HASH`, `BUILD_DATE`, and `RELEASE_ID` to the release env so `/api/v4/system/ping` and `/api/v4/config/client` can be matched to the deployed git revision. `shared/release-transactions.jsonl` is a mode-600 ledger containing artifact/configuration digests, schema generation, migration-set and lineage digests, migration state, secret fingerprints, health evidence, and rollback targets. A failed Prisma migration records the failed migration identity and a redacted snapshot of `_prisma_migrations` before deployment stops.

Routine deployment parses every PostgreSQL migration into an AST and enforces the structural allowlist in `deploy/schema-policy.json` before the artifact is built and again on the host. Existing-data rewrites, stored code, `DO`/dynamic SQL, procedure calls, destructive or narrowing alterations, unique indexes, validated constraints, implicit serial columns, and populated-table `NOT NULL` additions without a constant non-null default are rejected regardless of comments, CTE nesting, or keyword placement. New tables/types/sequences, approved idempotent extensions, non-unique indexes, nullable or constant-default columns, and new `CHECK`/foreign-key constraints declared `NOT VALID` remain permitted.

Version-3 release manifests pin the migration-set digest, a SHA-256 chained schema-lineage head and depth, schema generation and compatibility range, and normalized legacy/current schema hashes. Application rollback requires both generation compatibility and proof that the previous release's verified lineage head is the exact current head or a chained ancestor. Version-2 and older manifests have no ancestry commitment, so the transition rollback path is fail-closed unless their migration-set digest exactly matches the current set.

Migration fallback is limited to the exact historical untracked ChatterMost schema: `_prisma_migrations` must be absent, and the normalized live schema hash must equal the digest pinned in the release manifest. Only that known state receives its two missing historical indexes; the post-repair hash must then equal the separately pinned current-schema digest. Both hashes are written to the deployment ledger. Network, permission, checksum, drift, and tracked/later-migration failures stop the transaction.

Rendered infrastructure lives under `shared/infrastructure/releases/<release-id>/`. Candidate systemd and nginx files are validated before promotion. Activation switches `/etc/systemd/system/chattermost.service` and the nginx site to release-owned immutable files; a failed health check restores the prior infrastructure targets together with the prior code release.

`SIGTERM` and `SIGINT` stop accepting upgrades, close active WebSockets, drain the HTTP server, flush in-memory metrics, and disconnect Postgres before exit. Systemd should normally use this graceful path rather than killing the Node process directly.

Postgres runtime smoke for local Docker:

```bash
CHATTERMOST_POSTGRES_TEST_URL="postgresql://chattermost_app:dev-postgres-password@127.0.0.1:55432/chattermost?schema=public" \
  npx vitest run tests/vitest/postgres-store.test.ts
```

Operator smoke scripts:

```bash
node --import tsx scripts/cleanup-test-artifacts.ts
node --import tsx scripts/cleanup-test-artifacts.ts --apply
CHAT_SERVER_SMOKE_BOT_USERNAME=hermes node --import tsx scripts/hermes-dm-smoke.ts
CHAT_SERVER_SMOKE_BOT_USERNAME=hermes CHAT_SERVER_SMOKE_MESSAGE=/arxiv node --import tsx scripts/hermes-dm-smoke.ts
scripts/mmctl-compat-smoke.sh
```

`cleanup-test-artifacts.ts` defaults to dry-run. `hermes-dm-smoke.ts` reuses the configured allowlisted smoke actor and prints a redacted proof summary without creating disposable users. For ordinary messages it requires the reply to carry a random correlation value. For slash commands it appends a unique exact-response request and accepts only a later response from the selected bot carrying that value; use a prompt-bearing command such as the explicitly declared `/arxiv` command rather than a fixed-output command such as `/status`. Set `CHAT_SERVER_SMOKE_BOT_USERNAME` to your gateway bot; its fallback uses the seeded `@hermes` account.
`mmctl-compat-smoke.sh` uses `mmctl` for auth, status, teams, channels, users, and posts, then uses authenticated Mattermost-compatible REST calls for file and reaction coverage for CLI versions without file or reaction command groups. Install `mmctl` separately and set `MMCTL` to its absolute path; no third-party binary is distributed here.

## Proxy Requirements

Nginx must preserve WebSocket upgrade headers. The template in `deploy/nginx.conf` is ready for Tailscale certificates generated with `tailscale cert`.

The rendered nginx site accepts only the configured certificate hostname, redirects port 80 to the configured TLS hostname and port, and sends HSTS on TLS responses. The systemd unit runs without capabilities or device access and uses read-only home/system mounts except for the release's explicit shared state path.

The reverse proxy must forward client `Origin` and `Referer` headers unchanged. Cookie-authenticated Web UI writes validate those headers against `SERVER_URL`; stripping or rewriting them breaks browser writes.

Set `TRUSTED_PROXIES` to the exact CIDRs allowed to append forwarding data. The deployment defaults to loopback only (`127.0.0.1/32,::1/128`) because nginx and ChatterMost share the host. Direct clients and untrusted peers cannot influence source identity with `X-Forwarded-For` or `X-Real-IP`; trusted requests are resolved by walking the complete chain from the socket peer to the first untrusted hop. Rate limiting keeps independent bounded source-address and login-account counters and evicts old keys instead of merging unrelated traffic into an overflow identity.

Production sets `ENABLE_DISTRIBUTED_RATE_LIMIT=true`, so the counters are atomic Redis keys shared by every instance. The admin `/api/v4/metrics` response includes `abuse_control` telemetry for source/account checks and throttles, trusted-proxy decisions, local fallback evictions, Redis errors, and whether enforcement is cross-instance consistent.

`GET /api/v4/ha/status` deliberately reports `websocket_fanout_mode: local-process`, `redis_fanout_enabled: false`, `sticky_session_free_websockets: false`, and `multi_process_websocket_safe: false`. Redis-backed rate limits do not make WebSocket delivery horizontally available.

## Backups And Rollback

Backups:

```bash
scripts/backup.sh
```

Rollback instructions live in `deploy/ROLLBACK.md`.
## Code-only rollback

`COUNCIL_CODE_RELEASE=1 scripts/deploy.sh --stage` stages an inactive, immutable
release and records its artifact digest. The same environment setting on
`scripts/deploy.sh --force` requires the new and current migration-set digests
to be identical before activation. The deploy emits its native release ID,
previous release ID, artifact SHA-256, installed full Git revision, health,
and public configuration read.

For that exact successful code-only release, use
`scripts/deploy.sh --rollback PREVIOUS_ID --expected-current CANDIDATE_ID`.
The rollback transaction checks the active symlink, immutable manifests,
release ledger predecessor, identical schema lineage/configuration, and
`schema-policy.mjs` compatibility before changing code. It restores the
previous app and infrastructure links, restarts, probes internal and public
health, and retains the forward PostgreSQL database. A migration-bearing
release is held for reviewed database/code reconciliation instead.
