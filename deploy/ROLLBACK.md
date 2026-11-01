# Rollback

ChatterMost releases on the deployment host are timestamped directories under the configured deploy path:

```text
/srv/chattermost/releases/<release-id>
/srv/chattermost/current -> /srv/chattermost/releases/<release-id>
```

Each release contains its matching mode-600 `.env`, schema compatibility range, immutable migration-set and chained-lineage digests, and release-owned systemd/nginx configuration. Routine deployment restores code, configuration, and infrastructure together after failed health validation only when the previous release supports the current schema generation and its verified lineage head is the exact current schema or a cryptographic ancestor. Version-2 and older releases can be transition targets only when their migration set exactly matches. Consult `shared/release-transactions.jsonl` for the recorded rollback target, schema evidence, and any `rollback_refused` record.

## Code Rollback

1. SSH to your deployment host:

   ```bash
   ssh -i ~/.ssh/chattermost_deploy_ed25519 chattermost@chat.example.test
   ```

2. List releases:

   ```bash
   ls -1 /srv/chattermost/releases
   ```

3. Prove the target is schema-compatible before changing any link:

   ```bash
   current="$(readlink -f /srv/chattermost/current)"
   target="/srv/chattermost/releases/<release-id>"
   while IFS= read -r -d '' name && IFS= read -r -d '' value; do
     printf -v "$name" '%s' "$value"
   done < <(node "$current/scripts/release-manifest.mjs" emit-nul "$current/release-manifest.json")
   node "$current/scripts/schema-policy.mjs" rollback-compatible \
     "$target" "$current" "$SCHEMA_GENERATION" "$MIGRATION_SET_DIGEST" "$SCHEMA_LINEAGE_DIGEST"
   ```

   Stop if this command reports an incompatible generation, digest, or lineage.

4. Atomically point `current` at the verified previous release:

   ```bash
   ln -s /srv/chattermost/releases/<release-id> /srv/chattermost/.current-rollback
   mv -Tf /srv/chattermost/.current-rollback /srv/chattermost/current
   ```

5. Restart the matched code/configuration pair, then refresh the compatibility environment link:

   ```bash
   sudo systemctl restart chattermost.service
   ln -sfn /srv/chattermost/current/.env /srv/chattermost/shared/.env
   ```

6. Check health:

   ```bash
   curl -fsS https://chat.example.test:9443/api/v4/system/ping
   curl -fsS https://chat.example.test:9443/api/v4/config/client
   ```

## Data Rollback

Database migrations are forward-only and routine releases are expansion-only. Never interpret a code symlink change as a database rollback. If compatibility validation refuses application rollback, keep the forward schema and remediate with compatible code. Restore these shared paths from `scripts/backup.sh` output only as part of an explicit, verified database restore plan:

- `/srv/chattermost/shared/chattermost-store.json`
- `/srv/chattermost/shared/files`
- `/srv/chattermost/shared/profile-images`
- Docker Postgres data for the `chattermost` Compose project

After restoring data, restart `chattermost.service` and repeat the health checks.
