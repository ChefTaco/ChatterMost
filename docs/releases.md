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

## Changes in 0.6.0

- A WebSocket connection no longer outlives its credential. Each connection is re-checked before every delivery and client action, and is closed on sign-out, session revocation or expiry, account deactivation and bot token rotation. A socket that has not authenticated within 30 seconds is closed.
- Direct and group channels can only be created through the direct message endpoints, and team channels require an existing team, so a conversation cannot be joined in advance.
- Deleting a channel requires a channel manager; direct conversations cannot be deleted.
- Held and deleted posts are hidden on every post, thread, pin, reaction, edit history and file route, and held posts are announced only to their author and system admins.
- Posting or uploading to an archived channel stores nothing.
- Team details and rosters require team membership or a system admin.
- Expired and revoked sessions are dropped when a new session is created.
- No database migration was added. 0.5.2 is an additional reviewed upgrade source.

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
| `ghcr.io/cheftaco/chattermost:0.6.0` | Multi-architecture application image |
| `ghcr.io/cheftaco/chattermost-migrator:0.6.0` | Matching one-off migrator |
| `VERSION-amd64`, `VERSION-arm64` image tags | Native build outputs; may exist before all release checks finish |
| `chattermost-VERSION.tar.gz` | Allowlisted bundle: manager, Compose, manifest, installation README, Apache license and notice |
| `release.json` | Exact app/migrator/infrastructure digests, source revision, schema/lineage, platforms and permitted upgrade sources |
| `SHA256SUMS` | Hashes of the bundle, standalone manager/Compose/manifest, scan reports and lifecycle reports |
| `scan-*.json`, `lifecycle-proof-*.json` | Filtered vulnerability findings and sanitized native lifecycle evidence |

Install a completed [GitHub release](https://github.com/ChefTaco/ChatterMost/releases),
not a candidate architecture tag. The latest lifecycle release is 0.6.0;
0.3.2, 0.3.3, 0.4.1, 0.4.2, 0.4.4, 0.4.5, 0.5.1 and 0.5.2 are its tested upgrade sources. The application has one writer
and local WebSocket fanout. Both supported Linux architectures execute on native
CI runners; there is no claim of emulated execution as native proof.

Public GHCR pulls need no login. Package visibility is configured separately from
repository visibility, and newly created packages can default to private. Confirm
both image packages are public and associated with this repository. Actions uses
`GITHUB_TOKEN` with package-write permission; avoid adding a personal token to
installation instructions. See [GitHub's registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

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

The release workflow first runs the reusable repository CI gates. Native AMD64
and ARM64 jobs validate the upgrade policy before building or pushing, build/load
and exercise the app/migrator, scan fixable HIGH/CRITICAL
findings, then push native images with SBOM and maximum provenance. For lifecycle
releases it tests every declared published source against the pushed candidate digests,
including a native browser. Only after both native jobs pass does the publishing
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
gh workflow run verify-public-release.yml --ref main -f version=0.6.0
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
gh attestation verify chattermost-0.6.0.tar.gz --repo ChefTaco/ChatterMost --signer-workflow ChefTaco/ChatterMost/.github/workflows/release.yml
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
