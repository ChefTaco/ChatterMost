# Upgrades and recovery

Choose the installed deployment type before running commands. Private
`CHAT_SERVER_DEPLOY_MODE=compose` selects the installed container manager at
`CHAT_SERVER_COMPOSE_PATH`. The native scripts do not interpret that metadata.
Keep credentials, backup paths, diagnostics and recovery evidence private.

## Supported paths

| Installed state | Target | Supported operation |
| --- | --- | --- |
| Published Compose 0.2.3 | Published Compose 0.3.2 | Run the verified **0.3.2 manager** against the existing directory with `upgrade 0.3.2` |
| Published Compose 0.3.2 | Published Compose 0.3.3 | Run the verified **0.3.3 manager** with `upgrade 0.3.3` |
| Published Compose 0.3.2, 0.3.3, 0.4.1 or 0.4.2 | Published Compose 0.4.3 | Run the verified **0.4.3 manager** with `upgrade 0.4.3` |
| Compose 0.4.3 | Same version | No upgrade required; `start` checks/starts the selected release |
| Compose 0.4.3 | A future release | Only when that published target explicitly lists `0.4.3` in `release.json` → `upgrade_from` and the path has release-test coverage |
| Compose with a recorded previous release | That previous release | `rollback`, only when generation, lineage and actual schema checks permit it |
| Native SSH/systemd | Compatible newer native release | Verified backup, then the native staged migration/preflight/activation transaction |
| Native SSH/systemd or JSON store | Compose | Separate authorized migration; not an ordinary version upgrade or a cross-installation `restore` |

The current published release is **0.4.3**. Its reviewed `upgrade_from` list contains
**0.3.2, 0.3.3, 0.4.1 and 0.4.2**. An older 0.2.3 installation must first upgrade to the historical
0.3.2 release using its verified manager; a direct 0.2.3 → 0.4.3 path is unsupported.
The `v0.4.0` tag was never published as a release and is not an upgrade target.
Do not infer a path from version ordering, source tags or the presence
of an architecture-specific image. Failed candidate versions are not installations.
Future releases must add and test their paths before publication; see
[maintainer releases](releases.md). There is no mutable `latest` update channel.
The release test runner requires 0.3.2 as a source for later releases and exercises
every declared source on each native architecture. This coverage requirement does
not publish a future version or change the immutable 0.3.2 manifest.

## Container upgrade procedure

