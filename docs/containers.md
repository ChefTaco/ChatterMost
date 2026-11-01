# Container installation

ChatterMost is a Mattermost-compatible application licensed under Apache-2.0.
The container distribution supports Linux AMD64 and ARM64, Docker Engine, Docker
Compose v2.24+ (or v5), and Python 3.11+. No source checkout or local build is needed.
Use one application instance: the store has a single writer and WebSocket delivery
is process-local. Redis is optional and provides distributed abuse counters only.

## Install a release

Download `chattermost-VERSION.tar.gz` and `SHA256SUMS` from the same explicit
[GitHub release](https://github.com/ChefTaco/ChatterMost/releases). Check the archive
using `sha256sum --ignore-missing -c SHA256SUMS` before extraction. GitHub release
assets carry build provenance attestations; `gh attestation verify ARCHIVE --repo
ChefTaco/ChatterMost` verifies the publisher when the GitHub CLI is available.
Never install from a mutable `latest` image tag. `release.json` records the exact
application, migrator, database and Redis image digests.

```bash
tar xzf chattermost-0.2.0.tar.gz
cd chattermost-0.2.0
./chattermost --directory /srv/chattermost setup --server-url https://chat.example.test
/srv/chattermost/chattermost --directory /srv/chattermost start
/srv/chattermost/chattermost --directory /srv/chattermost status
```

Setup refuses an existing directory and creates independent random database,
cookie, token-hash, administrator and Hermes bot credentials exactly once. Read the
initial administrator credentials from `secrets/runtime.env` privately. Preserve
this file and the database password for the lifetime of the installation. Setup
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

## Existing HTTPS reverse proxy

Terminate TLS in your existing proxy and forward HTTP to the loopback listener.
Set the external HTTPS origin exactly with `--server-url`; preserve the public
Host, forward `X-Forwarded-Proto: https`, and configure `--trusted-proxies` with
only the actual proxy source CIDRs. Forward `/api/v4/websocket` with HTTP/1.1,
`Upgrade: websocket` and `Connection: upgrade`, and suitable idle timeouts. Browser
writes and cookie-authenticated WebSocket connections must carry the same public
Origin as `SERVER_URL`. Bearer-token clients retain their compatibility behavior.
A proxy in another container needs an explicitly reachable app listener/network;
this distribution does not reconfigure an existing proxy or install certificates.

## Migration safety

Start runs the explicit one-off migration service before activating the app.
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
Release images include OCI version/revision/license labels, dependency notices,
SBOM and provenance attestations. Vulnerability scanning gates fixed high/critical
findings; scan output is published separately. No operator configuration, runtime
state, private history, logs or screenshots enter release bundles or build inputs.
