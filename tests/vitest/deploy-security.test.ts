import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, mkdtemp, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/server/env.js';
import { createServerApp } from '../../src/server/app.js';
import { createEmptyState } from '../../src/server/store.js';

describe('deployment secret controls', () => {
  const execFileAsync = promisify(execFile);
  const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

  async function createPolicyRoot(root: string, migrations: Record<string, string>): Promise<void> {
    await mkdir(path.join(root, 'deploy'), { recursive: true });
    await writeFile(
      path.join(root, 'deploy', 'schema-policy.json'),
      await readFile('deploy/schema-policy.json', 'utf8')
    );
    for (const [name, sql] of Object.entries(migrations)) {
      const migration = path.join(root, 'prisma', 'migrations', name);
      await mkdir(migration, { recursive: true });
      await writeFile(path.join(migration, 'migration.sql'), sql);
    }
  }

  async function inspectPolicy(root: string): Promise<Record<string, string | number>> {
    const result = await execFileAsync(process.execPath, [
      'scripts/schema-policy.mjs',
      'inspect',
      root
    ]);
    return JSON.parse(result.stdout) as Record<string, string | number>;
  }

  async function createV3Manifest(release: string): Promise<Record<string, string | number>> {
    const policy = await inspectPolicy(release);
    const releaseId = path.basename(release);
    const deployPath = path.dirname(path.dirname(release));
    const manifest = path.join(release, 'release-manifest.json');
    await execFileAsync(process.execPath, ['scripts/release-manifest.mjs', 'create', manifest], {
      env: {
        ...process.env,
        DEPLOY_RELEASE_ID: releaseId,
        DEPLOY_RELEASE_PATH: release,
        CHAT_SERVER_DEPLOY_PATH: deployPath,
        CHAT_SERVER_DEPLOY_USER: 'chattermost',
        DEPLOY_BUILD_HASH: 'abcdef0',
        DEPLOY_BUILD_DATE: '2026-07-25T00:00:00Z',
        DEPLOY_CODE_DIGEST: 'a'.repeat(64),
        DEPLOY_CONFIG_DIGEST: 'b'.repeat(64),
        DEPLOY_POSTGRES_VERSION: 'postgres-v1',
        DEPLOY_COOKIE_VERSION: 'cookie-v1',
        DEPLOY_TOKEN_VERSION: 'token-v1',
        DEPLOY_MIGRATION_POLICY: String(policy.migration_policy),
        DEPLOY_MIGRATION_SET_DIGEST: String(policy.migration_set_digest),
        DEPLOY_SCHEMA_LINEAGE_ALGORITHM: String(policy.schema_lineage_algorithm),
        DEPLOY_SCHEMA_LINEAGE_DIGEST: String(policy.schema_lineage_digest),
        DEPLOY_SCHEMA_LINEAGE_DEPTH: String(policy.schema_lineage_depth),
        DEPLOY_SCHEMA_GENERATION: String(policy.schema_generation),
        DEPLOY_COMPATIBLE_SCHEMA_GENERATION_MIN: String(policy.compatible_schema_generation_min),
        DEPLOY_COMPATIBLE_SCHEMA_GENERATION_MAX: String(policy.compatible_schema_generation_max),
        DEPLOY_LEGACY_UNTRACKED_SCHEMA_DIGEST: String(policy.legacy_untracked_schema_digest),
        DEPLOY_REPAIRED_SCHEMA_DIGEST: String(policy.repaired_schema_digest),
        DEPLOY_RUNTIME_PORT: '19065',
        DEPLOY_PREFLIGHT_PORT: '29065',
        CHAT_SERVER_URL: 'https://chat.example.test',
        DEPLOY_TLS_ENABLED: '1',
        DEPLOY_TLS_PORT: '9443',
        CHAT_SERVER_DEPLOY_TAILSCALE: 'true',
        DEPLOY_TAILSCALE_CERT_HOST: 'chat.example.test'
      }
    });
    return policy;
  }

  it('stages runtime configuration over stdin instead of a remote heredoc', async () => {
    const deploy = await readFile('scripts/deploy.sh', 'utf8');
    expect(deploy).toContain('umask 077');
    expect(deploy).toContain('render-runtime "$RUNTIME_ENV_FILE"');
    expect(deploy).toContain("stat -c '%a'");
    expect(deploy).toContain("'$REMOTE_RELEASE/.env'");
    expect(deploy).not.toMatch(/ssh[^\n]+REMOTE_POSTGRES_PASSWORD/u);
    expect(deploy).not.toMatch(/ssh[^\n]+REMOTE_COOKIE_SECRET/u);
  });

  it('fails closed for established secrets and points rotation to an explicit command', async () => {
    const deploy = await readFile('scripts/deploy.sh', 'utf8');
    expect(deploy).toContain('Established deployment is missing a readable $runtime_name');
    expect(deploy).toContain('routine deploy cannot rotate it');

    const rotation = await readFile('scripts/rotate-deployment-secrets.sh', 'utf8');
    expect(rotation).toContain('--confirm ROTATE_CHATTERMOST_SECRETS');
    expect(rotation).toContain('rollback()');
    expect(rotation).toContain('invalidate-sessions.sql');

    const tokenRotation = await readFile('scripts/rotate-token-hash-secret.sh', 'utf8');
    expect(tokenRotation).toContain('ROTATE_CHATTERMOST_TOKEN_HASH_SECRET');
    expect(tokenRotation).toContain('bot_tokens_invalidated');
    expect(tokenRotation).toContain('rollback()');
  });

  it('renews the deployment host certificate through a ChatterMost-owned fail-closed timer', async () => {
    const renewal = await readFile('deploy/chattermost-cert-renew.sh', 'utf8');
    const installer = await readFile('scripts/install-cert-renewal.sh', 'utf8');
    const timer = await readFile('deploy/chattermost-cert-renew.timer', 'utf8');
    await execFileAsync('bash', [
      '-n',
      'deploy/chattermost-cert-renew.sh',
      'scripts/install-cert-renewal.sh'
    ]);

    expect(renewal).toContain('mktemp -d /run/chattermost-cert-renew.XXXXXX');
    expect(renewal).toContain('openssl x509 -in "$staging_dir/certificate" -noout -checkend');
    expect(renewal).toContain('openssl x509 -in "$staging_dir/certificate" -noout -checkhost');
    expect(renewal.indexOf('nginx -t')).toBeLessThan(
      renewal.indexOf('systemctl reload nginx.service')
    );
    expect(renewal).toContain('restore_previous');
    expect(renewal).toContain('Existing certificate state is incomplete; refusing renewal.');
    expect(installer).toContain('env-file.mjs" emit-nul');
    expect(installer).toContain('StrictHostKeyChecking=yes');
    expect(installer).toContain("sudo -S -p ''");
    expect(timer).toContain('Persistent=true');
    expect(timer).toContain('WantedBy=timers.target');
  });

  it('pins the public host and runs the application with a restricted systemd sandbox', async () => {
    const nginx = await readFile('deploy/nginx.conf', 'utf8');
    const service = await readFile('deploy/chattermost.service', 'utf8');
    expect(nginx).toContain('server_name __TAILSCALE_HOST__;');
    expect(nginx).toContain('if ($host != __TAILSCALE_HOST__) { return 421; }');
    expect(nginx).toContain('https://__TAILSCALE_HOST__:__TLS_PORT__$request_uri');
    expect(nginx).toContain('Strict-Transport-Security "max-age=31536000" always');
    expect(service).toContain('ProtectSystem=strict');
    expect(service).toContain('ProtectHome=read-only');
    expect(service).toContain('PrivateDevices=true');
    expect(service).toContain('CapabilityBoundingSet=');
    expect(service).toContain('RestrictNamespaces=true');
    expect(service).toContain('UMask=0077');
  });

  it('ships one immutable artifact and atomically activates code with configuration', async () => {
    const deploy = await readFile('scripts/deploy.sh', 'utf8');
    expect(deploy).toContain('npm ci');
    expect(deploy).not.toContain("cd '$REMOTE_RELEASE' && npm ci");
    expect(deploy).toContain("--exclude='./data'");
    expect(deploy).not.toContain("--exclude='data'");
    expect(deploy).toContain('Remote artifact digest mismatch');
    expect(deploy).toContain('release-manifest.json');
    expect(deploy).toContain('chmod -R a-w');
    expect(deploy).toContain("chmod 600 '$REMOTE_STAGE/.env'");
    expect(deploy).not.toContain('StrictHostKeyChecking=accept-new');

    const activation = await readFile('scripts/activate-release.sh', 'utf8');
    expect(activation).toContain('rollback_target');
    expect(activation).toContain('mv -Tf "$next" "$CURRENT"');
    expect(activation).toContain('switch_current "$PREVIOUS"');
    expect(activation).toContain('release-transactions.jsonl');
  });

  it('excludes private operator files and separately installed tools from release archives', async () => {
    const deploy = await readFile('scripts/deploy.sh', 'utf8');
    const archiveCommand = deploy.split('\n').find((line) => line.startsWith('tar --exclude='));
    expect(archiveCommand).toBeDefined();
    if (archiveCommand === undefined) throw new Error('Missing release archive command');
    const root = await mkdtemp(path.join(os.tmpdir(), 'chattermost-archive-'));
    for (const name of ['deploy/ssh_known_hosts', 'mmcli_linux_bin/mmctl', '.env', '.env.private', 'private/notes.md', 'backups/history.bundle', 'shared/ledger.jsonl', 'ethersage.project.yaml']) {
      await mkdir(path.dirname(path.join(root, name)), { recursive: true });
      await writeFile(path.join(root, name), 'private-synthetic-fixture');
    }
    await writeFile(path.join(root, 'LICENSE'), 'public-license-fixture');
    const artifact = path.join(root, '..', `${path.basename(root)}.tar.gz`);
    await execFileAsync('bash', ['-c', archiveCommand], { cwd: root, env: { ...process.env, ARTIFACT: artifact } });
    const listing = await execFileAsync('tar', ['-tzf', artifact]);
    expect(listing.stdout).toContain('./LICENSE');
    expect(listing.stdout).not.toMatch(/ssh_known_hosts|mmctl|\.env|notes|history|ledger|ethersage/u);
  });

  it('keeps staging non-mutating and serializes migration through activation', async () => {
    const deploy = await readFile('scripts/deploy.sh', 'utf8');
    const transaction = await readFile('scripts/release-transaction.sh', 'utf8');
    expect(deploy).toContain('--no-restart is deprecated; using the non-mutating --stage phase.');
    expect(deploy.indexOf('if [[ "$PHASE" == stage ]]')).toBeLessThan(
      deploy.indexOf('run_transaction all')
    );
    expect(transaction).toContain('flock -n 9');
    expect(transaction).toContain('Another ChatterMost deployment transaction is active');
    expect(transaction.indexOf('all) migrate; activate')).toBeGreaterThan(
      transaction.indexOf('flock -n 9')
    );
    expect(transaction).toContain('has no matching successful migration phase');
    expect(transaction).toContain('exec env CHATTERMOST_ENV_FILE="$preflight_env" node');
    expect(transaction).toContain('render-preflight');
    expect(transaction).toContain('systemd-analyze verify');
    expect(transaction).toContain('nginx -t -c "$nginx_test_config"');
    expect(transaction).not.toContain(
      'install -m 0644 "$RELEASE_PATH/deploy/chattermost.service" /etc/systemd/system/chattermost.service'
    );
  });

  it('uses collision-resistant release IDs and fail-closed migration baselining', async () => {
    const deploy = await readFile('scripts/deploy.sh', 'utf8');
    const migration = await readFile('scripts/migrate-release.sh', 'utf8');
    expect(deploy).toContain('$(openssl rand -hex 6)');
    expect(deploy).toContain('${BUILD_HASH}');
    expect(migration).toContain('database_migration_table');
    expect(migration).toContain('failed_migration');
    expect(migration).toContain('database_migration_table: table');
    expect(migration).toContain('pg_dump --schema-only --no-owner --no-privileges');
    expect(migration).toContain('"$pre_repair_hash" != "$LEGACY_UNTRACKED_SCHEMA_DIGEST"');
    expect(migration).toContain('"$post_repair_hash" == "$REPAIRED_SCHEMA_DIGEST"');
    expect(migration).toContain('prisma/legacy/202607020020_untracked_repair.sql');
    expect(migration).toContain('LEGACY_UNTRACKED_SCHEMA_DIGEST');
    expect(migration).toContain('MANIFEST_SCHEMA_LINEAGE_DIGEST');
    expect(migration).toContain('PRE_REPAIR_HASH');
    expect(migration).toContain('POST_REPAIR_HASH');
    expect(migration).toContain('find prisma/migrations');
    expect(migration).not.toContain('202607011320_initial/migration.sql');
    expect(migration).not.toContain('202607020020_runtime_state_custom_emoji/migration.sql');
    expect(deploy).not.toContain('202607011320_initial/migration.sql');
    expect(deploy).not.toContain('202607020020_runtime_state_custom_emoji/migration.sql');
  });

  it('detects release manifest tampering before a transaction', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'chattermost-manifest-'));
    const releaseId = '20260723190000-abcdef0-a1b2c3d4e5f6';
    const release = path.join(root, 'releases', releaseId);
    const manifest = path.join(release, 'release-manifest.json');
    await mkdir(release, { recursive: true });
    const env = {
      ...process.env,
      DEPLOY_RELEASE_ID: releaseId,
      DEPLOY_RELEASE_PATH: release,
      CHAT_SERVER_DEPLOY_PATH: root,
      CHAT_SERVER_DEPLOY_USER: 'chattermost',
      DEPLOY_BUILD_HASH: 'abcdef0',
      DEPLOY_BUILD_DATE: '2026-07-23T19:00:00Z',
      DEPLOY_CODE_DIGEST: 'a'.repeat(64),
      DEPLOY_CONFIG_DIGEST: 'b'.repeat(64),
      DEPLOY_POSTGRES_VERSION: 'postgres-v1',
      DEPLOY_COOKIE_VERSION: 'cookie-v1',
      DEPLOY_TOKEN_VERSION: 'token-v1',
      DEPLOY_MIGRATION_POLICY: 'expansion-only',
      DEPLOY_MIGRATION_SET_DIGEST: 'c'.repeat(64),
      DEPLOY_SCHEMA_LINEAGE_ALGORITHM: 'sha256-chain-v1',
      DEPLOY_SCHEMA_LINEAGE_DIGEST: 'f'.repeat(64),
      DEPLOY_SCHEMA_LINEAGE_DEPTH: '2',
      DEPLOY_SCHEMA_GENERATION: '1',
      DEPLOY_COMPATIBLE_SCHEMA_GENERATION_MIN: '1',
      DEPLOY_COMPATIBLE_SCHEMA_GENERATION_MAX: '1',
      DEPLOY_LEGACY_UNTRACKED_SCHEMA_DIGEST: 'd'.repeat(64),
      DEPLOY_REPAIRED_SCHEMA_DIGEST: 'e'.repeat(64),
      DEPLOY_RUNTIME_PORT: '19065',
      DEPLOY_PREFLIGHT_PORT: '29065',
      CHAT_SERVER_URL: 'https://chat.example.test',
      DEPLOY_TLS_ENABLED: '1',
      DEPLOY_TLS_PORT: '9443',
      CHAT_SERVER_DEPLOY_TAILSCALE: 'true',
      DEPLOY_TAILSCALE_CERT_HOST: 'chat.example.test'
    };
    await execFileAsync(process.execPath, ['scripts/release-manifest.mjs', 'create', manifest], {
      env
    });
    await execFileAsync(process.execPath, ['scripts/release-manifest.mjs', 'verify', manifest]);
    const parsed = JSON.parse(await readFile(manifest, 'utf8')) as Record<string, unknown>;
    parsed.build_hash = 'tampered';
    await chmod(manifest, 0o600);
    await writeFile(manifest, JSON.stringify(parsed));
    await expect(
      execFileAsync(process.execPath, ['scripts/release-manifest.mjs', 'verify', manifest])
    ).rejects.toThrow();
  });

  it('pins expansion-only schema compatibility and refuses unsupported rollback', async () => {
    expect((await stat('scripts/schema-policy.mjs')).mode & 0o111).not.toBe(0);
    const policy = await execFileAsync(process.execPath, [
      'scripts/schema-policy.mjs',
      'inspect',
      '.'
    ]);
    const parsed = JSON.parse(policy.stdout) as Record<string, unknown>;
    expect(parsed.migration_policy).toBe('expansion-only');
    expect(parsed.schema_generation).toBe(1);
    expect(parsed.migration_set_digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(parsed.schema_lineage_algorithm).toBe('sha256-chain-v1');
    expect(parsed.schema_lineage_digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(parsed.schema_lineage_depth).toBe(2);

    const activation = await readFile('scripts/activate-release.sh', 'utf8');
    expect(activation).toContain('rollback-compatible');
    expect(activation).toContain('rollback_refused');
    expect(activation).toContain(
      'switch_link "$CHATTERMOST_INFRASTRUCTURE_RELEASE/chattermost.service"'
    );
    expect(activation).toContain('restore_link "$PREVIOUS_SYSTEMD"');
  });

  it('structurally rejects hidden data, code, constraint, and populated-table changes', async () => {
    const fixtures = [
      'cte-delete.sql',
      'cte-update.sql',
      'block-comment-drop.sql',
      'function-delete.sql',
      'do-dynamic-sql.sql',
      'procedure-call.sql',
      'validated-constraint.sql',
      'not-null-without-default.sql',
      'not-null-dynamic-default.sql',
      'serial-column.sql',
      'unapproved-extension.sql'
    ];
    for (const fixture of fixtures) {
      const root = await mkdtemp(path.join(os.tmpdir(), 'chattermost-adversarial-migration-'));
      await createPolicyRoot(root, {
        '20260725000000_adversarial': await readFile(
          path.join('tests/fixtures/schema-policy', fixture),
          'utf8'
        )
      });
      await expect(
        execFileAsync(process.execPath, ['scripts/schema-policy.mjs', 'inspect', root]),
        fixture
      ).rejects.toThrow('violates the expansion-only policy');
    }
  });

  it('allows only structurally safe populated-table additions', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'chattermost-safe-migration-'));
    await createPolicyRoot(root, {
      '20260725000000_safe': await readFile(
        'tests/fixtures/schema-policy/safe-additions.sql',
        'utf8'
      )
    });
    const parsed = await inspectPolicy(root);
    expect(parsed.migration_set_digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(parsed.schema_lineage_digest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('allows rollback only across an exact or cryptographically chained schema lineage', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'chattermost-lineage-'));
    const previous = path.join(root, 'releases', '20260725000000-abcdef0-a1b2c3d4e5f6');
    const current = path.join(root, 'releases', '20260725000001-abcdef1-b1c2d3e4f5a6');
    const divergent = path.join(root, 'releases', '20260725000002-abcdef2-c1d2e3f4a5b6');
    const initial = 'CREATE TABLE "LineageBase" ("id" TEXT PRIMARY KEY);\n';
    await createPolicyRoot(previous, { '20260725000000_initial': initial });
    const previousPolicy = await createV3Manifest(previous);
    await createPolicyRoot(current, {
      '20260725000000_initial': initial,
      '20260725000001_additive': 'CREATE TABLE "LineageChild" ("id" TEXT PRIMARY KEY);\n'
    });
    const currentPolicy = await inspectPolicy(current);
    await execFileAsync(process.execPath, [
      'scripts/schema-policy.mjs',
      'rollback-compatible',
      previous,
      current,
      String(currentPolicy.schema_generation),
      String(currentPolicy.migration_set_digest),
      String(currentPolicy.schema_lineage_digest)
    ]);

    await createPolicyRoot(divergent, {
      '20260725000000_divergent': 'CREATE TABLE "DifferentBase" ("id" TEXT PRIMARY KEY);\n'
    });
    const divergentPolicy = await inspectPolicy(divergent);
    expect(divergentPolicy.schema_lineage_digest).not.toBe(previousPolicy.schema_lineage_digest);
    await expect(
      execFileAsync(process.execPath, [
        'scripts/schema-policy.mjs',
        'rollback-compatible',
        previous,
        divergent,
        String(divergentPolicy.schema_generation),
        String(divergentPolicy.migration_set_digest),
        String(divergentPolicy.schema_lineage_digest)
      ])
    ).rejects.toThrow('not an ancestor');
  });

  it('requires an exact migration digest for version-2 rollback transition', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'chattermost-lineage-v2-'));
    const previous = path.join(root, 'releases', '20260725000000-abcdef0-a1b2c3d4e5f6');
    const current = path.join(root, 'releases', '20260725000001-abcdef1-b1c2d3e4f5a6');
    await createPolicyRoot(previous, {
      '20260725000000_initial': 'CREATE TABLE "OldBranch" ("id" TEXT PRIMARY KEY);\n'
    });
    await createPolicyRoot(current, {
      '20260725000000_initial': 'CREATE TABLE "NewBranch" ("id" TEXT PRIMARY KEY);\n'
    });
    const previousPolicy = await inspectPolicy(previous);
    const currentPolicy = await inspectPolicy(current);
    const payload = {
      manifest_version: 2,
      schema: {
        migration_set_digest: previousPolicy.migration_set_digest,
        compatible_generation_min: 1,
        compatible_generation_max: 1
      }
    };
    await writeFile(
      path.join(previous, 'release-manifest.json'),
      JSON.stringify({ ...payload, integrity: digest(JSON.stringify(payload)) })
    );
    await expect(
      execFileAsync(process.execPath, [
        'scripts/schema-policy.mjs',
        'rollback-compatible',
        previous,
        current,
        String(currentPolicy.schema_generation),
        String(currentPolicy.migration_set_digest),
        String(currentPolicy.schema_lineage_digest)
      ])
    ).rejects.toThrow('migration set differs');
  });

  it('keeps preflight health-only and prevents startup or request writes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'chattermost-preflight-'));
    const storePath = path.join(root, 'store.json');
    const filesPath = path.join(root, 'files-not-created');
    const profilesPath = path.join(root, 'profiles-not-created');
    await writeFile(storePath, JSON.stringify(createEmptyState()), { mode: 0o600 });
    const env = loadEnv({
      envFile: path.join(root, 'missing.env'),
      enforceFileMode: false,
      overrides: {
        NODE_ENV: 'test',
        PREFLIGHT_MODE: 'true',
        STORE_BACKEND: 'json',
        STORE_PATH: storePath,
        FILE_STORAGE_PATH: filesPath,
        PROFILE_IMAGE_STORAGE_PATH: profilesPath
      }
    });
    const server = await createServerApp(env);
    const before = await readFile(storePath, 'utf8');
    const ping = await server.app.request('/api/v4/system/ping');
    const blocked = await server.app.request('/api/v4/users', { method: 'POST', body: '{}' });
    expect(ping.status).toBe(200);
    expect(blocked.status).toBe(503);
    await expect(server.services.users.ensureAdminFromEnv()).rejects.toThrow(
      'Writes are disabled in preflight mode'
    );
    await server.store.close();
    await server.abuseControl.close();
    expect(await readFile(storePath, 'utf8')).toBe(before);
    await expect(readFile(filesPath)).rejects.toThrow();
    await expect(readFile(profilesPath)).rejects.toThrow();
  });

  it('round-trips quoted dotenv values without interpretation loss', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'chattermost-dotenv-'));
    const output = path.join(root, 'runtime.env');
    const special = ' space # "double" \'single\' `backtick` \\ slash = equals 雪 ';
    await execFileAsync(process.execPath, ['scripts/env-file.mjs', 'render-runtime', output], {
      env: {
        ...process.env,
        DEPLOY_RUNTIME_PORT: '19065',
        DEPLOY_POSTGRES_PASSWORD: 'url-safe-password',
        DEPLOY_COOKIE_SECRET: special.repeat(2),
        DEPLOY_TOKEN_HASH_SECRET: `token-${special}`,
        DEPLOY_BUILD_HASH: 'abcdef0',
        DEPLOY_BUILD_DATE: '2026-07-22T00:00:00Z',
        DEPLOY_RELEASE_ID: '20260722000000',
        CHAT_SERVER_URL: 'https://chat.example.test',
        CHAT_SERVER_DEPLOY_PATH: '/srv/chattermost',
        CHAT_SERVER_ADMIN_USERNAME: 'admin',
        CHAT_SERVER_ADMIN_PASSWORD: special
      }
    });
    const values = loadEnv({ envFile: output, enforceFileMode: true });
    expect(values.ADMIN_PASSWORD).toBe(special);
    expect(values.COOKIE_SECRET).toBe(special.repeat(2));
    expect(values.TOKEN_HASH_SECRET).toBe(`token-${special}`);
    expect(values.NODE_ENV).toBe('production');
    expect(values.ENABLE_DEV_DEFAULTS).toBe(false);
    expect(values.ENABLE_REDIS_FANOUT).toBe(false);
    expect(values.ENABLE_DISTRIBUTED_RATE_LIMIT).toBe(true);
  });

  it('omits an unset optional Security Fusion hash and accepts disabled startup', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'chattermost-security-fusion-disabled-'));
    const output = path.join(root, 'runtime.env');
    await execFileAsync(process.execPath, ['scripts/env-file.mjs', 'render-runtime', output], {
      env: {
        ...process.env,
        SECURITY_FUSION_SERVICE_TOKEN_HASH: '',
        DEPLOY_RUNTIME_PORT: '19065',
        DEPLOY_POSTGRES_PASSWORD: 'url-safe-password',
        DEPLOY_COOKIE_SECRET: 'cookie-secret-with-enough-entropy',
        DEPLOY_TOKEN_HASH_SECRET: 'token-secret-with-enough-entropy',
        DEPLOY_BUILD_HASH: 'abcdef0',
        DEPLOY_BUILD_DATE: '2026-07-27T00:00:00Z',
        DEPLOY_RELEASE_ID: '20260727000000',
        CHAT_SERVER_URL: 'https://chat.example.test',
        CHAT_SERVER_DEPLOY_PATH: '/srv/chattermost',
        CHAT_SERVER_ADMIN_USERNAME: 'admin',
        CHAT_SERVER_ADMIN_PASSWORD: 'admin-password-with-enough-entropy'
      }
    });
    expect(await readFile(output, 'utf8')).not.toContain('SECURITY_FUSION_SERVICE_TOKEN_HASH');
    expect(loadEnv({
      envFile: output,
      enforceFileMode: true,
      overrides: { SECURITY_FUSION_SERVICE_TOKEN_HASH: '' }
    }).SECURITY_FUSION_SERVICE_TOKEN_HASH).toBeUndefined();
    expect(loadEnv({
      enforceFileMode: false,
      overrides: {
        NODE_ENV: 'test',
        ENABLE_DEV_DEFAULTS: 'true',
        SECURITY_FUSION_SERVICE_TOKEN_HASH: ''
      }
    }).SECURITY_FUSION_SERVICE_TOKEN_HASH).toBeUndefined();
  });

  it('renders and validates an enabled Security Fusion hash', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'chattermost-security-fusion-enabled-'));
    const output = path.join(root, 'runtime.env');
    const securityFusionHash = 'a'.repeat(64);
    await execFileAsync(process.execPath, ['scripts/env-file.mjs', 'render-runtime', output], {
      env: {
        ...process.env,
        SECURITY_FUSION_SERVICE_TOKEN_HASH: securityFusionHash,
        DEPLOY_RUNTIME_PORT: '19065',
        DEPLOY_POSTGRES_PASSWORD: 'url-safe-password',
        DEPLOY_COOKIE_SECRET: 'cookie-secret-with-enough-entropy',
        DEPLOY_TOKEN_HASH_SECRET: 'token-secret-with-enough-entropy',
        DEPLOY_BUILD_HASH: 'abcdef0',
        DEPLOY_BUILD_DATE: '2026-07-27T00:00:00Z',
        DEPLOY_RELEASE_ID: '20260727000000',
        CHAT_SERVER_URL: 'https://chat.example.test',
        CHAT_SERVER_DEPLOY_PATH: '/srv/chattermost',
        CHAT_SERVER_ADMIN_USERNAME: 'admin',
        CHAT_SERVER_ADMIN_PASSWORD: 'admin-password-with-enough-entropy'
      }
    });
    expect(loadEnv({ envFile: output, enforceFileMode: true }).SECURITY_FUSION_SERVICE_TOKEN_HASH).toBe(securityFusionHash);
  });
});
