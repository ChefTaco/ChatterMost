#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [command, ...args] = process.argv.slice(2);

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalPayload(manifest) {
  const { integrity: _integrity, ...payload } = manifest;
  return JSON.stringify(payload);
}

function validate(manifest, file) {
  if (manifest.manifest_version !== 3) throw new Error('Unsupported release manifest version');
  if (!/^\d{14}-[a-f0-9]{7,40}-[a-f0-9]{12}$/u.test(manifest.release_id))
    throw new Error('Invalid release ID');
  if (path.basename(manifest.release_path) !== manifest.release_id)
    throw new Error('Release path does not match release ID');
  if (path.dirname(path.dirname(manifest.release_path)) !== manifest.deploy_path)
    throw new Error('Release path is outside deploy path');
  for (const field of ['code_digest', 'configuration_digest']) {
    if (!/^[a-f0-9]{64}$/u.test(manifest[field])) throw new Error(`Invalid ${field}`);
  }
  if (manifest.schema?.migration_policy !== 'expansion-only')
    throw new Error('Invalid schema migration policy');
  for (const field of [
    'migration_set_digest',
    'lineage_digest',
    'legacy_untracked_schema_digest',
    'repaired_schema_digest'
  ]) {
    if (!/^[a-f0-9]{64}$/u.test(manifest.schema?.[field]))
      throw new Error(`Invalid schema.${field}`);
  }
  if (manifest.schema?.lineage_algorithm !== 'sha256-chain-v1')
    throw new Error('Invalid schema.lineage_algorithm');
  if (!Number.isSafeInteger(manifest.schema?.lineage_depth) || manifest.schema.lineage_depth < 1) {
    throw new Error('Invalid schema.lineage_depth');
  }
  for (const field of ['generation', 'compatible_generation_min', 'compatible_generation_max']) {
    if (!Number.isSafeInteger(manifest.schema?.[field]) || manifest.schema[field] < 1)
      throw new Error(`Invalid schema.${field}`);
  }
  if (
    manifest.schema.compatible_generation_min > manifest.schema.generation ||
    manifest.schema.compatible_generation_max < manifest.schema.generation
  ) {
    throw new Error('Schema generation is outside the release compatibility range');
  }
  if (manifest.integrity !== digest(canonicalPayload(manifest)))
    throw new Error('Release manifest integrity mismatch');
  if (
    file !== undefined &&
    path.resolve(file) !== path.resolve(manifest.release_path, 'release-manifest.json')
  ) {
    throw new Error('Manifest must be stored in its release root');
  }
}

async function readManifest(file) {
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  validate(manifest, file);
  return manifest;
}

