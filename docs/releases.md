# Open source and container releases

The public repository distributes ChatterMost source under Apache-2.0 and publishes
container images plus installation bundles. `package.json` is intentionally
`private: true`; this project is not published to npm. Preserve `LICENSE`, `NOTICE`
and third-party licenses/inventory. Describe the project as Mattermost-compatible;
protocol identifiers remain intact and compatibility does not imply endorsement
or full feature parity. See [contributing](../CONTRIBUTING.md) and
[publication privacy](../PRIVACY.md).

Documentation on `main` can improve independently of a runtime release. Each
published bundle contains a frozen installation README; editing source docs does
not update an existing release asset or installed image. Keep published releases immutable and
publish a new version only for an intentional distribution change. Client and
Hermes instructions live in the [client guide](clients.md),
[Hermes guide](hermes-compatibility.md) and [agent runbook](../AGENTS.md#installation-runbook-for-agents).

## Unreleased

Changes on `main` since 0.8.0. They ship in the next release.

- **Mattermost import works on real bulk exports.** Posts keep their export
  author and timestamp, replies stay in their threads, reactions and direct
  messages are imported, and the helper sends the export in batches that are
  each applied in one write. Rerunning after a failure resumes without
  duplicates. See [import](admin-guide.md#import).
- **Webhook lifecycle.** Incoming webhooks can be listed, disabled, rotated and
  deleted, and every change is audited. Creating one now requires an active
  channel that includes the creator.
- **Outgoing webhooks** (off by default, `ENABLE_OUTGOING_WEBHOOKS`): trigger
  words in public channels are sent to an external URL and a JSON reply is
  posted back. Callbacks to internal addresses need
  `OUTGOING_WEBHOOK_ALLOWED_HOSTS`. See [webhooks](admin-guide.md#webhooks).
- **Cheaper writes on large installations.** A write copies and stores only the
  parts of the state it changes, so most writes (sign-ins, statuses, read
  markers, audit entries) no longer slow down as message history grows. The
  stored layout is unchanged; no migration. The JSON store file is written
  without indentation. See [storage scaling](development.md#storage-scaling).

### Upgrade notes (unreleased)

- The import helper no longer accepts `--token`. Set `CHATTERMOST_IMPORT_TOKEN`
  or pass `--token-file PATH` (mode 600).
- `POST /api/v4/import/mattermost` reuses an existing channel with the same name
  in the team instead of creating a second one, and accepts requests up to
  16 MiB. Its response keeps the earlier fields and adds per-batch counts.
- `POST /api/v4/webhooks/incoming` now rejects a missing or archived channel and
  a channel the creating admin is not a member of. Existing webhooks keep working.

## Changes in 0.8.0

Channel retention limits are now enforced, which permanently deletes data on
upgraded installations that have a limit set. **Read the upgrade notes before
upgrading.** No database migration was added. 0.7.2 is an additional reviewed
upgrade source.

### Upgrade notes for 0.8.0

> **Warning: channels with a retention limit lose older posts and files within
> about an hour of upgrading.** Earlier releases saved the channel Policy form's
> **Retention days** value but never applied it. On its first start, 0.8.0 moves
> every such saved value onto the channel, where it is enforced, and also enforces
> any `retention_days` set through the channel patch or import APIs. The first
> purge runs one minute after startup and then hourly. It permanently deletes
> every post older than the limit in that channel, with its edit history,
> reactions and attachment files, plus older uploads no kept post references.
> Rolling back does not bring them back; only a backup taken before the upgrade does.

Before upgrading, list the channels that will be purged. For a Compose
installation (substitute your installation directory):

```bash
cd /srv/chattermost
sudo docker compose --project-name "$(sudo python3 -c 'import json; print(json.load(open("installation.json"))["project"])')" \
  --env-file compose.env -f compose.yaml exec -T postgres psql -X -U chattermost_app -d chattermost -c \
  "SELECT c->>'id' AS channel_id, c->>'name' AS channel, c->'retentionDays' AS api_limit, c->'agentPolicy'->'retention_days' AS form_limit FROM \"RuntimeState\", jsonb_array_elements(\"value\"->'channels') AS c WHERE \"key\" = 'default' AND (c->'retentionDays' <> 'null'::jsonb OR c->'agentPolicy' ? 'retention_days')"
```

A native installation runs the same `SELECT` with `psql` against its database.
No rows means nothing will be purged. For each listed channel you want to keep in
full, clear the limit while still on the old release:

- `form_limit` set: as a system admin in the web UI, open the channel's Policy
  panel, empty **Retention days** and save. The old release replaces the stored
  policy, so the value is removed.
- `api_limit` set: as a system admin, send
  `PUT /api/v4/channels/CHANNEL_ID/patch` with the body `{"retention_days": null}`.

Run the query again to confirm, then take the backup the upgrade procedure
requires. Limits you keep take effect after the upgrade; each purge is recorded
as a `channel.retention_purged` audit entry with counts. After the upgrade, the
Policy panel shows and edits the enforced limit; leave it empty to keep posts
indefinitely.

### Other changes in 0.8.0

- The channel Policy form now saves **Retention days** on the channel (1 to 36,500 days, or empty to keep everything), and `GET /api/v4/channels/CHANNEL_ID/agent-policy` reports the enforced limit. The import API accepts at most 36,500 days.
- `GET /api/v4/channels/CHANNEL_ID/posts?since=` returns every post created, edited or deleted after the timestamp (newest first, up to 1,000), with deleted posts as redacted tombstones, instead of one page of live posts. Deleting a post also advances its `update_at`, so reconnecting clients drop it.
- Post search returns the newest 100 matches instead of the oldest.
- The agent policy simulator reports the rules ChatterMost enforces (the channel exists and is not archived, the posting account is an active member), with reasons, the members who would see the post, the supervision mode and the channel's retention limit, instead of always answering "allowed". Agent registry permissions, routing, memory flags and allowlists are recorded but not enforced.

## Changes in 0.7.2

Security update for the migrator image. No database migration was added. 0.7.1 is
an additional reviewed upgrade source.

- Force `effect` to 3.22.1 with an npm override, fixing CVE-2026-121707 (regular expression denial of service in `Schema.TemplateLiteral`). `prisma` 6.19.3 pins `effect` 3.21.0 through `@prisma/config`, and no Prisma 6 release raises it. Its only consumer is the Prisma CLI's configuration loader in the migrator image, which runs migrations from files shipped in that image and handles no requests. The application image did not contain the affected package; it is rebuilt as 0.7.2 with unchanged behavior.

## Changes in 0.7.1

Security hardening for installations reachable from the Internet. No database
migration was added. 0.7.0 is an additional reviewed upgrade source.

- Reaction names are validated. A name containing path or query characters could make the native web client send a different `DELETE` request than the one shown when another member clicked the reaction. The client also encodes the name and post ID in that request path.
- Sign-up checks the invite before hashing the password, and sign-up, password change and password reset share the per-address sign-in budget (`RATE_LIMIT_LOGIN_SOURCE_MAX`). Password hashing runs a few at a time with a short queue; beyond that the request gets `429` instead of delaying every other request.
- WebSocket upgrades are budgeted: 120 handshakes per minute per address, `WEBSOCKET_MAX_CONNECTIONS` (2000) open sockets, `WEBSOCKET_MAX_CONNECTIONS_PER_SOURCE` (200) per address, and at most 20 sockets per address (500 overall) that have not signed in. A socket is closed after 200 frames in 10 seconds, or 10 frames before signing in. Addresses come from the same trusted-proxy resolution as HTTP requests, so a proxy in front of the WebSocket path must set `X-Forwarded-For`.
- Every member-writable stored field has a size limit (profile fields, channel name, header and purpose, preferences, post props, notification settings, device ID, search terms), ID lists are capped at 1000 and direct conversations at 8 people. An account stores at most 2000 preferences and uploads at most 60 files a minute. Invite and account roles accept only `system_user` and `system_admin`.
- Editing an approved post is screened like a new post, so an edit cannot introduce held text.
- The Content Security Policy no longer allows inline styles or connections to other hosts, and adds `object-src 'none'`, `base-uri 'none'` and `form-action 'self'`. File links open with `rel="noopener noreferrer"`.
- Native deployment binds the application to `127.0.0.1` (override with `CHAT_SERVER_BIND_HOST`). The nginx template forwards the client address on the WebSocket path, hides its version, and limits one address to 200 concurrent requests. `scripts/backup.sh` redacts credentials inside URLs, and the SSH bootstrap no longer passes a password as a command argument.
- Release and CI workflows pin every third-party action to a commit.

## Changes in 0.7.0

- Add optional loopback-only Hive administrator provisioning on the running TLS server, using a separate purpose secret. Exact identity/native ID binding and permanent receipts make account creation atomic and unchanged retries safe. Existing accounts, messages and sessions are preserved; no Oathweave link is inferred. Authoritative lowercase usernames retain leading underscores and hyphens; receipt reads also bind the currently configured issuer, and forwarding/browser headers cannot confer maintenance authority. No SQL migration is needed. JSON stores flush the staged file and parent directory before acknowledging writes. POST acknowledges only after its audit outbox has been published; GET proves durable account ownership/audit intent without claiming publication; a publication failure keeps the original account and receipt for an exact retry. A persistence error holds subsequent reads/writes and shutdown flushing until retained storage is reviewed, preventing stale state from overwriting an uncertain commit. The reviewed upgrade sources retain every prior path and add 0.6.4.

- The upgrade-lifecycle proof now runs in its own `lifecycle` job per architecture, with a read-only token (`contents: read`) and no registry login. It pulls the candidate images anonymously from the public packages, after checking that each `VERSION-ARCH` tag still resolves to the digest the `native` job pushed. Publishing waits for both lifecycle jobs.
- The lifecycle tests no longer receive a GitHub token. A separate step fetches the release metadata of each declared upgrade source once, with the job's read-only token, and the tests answer the manager's release metadata reads from those files; any other GitHub API read fails the run instead of spending the anonymous budget. The tests also remove GitHub credentials from their environment before starting docker, Compose, the application or the browser. Asset downloads and registry pulls stay anonymous, and the public verification workflow is unchanged.
- The published-version check runs in a read-only `preflight` job instead of the package-writing `native` job, and no workflow keeps its checkout token in the Git configuration.

## Changes in 0.6.4

- Update `@hivemagnus/hive-common` to 0.5.0. Oathweave tokens are verified with the same rules; a token without a `roles` array is now refused before the online session check, so it no longer costs a userinfo request.
- `GET /health/live` and `GET /health/ready` now carry `X-Request-Id`, like every other response.
- The response security headers and the Security Fusion service credential check use the shared helpers; their values and results are unchanged.
- No database migration was added. 0.6.1 is an additional reviewed upgrade source.
- Release lifecycle tests also authenticate the GitHub release metadata reads of the manager commands they start, with the workflow token. The manager code is unchanged; asset downloads and registry pulls remain anonymous, and the public verification workflow still runs the manager without a token.

The `v0.6.2` and `v0.6.3` tags exist but neither version was published: each
release run hit the anonymous GitHub API rate limit during an upgrade-path proof
on the AMD64 runner (the candidate manager's backup step), before any
multi-platform image, bundle or GitHub release was published. ARM64 passed every
declared source for 0.6.2. Their candidate architecture tags are not releases, and
neither version is an installation or upgrade source. Release 0.6.4 contains the
same application changes.

## Changes in 0.6.1

- A WebSocket connection no longer outlives its credential. Each connection is re-checked before every delivery and client action, and is closed on sign-out, session revocation or expiry, account deactivation and bot token rotation. A socket that has not authenticated within 30 seconds is closed.
- Direct and group channels can only be created through the direct message endpoints, and team channels require an existing team, so a conversation cannot be joined in advance.
- Deleting a channel requires a channel manager; direct conversations cannot be deleted.
- Held and deleted posts are hidden on every post, thread, pin, reaction, edit history and file route, and held posts are announced only to their author and system admins.
- Posting or uploading to an archived channel stores nothing.
- Team details and rosters require team membership or a system admin.
- Expired and revoked sessions are dropped when a new session is created.
- No database migration was added. 0.5.2 is an additional reviewed upgrade source.

The `v0.6.0` tag exists but 0.6.0 was never published: its release run hit the
anonymous GitHub API rate limit during an upgrade-path proof on the AMD64 runner,
before any multi-platform image, bundle or GitHub release was published. Its
candidate architecture tags are not a release. It is not an installation or upgrade
source. Release 0.6.1 contains the same application changes.

## Changes in 0.5.2

- Update `@hono/node-server` to 2.1.8 for GHSA-qv5m-9pm6-hqp3 and GHSA-jpvv-r467-5p4w.
- No database migration was added. 0.5.1 is an additional reviewed upgrade source.

## Changes in 0.5.1

- Verify Oathweave tokens with the suite's shared verifier from `@hivemagnus/hive-common`, keeping ChatterMost's existing rules: user tokens only, RS256, exact `chattermost` audience, no clock tolerance, a required `roles` array, an exact `chattermost:session` permission and an online userinfo check on every validation. Refusals remain Mattermost-shaped 401 responses.
- Add `GET /health/live` and `GET /health/ready` in the suite health format. `/api/v4/system/ping` remains the Mattermost-compatible probe used by native clients and the container health check.
- Every response carries a freshly generated `X-Request-Id`. Inbound `x-request-id`, `x-hive-request-id`, `x-correlation-id` and `traceparent` headers are ignored, so callers cannot choose request IDs. The same ID appears in Mattermost error bodies and request error logs.
- No database migration was added. 0.4.5 is an additional reviewed upgrade source.
- Release lifecycle tests authenticate their GitHub release metadata reads with the workflow token, so a release with many declared upgrade sources stays within the GitHub API budget. Asset downloads, registry pulls and the installation manager remain anonymous, and the public verification workflow is unchanged.

The `v0.5.0` tag exists but 0.5.0 was never published: its release run exhausted the
anonymous GitHub API budget during the last upgrade-path proof, before any multi-platform
image, bundle or GitHub release was published. Its candidate architecture tags are not a
release. It is not an installation or upgrade source. Release 0.5.1 contains the same
application changes.

## Changes in 0.4.5

- Build and run CI with pinned Node.js 24.22.3 and require patched Node.js 24/26 versions, including before native deployment migration or activation. Node.js 22 is no longer accepted because this release validates the patched 24/26 runtime lines.
- Upgrade Hono to 4.13.18 for bounded memory when request bodies arrive in tiny chunks (GHSA-39q9-qp46-w8xg). JSON and multipart body limits retain their existing response shapes.

## Changes in 0.4.1

The `v0.4.0` tag exists but 0.4.0 was never published: its release run failed the
fixed HIGH image scan (apt in the base image) before pushing any image or release.
It is not an installation or upgrade source. Release 0.4.1 removes apt and its
library from the runtime and migrator images; nothing installs packages at runtime.

Release 0.4.1 publishes the source changes made since 0.3.3. The API exports
browser-safe administration contracts independently of its server implementation.
Caller-selected bot operation IDs bind credential mutations to an administrator
and exact inputs. Durable, non-secret receipts survive audit
outbox compaction and restoration; duplicate requests refuse a second mutation.
Native clients that omit operation IDs keep their existing protocol. Browser bot
creation uses an explicit create-only precondition, and token rotation remains a
separate confirmed action. Browser conversation schemas and reviewed immutable
snapshots cover the native routes used by shared browser applications. Scoped
identity exchange, volatile sign-in for isolated restore rehearsals, hardened
authentication/channel privacy boundaries and protected Compose secret-file
writes are included. Clients can no longer mark their own posts as webhook
messages. Postgres and Redis image digests are unchanged from 0.3.3, and no
database migration was added. Publication does not alter an installed release.

## Public distribution contract

| Artifact | Meaning |
| --- | --- |
| `ghcr.io/cheftaco/chattermost:0.8.0` | Multi-architecture application image |
| `ghcr.io/cheftaco/chattermost-migrator:0.8.0` | Matching one-off migrator |
| `VERSION-amd64`, `VERSION-arm64` image tags | Native build outputs; may exist before all release checks finish |
| `chattermost-VERSION.tar.gz` | Allowlisted bundle: manager, Compose, manifest, installation README, Apache license and notice |
| `release.json` | Exact app/migrator/infrastructure digests, source revision, schema/lineage, platforms and permitted upgrade sources |
| `SHA256SUMS` | Hashes of the bundle, standalone manager/Compose/manifest, scan reports and lifecycle reports |
| `scan-*.json`, `lifecycle-proof-*.json` | Filtered vulnerability findings and sanitized native lifecycle evidence |

Install a completed [GitHub release](https://github.com/ChefTaco/ChatterMost/releases),
not a candidate architecture tag. The latest lifecycle release is 0.8.0;
0.3.2, 0.3.3, 0.4.1, 0.4.2, 0.4.4, 0.4.5, 0.5.1, 0.5.2, 0.6.1, 0.6.4, 0.7.0, 0.7.1 and 0.7.2 are its tested upgrade sources. The application has one writer
and local WebSocket fanout. Both supported Linux architectures execute on native
CI runners; there is no claim of emulated execution as native proof.

Public GHCR pulls need no login. Package visibility is configured separately from
repository visibility, and newly created packages can default to private. Confirm
both image packages are public and associated with this repository: the release
lifecycle job pulls the candidate images without logging in. Actions uses
`GITHUB_TOKEN` with package-write permission only in the jobs that push images or
publish the release; avoid adding a personal token to installation instructions. See [GitHub's registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

Version tags are guarded against reuse by the workflow; installed images are
pinned by digest. This is distinct from GitHub release immutability. Keep immutable
releases enabled, finish assets before publication, and never edit/recreate an
already published release. Enabling immutability affects future releases, not older
ones retroactively. See [GitHub's immutability documentation](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/establish-provenance-and-integrity/prevent-release-changes).

## Prepare a new version and its upgrade paths

1. Review code, migrations, dependency/license changes and the complete reachable
   history of every ref to publish. Stage explicit files, review author metadata,
   and run all [contribution gates](../CONTRIBUTING.md). Do not include private
   history, environments, SSH pins, runtime data, screenshots, backups or receipts.
2. Update the root version in `package.json`, the corresponding root entries in
   `package-lock.json`, and `distribution/release-policy.json` together. Do not
   globally replace matching dependency versions in the lockfile. Update the
   installation examples, supported-path matrix and bundled README for the
   intended release, then confirm their published links after publication.
3. List only reviewed and actually tested source releases in `upgrade_from`.
   A future release intended for existing 0.3.2 installations must explicitly
   permit 0.3.2. Preserve migration SQL already applied in released installations;
   add new expansion-only migrations and review generation/compatibility ranges.
   Do not broaden compatibility or allowlists to bypass a failing check.
4. Validate the candidate policy with `python3 tests/container/lifecycle.py VERSION --plan`.
   The runner exercises **each** `upgrade_from` entry, in separate disposable stacks.
   Releases after 0.3.2 must include published 0.3.2; the pre-build policy check
   refuses a future release that omits it. Public 0.3.2 verification retains its
   historical 0.2.3 source from the verified archive. Verify
   fresh install, restart/data/token/file persistence, backups/restoration,
   compatible rollback, migration/health failures, incompatible rollback refusal,
   browser login and actual WebSocket event delivery on both architectures.
   Source backups use the new manager's CLI; posts and attachments written after
   upgrading must survive compatible rollback and target-backup restoration too.
5. Inspect infrastructure digests as well as application changes. The current
   manager refuses Postgres/Redis digest changes during an application upgrade;
   do not advertise such a release as an ordinary supported app upgrade without
   a separate reviewed maintenance path. Postgres major upgrades are explicit.
6. Check `.dockerignore`, explicit Dockerfile inputs, native Prisma generation,
   non-root UID/volume ownership, graceful shutdown, notices and image metadata.
   `python3 tests/container/context.py` exports the actual Docker context to check
   the allowlist. Build the `runtime` and `migrator` targets separately.
7. Commit/push the reviewed source and create a **new**, unused stable version tag
   `v0.MINOR.PATCH` on that exact commit. The tag triggers
   [container-release](../.github/workflows/release.yml). Do not retag 0.3.2 to
   publish documentation fixes or retry already-pushed candidate image tags.

## What automation proves

The release workflow first runs the reusable repository CI gates, then a read-only
preflight job validates the upgrade policy and refuses an already published version
before anything is built or pushed. Native AMD64 and ARM64 jobs build/load
and exercise the app/migrator, scan fixable HIGH/CRITICAL
findings, then push native images with SBOM and maximum provenance. For lifecycle
releases, separate native lifecycle jobs with a read-only token and no registry login
test every declared published source against the pushed candidate digests,
including a native browser. Their tests get no token: the release metadata of each
declared source is fetched once in an earlier step and served to the manager from
files. Only after both native and both lifecycle jobs pass does the publishing
job create the combined versioned image indexes, package the explicit bundle,
bind public files with checksums, attest the archive/checksum manifest, and publish
the GitHub release. Earlier failed jobs may leave architecture-specific candidate
images; select a new version rather than overwriting them.

Image SPDX SBOM and SLSA provenance are OCI attestations attached to the registry
images. Archive/checksum publisher attestations are GitHub artifact attestations;
these are separate surfaces. The workflow explicitly sets `sbom: true` and
`provenance: mode=max` on pushes; local loaded test images do not carry those
attestations. Build arguments appear in maximum provenance, so they must never
contain secrets. See [Docker's attestation documentation](https://docs.docker.com/build/ci/github-actions/attestations/).

Scan JSON is filtered to fixed HIGH/CRITICAL findings by this workflow. A passing
scan is not a claim of zero total vulnerabilities, nor a promise that an old
immutable image stays current as advisory databases change. Dependency CI also
runs `npm audit --audit-level=moderate`. Remediation needs a new version and the
same validation path, preserving published digests.

## Verify after publication

A successful push is not installation proof. Dispatch the public verification
workflow for the exact completed release:

```bash
gh workflow run verify-public-release.yml --ref main -f version=0.8.0
```

Substitute the newly published version. Check both native fresh-install jobs,
every source/platform lifecycle job and the final aggregate. Each lifecycle job
uses the published manager anonymously for one declared source, keeping repeated
release-metadata requests within GitHub's anonymous API budget. No local application
build or registry credentials are used. The aggregate requires both native
architectures, every declared source, browser and recovery proof, and the exact
published archive/image digests. Missing, failed, skipped or mismatched coverage
prevents a success report. Review logs and all uploaded reports for privacy before sharing.
The workflow is manually dispatched, not automatically started by publication.

Review the public manifest/digests and per-architecture SBOM/provenance, verify
all downloaded checksums, and verify the archive and checksum publisher identities:

```bash
gh attestation verify chattermost-0.8.0.tar.gz --repo ChefTaco/ChatterMost --signer-workflow ChefTaco/ChatterMost/.github/workflows/release.yml
gh attestation verify SHA256SUMS --repo ChefTaco/ChatterMost --signer-workflow ChefTaco/ChatterMost/.github/workflows/release.yml
```

The [GitHub CLI reference](https://cli.github.com/manual/gh_attestation_verify)
describes the identity checks. These commands verify the GitHub artifact
attestations; they do not assert that the Docker build attestations have a separate
GitHub/cosign image signature. Report candidate-digest testing separately from
final anonymous public-archive testing and native execution separately from
emulation. Retain operator verification receipts privately.

## 0.4.4

The 0.4.3 publication stopped before any image or bundle was published: the build-context privacy test needed the new probe helper in its explicit allowlist. The check now runs in ordinary CI as well as native release jobs. The failed tag is not an installation or upgrade source.

Fix container HTTPS and WebSocket readiness checks for verified IP product endpoints on Node 26. IP identities are checked against the certificate IP SAN without sending an invalid TLS SNI value. DNS endpoints, trusted CA validation and certificate mismatch refusal remain enforced. The release also tests upgrades from 0.4.2 alongside the existing supported baselines.

## 0.4.2

The application and migration images use a pinned, patched Node 26 runtime with maintained system libraries. Reviewed upgrade paths cover 0.3.2, 0.3.3 and 0.4.1, preserving credentials, messages and attachments.