Use the existing installation directory, account and Compose project. The paths
below are examples; substitute your protected installation location. Confirm free
disk for the database dump, complete file tree and any restoration safety copy.
Keep the readiness administrator password current in `secrets/runtime.env` and
retain all other credentials. Coordinate a seeded bot's runtime token as described
in [Hermes configuration](hermes-compatibility.md#chattermost-bot-setup).
If protected runtime configuration needs changing, coordinate the app recreation
first and confirm current readiness before starting the upgrade procedure;
editing the mounted file alone does not reload the running process.

1. Download and verify the target bundle using [container installation](containers.md#install-a-release).
   Use a fresh download directory. Preserve the release's `release.json`, checksums
   and verification result privately. The bundle supplies the new manager for an
   installation whose older manager does not yet implement lifecycle commands.
2. Review the target's `upgrade_from`, infrastructure image digests and schema
   contract. Verify the current `status`, and take a backup with the new manager.
   Plan a brief interruption: backup drains the app and resumes it afterward if
   it was running. In this example, both commands use the downloaded 0.4.3 tool:

   ```bash
   ./chattermost-0.4.3/chattermost --directory /srv/chattermost status
   ./chattermost-0.4.3/chattermost --directory /srv/chattermost backup
   ```

   Save the printed backup path privately, copy the complete backup off-host and
   check its integrity manifest. A restore rehearsal belongs in a separate,
   deliberately provisioned recovery environment; the normal `restore` command
   refuses a different installation identity. Do not improvise a second writer
   or run `setup` over the existing directory.
3. Request the exact version:

   ```bash
   ./chattermost-0.4.3/chattermost --directory /srv/chattermost upgrade 0.4.3
   /srv/chattermost/chattermost --directory /srv/chattermost status
   ```

   The example assumes the download directory contains `chattermost-0.4.3/`;
   do not run it from inside that extracted directory with the same relative path.
   After a successful upgrade, the manager is installed at the installation root.
4. Check public HTTPS ping/client configuration against the selected manifest's
   version and full revision, then verify browser login, existing bot-token
   authentication, retained messages/files and authenticated WebSocket delivery.
   A container health check or unauthenticated WSS connection alone is insufficient.
   Keep any screenshots or message identifiers in private evidence.

The manager verifies release asset SHA-256 digests and cached file integrity,
checks the explicit source-version policy, and pulls the target application and
migration images before stopping the writer. It then drains the single app,
checks actual schema/history, creates a consistent database/files backup, validates
the migration image's declared schema, runs migrations under a database lock,
activates the selected image and tests authenticated HTTP/WebSocket readiness.
It records the previous application version and recovery state privately. Secrets
and persistent volumes retain their installation identity.

Use the manager for this sequence. Editing image variables, pulling images and
running `docker compose up -d` alone bypasses release/path/recovery checks. An
upgrade refuses changed Postgres/Redis image digests or a Postgres major change;
those require separate reviewed infrastructure maintenance. Changing the origin,
rotating credentials and moving installations are separate operations too.

## Failure recovery and rollback

If activation fails, automatic recovery can restart the previous image only when
known migration history, schema generation/ancestry and an actual schema comparison
prove it compatible. It never restores an older database automatically. A failed,
unknown or incompatible schema leaves the app stopped with protected evidence.

Inspect `status`, `diagnostics.log`, `pending.json`, `migration-evidence.json`,
`transactions.jsonl` and `evidence/` privately. Do not delete a pending record to
unblock `start`. For an interrupted image transition:

```bash
/srv/chattermost/chattermost --directory /srv/chattermost recover
```

`recover` repeats compatibility/readiness checks; it cannot complete an interrupted
database restoration or repair an unknown schema. For an intentional application
rollback to the recorded previous version:

```bash
/srv/chattermost/chattermost --directory /srv/chattermost rollback
```

This retains the forward database; it may be refused even when the older image is
available. After a fresh installation or native migration, no previous container
release may be recorded. Keep the newer manager when the app rolls back to the
recorded previous release.

Database/files restoration is an explicit point-in-time recovery operation:

```bash
/srv/chattermost/chattermost --directory /srv/chattermost restore /srv/chattermost/backups/SELECTED_BACKUP --confirm-database-replacement
```

Use a real verified backup path. Restoration checks hashes, archive paths, project
identity, database credentials, public origin and Postgres major, then takes a
safety copy and replaces database/files together while writes are stopped. It
restores the matching secret files and selected release. Writes after the selected
backup are discarded; preserve newer evidence and choose the recovery point
explicitly. Failure leaves the app stopped. Backups are unencrypted and include
credentials; supply protected off-host retention/encryption separately.

## Native upgrades and migration rollback

For an installation still in native mode, use the [native deployment transaction](deployment.md#commands)
after a consistent, verified recovery checkpoint. Expansion-only migration policy,
manifest/digest verification, the deployment lock, isolated read-only preflight,
activation and health checks remain required. The native `backup.sh` helper alone
does not coordinate writer/file consistency or supply a complete verified recovery
package. Follow the [backup boundary](deployment.md#backups-and-rollback).

Use [native code rollback](../deploy/ROLLBACK.md) only for a verified recorded
predecessor with the required schema/configuration contract. Do not switch symlinks
manually. A native-to-Compose migration is governed by the separate
[migration procedure](container-migration.md). Its retired native database becomes
stale after cutover: returning to it requires a verified current forward checkpoint
and an installation-specific recovery procedure. Container `rollback` does not
cross this boundary, and neither native deploy/rotation scripts nor the retired
native service should be run against the active Compose installation.
