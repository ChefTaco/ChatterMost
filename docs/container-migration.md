# Migrating a native installation to Compose

ChatterMost is Mattermost-compatible and Apache-2.0 licensed. Moving an existing
SSH/systemd installation into the container distribution requires an explicitly
authorized maintenance operation. The 0.3.2 manager does not perform native
imports: `setup` generates new credentials and `restore` accepts only backups
belonging to the same installation. Neither command is a native importer.

Keep the procedure, configuration, database exports, checksums, screenshots,
rollback commands and receipts in protected operator storage outside Git.

## Backup and rehearsal

Inspect the configured target through its verified SSH host pin. Record the active
release, service identity, public origin, proxy/certificates, storage, database
version/volume and Redis namespace. Validate existing administrator and bot
credentials. Verify the explicit public release archive, publisher attestation and
image digests before downtime.

Compare actual migration names/checksums, generation and lineage with the target.
Native manifests use `generation` and `lineage_digest`; distribution manifests use
`schema_generation` and `schema_lineage_digest`. Reject unfinished migrations,
unknown lineage and schema drift. Postgres major changes need separate maintenance.

Hold the native deployment lock, stop/drain the sole writer, and hold the database
migration/recovery advisory lock. Capture a custom Postgres dump, role recovery
information, complete attachment/profile trees, protected environment, prior
application release and matching infrastructure. Preserve only ChatterMost's Redis
namespace with expiry times, leaving other applications alone. Hash every backup
file, verify archives, and verify a protected off-host copy.

Resume the native service while rehearsing with a separate Compose project,
separate volumes and a loopback staging port. Import the established credentials
directly into protected files; do not generate substitutes or weaken permissions.
Retain application settings except explicit container addressing/storage and build
identity. Remove native `DATABASE_URL` and build metadata so the wrapper/image
supply them; runtime file values override process environment values. Set the
container listener and file paths to the distribution's values.

Restore under a lock into the new database and initialized non-root file volume.
Compare all table contents and every attachment/profile file hash with the source
snapshot before starting the app. Run the published schema validator and migration
service. Preserve `SERVER_URL`, cookie settings and origin enforcement. For a host
proxy reaching Docker, add only the actual bridge gateway addresses required for
that proxy to trusted proxies. Keep the app on loopback and database/Redis ports
unpublished. Verify readiness on the restored copy.

## Cutover and verification

Stop the rehearsal writer. Take a fresh, consistent native recovery point at final
cutover; rehearsal data may be stale. Import and verify it before starting Compose
on the existing internal listener. Preserve the HTTPS/WebSocket proxy and
certificates where its routing contract allows.

Enable boot management for Compose and disable the native writer. Retain a systemd
condition or equivalent guard against accidental native startup. Shutdown must
drain the app before stopping Postgres. Retain the original native release,
configuration, files, database container and volume; keep that database stopped
after cutover. Never serve from both application writers concurrently.

Check the public release/revision, existing cookie/bearer sessions, fresh browser
login, existing bot token and authenticated WebSocket `posted` delivery. Use
private verification conversations. Verify retained account/token hashes,
messages, attachment/profile records and file bytes, plus non-root execution,
private database networking, TLS/proxy preservation and boot ownership. Create and
verify a normal Compose backup after migration.

## Native rollback boundary

The container manager's `rollback` command covers previous container releases.
Returning to a separate native database requires an installation-specific
procedure. Verify the original release's schema generation, migration checksums
and lineage against the current database. Stop/drain the container writer and
capture a verified current database/files checkpoint. Restore that forward state
and current Redis counters into the native store, verify it, and only then restart
the native writer. Starting the original stale database would discard writes
accepted after cutover. Retain both original and forward recovery points.

Unknown/failed schemas, unclean checkpoints and integrity failures leave writers
stopped for explicit recovery. Never silently restore an older database.

After migration, set private operator routing metadata:

```dotenv
CHAT_SERVER_DEPLOY_MODE="compose"
CHAT_SERVER_COMPOSE_PATH="/srv/chattermost-compose"
```

Use the published manager at that path for subsequent operations. These fields
guide operators and agents; preserved native scripts do not interpret them.
Do not run the native deployer against a migrated installation. See
[container lifecycle commands](containers.md#lifecycle-commands-032-and-later).
