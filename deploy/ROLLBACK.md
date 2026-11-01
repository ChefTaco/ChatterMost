# Rollback and deployment boundaries

Check private `CHAT_SERVER_DEPLOY_MODE` before choosing recovery. Keep release
identifiers, backup paths, credentials and diagnostics in private operator storage.

## Compose installations

Use the installed `chattermost` manager's `status`, `rollback`, `recover` or explicit
`restore` operation according to [upgrades and recovery](../docs/upgrading.md).
Application rollback retains the forward database and requires schema generation,
lineage and actual schema compatibility. Database/file restoration is a separate
point-in-time operation and discards writes after the chosen recovery point.
Never start a retired native writer or use the native deploy/rotation scripts.

Returning from Compose to a retained separate native database requires the
installation-specific [migration recovery procedure](../docs/container-migration.md#native-rollback-boundary).
It must preserve current forward data. Starting the stale original database does
not constitute a safe rollback. A fresh Compose installation or native import may
have no previous container release recorded.

## Native code-only rollback

The supported native path is the guarded transaction in `scripts/deploy.sh` and
`scripts/rollback-release.sh`, run from the operator checkout with its protected
`.env` and verified SSH host pin. Supply the recorded native release identifiers:

```bash
scripts/deploy.sh --rollback PREVIOUS_ID --expected-current CANDIDATE_ID
```

Replace both placeholders with the exact timestamp/commit/random release IDs from
private manifests and `shared/release-transactions.jsonl`. This is a code-only
rollback to the recorded predecessor, not a general downgrade selector. It checks:

- The active `current` symlink still names the expected candidate.
- Both immutable manifests and matching environment digests verify.
- The ledger identifies the target as the candidate's predecessor.
- Runtime configuration, origin, listener, generation, migration-set digest and
  chained lineage satisfy the code-only compatibility contract.
- The prior release-owned systemd/nginx artifacts exist.

The transaction holds the deployment lock, switches matching application and
infrastructure links, restarts the native service and checks internal/public ping
and client configuration. It retains the current Postgres data. If health fails,
it attempts to return to the candidate and retains evidence for inspection.
Do not bypass these checks with manual `ln -s` or a bare service restart.

Automatic native activation recovery also depends on the previous release's
supported generation and proven lineage. Older manifests without ancestry proofs
have stricter migration-set matching. A failed compatibility check stops recovery;
availability of an old code archive is not proof that it can read the current DB.

## Native data recovery

For migration-bearing or incompatible changes, keep the writer stopped and review
compatible forward remediation or an explicitly selected, verified recovery point.
The [native backup boundary](../docs/deployment.md#backups-and-rollback) requires the
Postgres state, complete files/profile images, matching protected environment,
application and infrastructure. A code symlink change does not rewind Postgres.
The legacy `backup.sh` helper alone does not provide a consistent complete recovery
package. Preserve current evidence and any newer writes before choosing a restore;
then verify retained accounts, bot authentication, files and WebSocket delivery.