switch (command) {
  case 'create': {
    const [file] = args;
    if (file === undefined) throw new Error('create requires an output file');
    const payload = {
      manifest_version: 3,
      release_id: process.env.DEPLOY_RELEASE_ID,
      release_path: process.env.DEPLOY_RELEASE_PATH,
      deploy_path: process.env.CHAT_SERVER_DEPLOY_PATH,
      deploy_user: process.env.CHAT_SERVER_DEPLOY_USER,
      build_hash: process.env.DEPLOY_BUILD_HASH,
      build_date: process.env.DEPLOY_BUILD_DATE,
      code_digest: process.env.DEPLOY_CODE_DIGEST,
      configuration_digest: process.env.DEPLOY_CONFIG_DIGEST,
      postgres_version: process.env.DEPLOY_POSTGRES_VERSION,
      cookie_version: process.env.DEPLOY_COOKIE_VERSION,
      token_version: process.env.DEPLOY_TOKEN_VERSION,
      schema: {
        migration_policy: process.env.DEPLOY_MIGRATION_POLICY,
        migration_set_digest: process.env.DEPLOY_MIGRATION_SET_DIGEST,
        lineage_algorithm: process.env.DEPLOY_SCHEMA_LINEAGE_ALGORITHM,
        lineage_digest: process.env.DEPLOY_SCHEMA_LINEAGE_DIGEST,
        lineage_depth: Number(process.env.DEPLOY_SCHEMA_LINEAGE_DEPTH),
        generation: Number(process.env.DEPLOY_SCHEMA_GENERATION),
        compatible_generation_min: Number(process.env.DEPLOY_COMPATIBLE_SCHEMA_GENERATION_MIN),
        compatible_generation_max: Number(process.env.DEPLOY_COMPATIBLE_SCHEMA_GENERATION_MAX),
        legacy_untracked_schema_digest: process.env.DEPLOY_LEGACY_UNTRACKED_SCHEMA_DIGEST,
        repaired_schema_digest: process.env.DEPLOY_REPAIRED_SCHEMA_DIGEST
      },
      internal_port: process.env.DEPLOY_RUNTIME_PORT,
      preflight_port: process.env.DEPLOY_PREFLIGHT_PORT,
      public_url: process.env.CHAT_SERVER_URL,
      tls_enabled: process.env.DEPLOY_TLS_ENABLED === '1',
      tls_port: process.env.DEPLOY_TLS_PORT,
      tailscale_enabled: /^(1|true)$/u.test(process.env.CHAT_SERVER_DEPLOY_TAILSCALE ?? ''),
      tailscale_cert_host: process.env.DEPLOY_TAILSCALE_CERT_HOST
    };
    const manifest = { ...payload, integrity: digest(JSON.stringify(payload)) };
    validate(manifest);
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o400 });
    await chmod(temporary, 0o400);
    await rename(temporary, file);
    break;
  }
  case 'verify': {
    const [file] = args;
    if (file === undefined) throw new Error('verify requires a manifest file');
    await readManifest(file);
    break;
  }
  case 'emit-nul': {
    const [file] = args;
    if (file === undefined) throw new Error('emit-nul requires a manifest file');
    const manifest = await readManifest(file);
    const fields = {
      RELEASE_ID: manifest.release_id,
      RELEASE_PATH: manifest.release_path,
      DEPLOY_PATH: manifest.deploy_path,
      DEPLOY_USER: manifest.deploy_user,
      BUILD_HASH: manifest.build_hash,
      CODE_DIGEST: manifest.code_digest,
      CONFIG_DIGEST: manifest.configuration_digest,
      POSTGRES_VERSION: manifest.postgres_version,
      COOKIE_VERSION: manifest.cookie_version,
      TOKEN_VERSION: manifest.token_version,
      MIGRATION_POLICY: manifest.schema.migration_policy,
      MIGRATION_SET_DIGEST: manifest.schema.migration_set_digest,
      SCHEMA_LINEAGE_ALGORITHM: manifest.schema.lineage_algorithm,
      SCHEMA_LINEAGE_DIGEST: manifest.schema.lineage_digest,
      SCHEMA_LINEAGE_DEPTH: manifest.schema.lineage_depth,
      SCHEMA_GENERATION: manifest.schema.generation,
      COMPATIBLE_SCHEMA_GENERATION_MIN: manifest.schema.compatible_generation_min,
      COMPATIBLE_SCHEMA_GENERATION_MAX: manifest.schema.compatible_generation_max,
      LEGACY_UNTRACKED_SCHEMA_DIGEST: manifest.schema.legacy_untracked_schema_digest,
      REPAIRED_SCHEMA_DIGEST: manifest.schema.repaired_schema_digest,
      INTERNAL_PORT: manifest.internal_port,
      PREFLIGHT_PORT: manifest.preflight_port,
      PUBLIC_URL: manifest.public_url,
      TLS_ENABLED: manifest.tls_enabled ? '1' : '0',
      TLS_PORT: manifest.tls_port,
      TAILSCALE_ENABLED: manifest.tailscale_enabled ? '1' : '0',
      TAILSCALE_CERT_HOST: manifest.tailscale_cert_host,
      MANIFEST_INTEGRITY: manifest.integrity
    };
    for (const [name, value] of Object.entries(fields)) {
      process.stdout.write(`${name}\0${String(value)}\0`);
    }
    break;
  }
  default:
    throw new Error(`Unknown release-manifest command: ${command ?? '<missing>'}`);
}
