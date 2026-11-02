# Container installation

ChatterMost is a Mattermost-compatible application licensed under Apache-2.0.
The container distribution supports Linux AMD64 and ARM64, Docker Engine, Docker
Compose v2.24+ (or v5), and a patched Python 3.11.4+ (native CI uses Python 3.12).
The manager needs Python's [tar extraction filters](https://docs.python.org/3.11/library/tarfile.html#extraction-filters).
No source checkout, host Node runtime or local application build is needed.
Use one application instance: the store has a single writer and WebSocket delivery
is process-local. Redis is optional and provides distributed abuse counters only.

## Install a release

The current published lifecycle release is
[0.3.2](https://github.com/ChefTaco/ChatterMost/releases/tag/v0.3.2). Choose the exact
version you intend to install. In a fresh directory **outside a Git worktree**,
download the bundle and checksum manifest from the same release:

```bash
set -eu
VERSION=0.3.2
mkdir "chattermost-download-$VERSION"
cd "chattermost-download-$VERSION"
curl --fail --location --remote-name "https://github.com/ChefTaco/ChatterMost/releases/download/v$VERSION/chattermost-$VERSION.tar.gz"
curl --fail --location --remote-name "https://github.com/ChefTaco/ChatterMost/releases/download/v$VERSION/SHA256SUMS"
awk -v archive="chattermost-$VERSION.tar.gz" '$2 == archive { print; found=1 } END { if (!found) exit 1 }' SHA256SUMS > archive.sha256
sha256sum --check archive.sha256
```

Verify the checksum's `OK` result before extraction. When GitHub CLI attestation
verification is available, additionally verify the publisher and release workflow:

```bash
gh attestation verify "chattermost-$VERSION.tar.gz" --repo ChefTaco/ChatterMost --signer-workflow ChefTaco/ChatterMost/.github/workflows/release.yml
gh attestation verify SHA256SUMS --repo ChefTaco/ChatterMost --signer-workflow ChefTaco/ChatterMost/.github/workflows/release.yml
```

These optional publisher checks use GitHub's API; they are separate from anonymous
GHCR image pulls. See the [GitHub CLI reference](https://cli.github.com/manual/gh_attestation_verify).
The manager checks GitHub's archive asset digest again when downloading releases.
Never install from a mutable `latest` image tag. `release.json` records exact
application, migrator, database and Redis image digests.

Use a new installation directory owned by the account managing the stack; the
following example uses that account's home directory rather than requiring `/srv`
permissions. Replace the HTTPS origin with the one your reverse proxy will serve:

```bash
tar xzf "chattermost-$VERSION.tar.gz"
INSTALL_DIR="$HOME/chattermost-installation"
./chattermost-"$VERSION"/chattermost --directory "$INSTALL_DIR" setup --server-url https://chat.example.test
"$INSTALL_DIR/chattermost" --directory "$INSTALL_DIR" start
"$INSTALL_DIR/chattermost" --directory "$INSTALL_DIR" status
```

Do not reuse an existing directory or source-checkout `.env`. For subsequent
examples `/srv/chattermost` denotes your chosen installation directory. All commands
must run as the same managing account (or consistently through its authorized sudo
workflow), with access to Docker. `--directory` precedes the subcommand.

Setup refuses an existing directory and creates independent random database,
cookie, token-hash, administrator and Hermes bot credentials exactly once. Read the
initial administrator credentials from `$INSTALL_DIR/secrets/runtime.env` privately.
Preserve this file and the database password for the lifetime of the installation. Setup
never reads the source checkout's `.env`. All installation state and recovery
receipts are private; do not commit or upload the installation directory.

Run setup as the account that will manage the installation. Docker Compose file
secrets retain host ownership; setup selects that account's numeric UID/GID for
the application and migrator. Root setup uses UID/GID 1000 and adjusts secret
ownership. Secret files must remain mode 600 (400 is also accepted). A one-off,
network-isolated initializer prepares the file volume; application and migration
containers run without root or Linux capabilities and with a read-only rootfs.
The application image excludes Prisma CLI, TypeScript, test runners and other
build tools. The separate migration image includes Prisma CLI. Each architecture
generates its own Prisma client and engine during its native build.

The default listener binds to `127.0.0.1:8065`. Set `--port` for another host port;
`--bind` is an explicit operator choice. For local synthetic testing only, a
`http://127.0.0.1:PORT` server URL is supported. Use `--redis` at setup to start the
optional private Redis service. Database and Redis ports are never published.
The database and files are separate stable named volumes under a unique Compose
project. Do not change the project name, scale app, or run another writer against
the same database. Do not use `docker compose down --volumes` on an installation.

## GHCR images and release layout

Both public packages support `linux/amd64` and `linux/arm64`:

| Package | Role |
| --- | --- |
| [`ghcr.io/cheftaco/chattermost`](https://github.com/users/ChefTaco/packages/container/package/chattermost) | Application, wrapper entrypoint and health/readiness probes |
| [`ghcr.io/cheftaco/chattermost-migrator`](https://github.com/users/ChefTaco/packages/container/package/chattermost-migrator) | Explicit schema validation and migrations; never the serving image |

Public pulls need no registry login. The version tags have no leading `v`:

```bash
docker pull ghcr.io/cheftaco/chattermost:0.3.2
docker pull ghcr.io/cheftaco/chattermost-migrator:0.3.2
```

Pulling these tags alone is not an installation. The bundle pins their immutable
multi-architecture digests, supplies protected setup and coordinates migration and
activation. Do not substitute architecture candidate tags or a hand-built image
for the release manifest. Native image variants carry SBOM/provenance attestations;
filtered vulnerability and lifecycle reports are separate release assets. See
[maintainer release details](https://github.com/ChefTaco/ChatterMost/blob/main/docs/releases.md).

The extracted bundle contains exactly `chattermost`, `compose.yaml`, `release.json`,
`README.md`, `LICENSE` and `NOTICE`. The installed root additionally holds protected
`installation.json`, `compose.env`, `state.json`, `secrets/`, verified `releases/`,
`backups/` and transaction/recovery evidence. `compose.env` selects public image
references and the installation's project/UID/port; it is not the runtime secret file.
Keep the whole installed root mode 700 and protected files mode 600. Never change
the project name or delete/recreate volumes to perform an upgrade.

## Existing HTTPS reverse proxy

Terminate TLS in your existing proxy and forward HTTP to the loopback listener.
Set the external HTTPS origin exactly with `--server-url`; preserve the public
Host, forward `X-Forwarded-Proto: https`, and configure `--trusted-proxies` with
only the actual proxy source CIDRs. Forward `/api/v4/websocket` with HTTP/1.1,
`Upgrade: websocket` and `Connection: upgrade`, and suitable idle timeouts. Browser
writes and cookie-authenticated WebSocket connections must carry the same public
Origin as `SERVER_URL`. Bearer-token clients retain their compatibility behavior.
For a host proxy connecting through a Docker bridge, its socket peer may be a
bridge gateway rather than loopback. Inspect the installation's actual network
gateway addresses and trust only the required addresses; do not trust an entire
private address range by convenience. Set `--trusted-proxies` at setup where known,
or arrange a protected configuration update and app recreation after inspection.
Changing a mounted runtime secret does not make the already-running app reload it.

A proxy in another container needs an explicitly reachable app listener/network;
this distribution does not reconfigure an existing proxy or install certificates.

## Migration safety

Starting a stopped stack runs the explicit one-off migration service before
activating the app; `start` on an already-running app verifies readiness.
Postgres must be healthy. A database advisory lock covers checksum, lineage,
schema validation and migration; Prisma's own migration lock remains enabled.
The existing expansion-only SQL policy is reused. Applied migrations must be an
exact checksum-matched prefix of the release. A disposable database reconstructs
that prefix and detects schema drift before any target migration. Final schema
comparison must also pass. Failed or untracked nonempty databases stop; the
container path never performs automatic legacy baselining or schema repair.
Insufficient permissions to create the validation database fail closed. The
bundled Postgres account can create it; external database support is not included.

Readiness checks HTTP, authenticated login and a real authenticated WebSocket.
Container SIGTERM uses the existing graceful server shutdown; Compose grants a
45-second drain period. Existing SSH/systemd deployment and rollback scripts are
independent and keep their prior contracts. Migration of an existing installation
is a separate operation and is not performed by this tooling.

## Release verification

Release automation builds and executes AMD64 and ARM64 on native GitHub runners.
It tests fresh install, synthetic accounts, bot authentication, retained messages,
attachments, profile images, restart persistence and WebSocket event delivery.
Lifecycle tests cover every declared upgrade source; later releases must include
published 0.3.2. They verify source/target backups, restoration and compatible
rollback, including messages and attachments written after upgrading.
Release images include OCI version/revision/license labels, dependency notices,
SBOM and provenance attestations. Vulnerability scanning gates fixed high/critical
findings; scan output is published separately. No operator configuration, runtime
state, private history, logs or screenshots enter release bundles or build inputs.

## Lifecycle commands (0.3.2 and later)

Follow the complete
[upgrade and recovery procedure](https://github.com/ChefTaco/ChatterMost/blob/main/docs/upgrading.md)
for supported source versions, prechecks, failure decisions and point-in-time
restoration semantics. The only reviewed upgrade into 0.3.2 is from 0.2.3. Native
imports follow a separate
[migration procedure](https://github.com/ChefTaco/ChatterMost/blob/main/docs/container-migration.md).

Use `/srv/chattermost/chattermost --directory /srv/chattermost COMMAND`. The
interface provides `start`, `status`, `upgrade VERSION`, `backup`,
`restore BACKUP_DIRECTORY --confirm-database-replacement`, `rollback`, and
`recover`. Setup remains a one-time operation; it refuses existing directories.

For the initial upgrade from the published 0.2.3 baseline, download and verify the
0.3.2 bundle as above, then run its new manager against the existing installation:

```bash
./chattermost-0.3.2/chattermost --directory /srv/chattermost upgrade 0.3.2
```

After successful activation the new manager is installed in the installation
root. Run `upgrade` from the directory containing the extracted bundle in that
example. It stays available when rolling the application back to 0.2.3. Release
policy explicitly permits 0.2.3 → 0.3.2. Unsupported paths, mutable version names,
changed published versions, unexpected archive members, altered cached files,
image/manifest schema mismatches and infrastructure image changes fail closed.
Downloads verify GitHub's SHA-256 asset digest over HTTPS and retain the digest
and per-file hashes privately. Archive publisher attestations can additionally
be verified with `gh attestation verify`. No unattended updater or `latest` tag is
used. Postgres major upgrades and infrastructure image changes are separate
maintenance operations.

An upgrade pulls the selected images before downtime, stops and drains the only
writer, validates the actual schema, and takes a database/file backup while a
connection-held database lock prevents concurrent migration/recovery. It then
checks the migration image's declared policy, runs migrations under their own
lock, activates the selected application, and checks HTTP, release/revision
identity, authenticated login and WebSocket connectivity. Accounts, bot tokens,
messages, file volumes and protected secrets are preserved. The protected runtime
file must contain the current administrator login credentials for readiness;
update that private configuration if the administrator changed their password.

`backup` stops application writes while capturing `pg_dump` and the complete file
volume, including profile images, then resumes a previously running application.
A forced or otherwise unclean application shutdown is refused as a bootable
recovery point. The private backup directory includes the matching secrets, installation state,
verified release cache, database migration history and integrity manifest. Keep the whole directory
in protected storage; it contains private data and credentials. Backups are not
encrypted by this tool. Provision encryption and off-host storage according to
your requirements. Backups are retained until the operator deliberately removes
them; allow enough disk for the dump, attachments and pre-restoration safety copy.

`rollback` selects the recorded previous application image without restoring the
database. Its supported schema generation and lineage must include the current
database. Upgrades automatically return to the prior image after a failure only
when migration history and an actual schema comparison prove compatibility. An
unknown, failed, drifted or incompatible schema leaves the application stopped
with private evidence and recovery instructions. No database is automatically
restored. The manager's transaction record blocks start or another upgrade after
an interruption; `recover` repeats those checks before reactivating a prior image.

`restore` is a separate, explicit destructive operation. It verifies all backup
hashes and archive paths, requires the same installation identity, database
credentials, origin and Postgres major, captures a safety copy, replaces the
public database schema and file volume together while writes are stopped,
restores matching secrets, and validates the selected release before resuming.
Restoration replaces the selected point in time; writes made after that backup
are discarded. Restoration failure leaves the application stopped. A pre-restoration snapshot
with an unknown/incompatible schema is forensic recovery material and requires
DBA assistance, rather than being silently treated as a bootable backup.
Cross-installation migration, changing the public origin, credential rotation,
and Postgres major upgrades require separate operator procedures. These commands
never discover or alter another installation.

Typical explicit operations after installation:

```bash
/srv/chattermost/chattermost --directory /srv/chattermost backup
/srv/chattermost/chattermost --directory /srv/chattermost status
/srv/chattermost/chattermost --directory /srv/chattermost rollback
/srv/chattermost/chattermost --directory /srv/chattermost restore /srv/chattermost/backups/SELECTED_BACKUP --confirm-database-replacement
```

Select a real backup path printed by `backup`; the placeholder above is not an
automatic backup selection policy. Release checksums cover the bundle, standalone
tooling, Compose file, manifest, scan reports and native lifecycle reports. The
checksum manifest and installation archive both carry publisher attestations.

## Boot ownership and protected configuration

Setup/start do not install a systemd unit, reverse proxy, TLS certificates, backup
schedule or automatic updater. Containers have restart policies; operators must
arrange any host boot/shutdown integration and monitoring. A host wrapper should
use the installed manager for startup/readiness and drain the app before stopping
Postgres. A deliberately stopped app needs an explicit `start` to resume.

There is no `stop`, `restart`, `configure` or secret-rotation manager subcommand in
0.3.2. `start` on an already-running container verifies it; it does not force an app
recreation. Apply protected configuration changes through a planned operator
restart/recreation, retaining project identity and the pinned images. Database
password, signing-key and token-key rotation require coordinated procedures;
editing a secret file alone is not a supported rotation. Native rotation scripts
operate the old systemd/database layout and must not be used on this distribution.
