#!/usr/bin/env bash
# Exact code-only rollback for an immutable ChatterMost release. It never
# rewinds Postgres and refuses a different schema, config, or active release.
set -euo pipefail
[[ $# == 3 ]] || { echo 'Usage: rollback-release.sh DEPLOY_PATH EXPECTED_CURRENT_ID TARGET_ID' >&2; exit 64; }
base=$1; expected=$2; target_id=$3
[[ $base =~ ^/[A-Za-z0-9._/-]+$ && $expected =~ ^[0-9]{14}-[a-f0-9]{7,40}-[a-f0-9]{12}$ && $target_id =~ ^[0-9]{14}-[a-f0-9]{7,40}-[a-f0-9]{12}$ ]] || exit 64
exec 9>"$base/.deploy.lock"
flock -n 9 || { echo 'Another release owns the deployment lock' >&2; exit 73; }
current="$base/releases/$expected"
target="$base/releases/$target_id"
[[ $(readlink -f "$base/current") == "$current" && -d $target ]] || { echo 'Active release or rollback target differs' >&2; exit 1; }
node "$current/scripts/release-manifest.mjs" verify "$current/release-manifest.json"
node "$target/scripts/release-manifest.mjs" verify "$target/release-manifest.json"
node - "$current/release-manifest.json" "$target/release-manifest.json" "$base/shared/release-transactions.jsonl" "$expected" "$target" <<'JS'
const fs=require('node:fs');
const [a,b,ledger,expected,target]=process.argv.slice(2);
const current=JSON.parse(fs.readFileSync(a)),prior=JSON.parse(fs.readFileSync(b));
const entries=fs.readFileSync(ledger,'utf8').trim().split('\n').map(line=>JSON.parse(line));
const active=entries.reverse().find(row=>row.status==='activated'&&row.release_id===expected);
if(!active||active.rollback_target!==target)throw Error('Target is not the active release recorded predecessor');
function stableRuntimeEnv(manifestPath, manifest){
 const file=fs.readFileSync(require('node:path').join(require('node:path').dirname(manifestPath),'.env'));
 if(require('node:crypto').createHash('sha256').update(file).digest('hex')!==manifest.configuration_digest)
  throw Error('Release runtime env digest differs from its manifest');
 const fields=new Map();
 for(const line of file.toString('utf8').split(/\r?\n/)){
  if(!line)continue;
  const match=/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
  if(!match||fields.has(match[1]))throw Error('Release runtime env has invalid or duplicate keys');
  if(!['BUILD_HASH','BUILD_DATE','RELEASE_ID'].includes(match[1]))fields.set(match[1],match[2]);
 }
 return [...fields].sort(([left],[right])=>left.localeCompare(right));
}
if(current.schema.generation!==prior.schema.generation ||
 current.schema.migration_set_digest!==prior.schema.migration_set_digest ||
 current.schema.lineage_digest!==prior.schema.lineage_digest ||
 JSON.stringify(stableRuntimeEnv(a,current))!==JSON.stringify(stableRuntimeEnv(b,prior)) ||
 current.internal_port!==prior.internal_port || current.public_url!==prior.public_url ||
 current.tls_enabled!==prior.tls_enabled)throw Error('Code-only rollback compatibility differs');
JS
while IFS= read -r -d '' name && IFS= read -r -d '' value; do
  printf -v "$name" '%s' "$value"
done < <(node "$current/scripts/release-manifest.mjs" emit-nul "$current/release-manifest.json")
"$current/scripts/schema-policy.mjs" rollback-compatible "$target" "$current" "$SCHEMA_GENERATION" "$MIGRATION_SET_DIGEST" "$SCHEMA_LINEAGE_DIGEST"
infra="$base/shared/infrastructure/releases/$target_id"
[[ -f $infra/chattermost.service ]] || { echo 'Previous service unit is absent' >&2; exit 1; }
if [[ $TLS_ENABLED == 1 ]]; then [[ -f $infra/nginx.conf ]] || { echo 'Previous nginx config is absent' >&2; exit 1; }; fi
switch_link() { local next="$2.next-$$"; ln -s "$1" "$next"; mv -Tf "$next" "$2"; }
recover() {
  trap - ERR
  switch_link "$base/shared/infrastructure/releases/$expected/chattermost.service" /etc/systemd/system/chattermost.service || true
  if [[ $TLS_ENABLED == 1 ]]; then
    switch_link "$base/shared/infrastructure/releases/$expected/nginx.conf" /etc/nginx/sites-available/chattermost || true
    switch_link "$base/shared/infrastructure/releases/$expected/nginx.conf" /etc/nginx/sites-enabled/chattermost || true
  fi
  switch_link "$current" "$base/current" || true
  systemctl daemon-reload || true
  if [[ $TLS_ENABLED == 1 ]]; then systemctl reload nginx || true; fi
  systemctl restart chattermost.service || true
  echo 'Rollback probe failed; previous candidate restoration attempted; inspect service and database state' >&2
}
trap recover ERR
switch_link "$infra/chattermost.service" /etc/systemd/system/chattermost.service
if [[ $TLS_ENABLED == 1 ]]; then
  switch_link "$infra/nginx.conf" /etc/nginx/sites-available/chattermost
  switch_link "$infra/nginx.conf" /etc/nginx/sites-enabled/chattermost
fi
systemctl daemon-reload
if [[ $TLS_ENABLED == 1 ]]; then nginx -t; systemctl reload nginx; fi
switch_link "$target" "$base/current"
systemctl restart chattermost.service
for attempt in {1..30}; do
  if curl -fsS "http://127.0.0.1:${INTERNAL_PORT}/api/v4/system/ping" >/dev/null; then break; fi
  [[ $attempt != 30 ]] || exit 1
  sleep 1
done
curl -fsS "${PUBLIC_URL%/}/api/v4/system/ping" >/dev/null
curl -fsS "${PUBLIC_URL%/}/api/v4/config/client" >/dev/null
trap - ERR
node - "$base/shared/release-transactions.jsonl" "$expected" "$target_id" <<'JS'
const fs=require('node:fs');const [path,expected,target]=process.argv.slice(2);
fs.appendFileSync(path,JSON.stringify({recorded_at:new Date().toISOString(),release_id:expected,status:'code-only-rollback',rollback_target:target,schema_state:'unchanged',health_evidence:{internal:'passed',public:'passed'}})+'\n',{mode:0o600});
JS
printf '{"status":"rolled-back","nativeReleaseId":"%s","installedReleaseId":"%s","health":"passed","databaseState":"unchanged"}\n' "$expected" "$target_id"
