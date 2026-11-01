#!/usr/bin/env python3
"""Real Compose lifecycle proof against the published 0.2.3 baseline.

Candidate mode verifies native images before the versioned release is assembled.
Without digests, the entire happy path uses the public archive and packaged CLI.
Fault injection changes only the disposable test stack.
"""
import hashlib
import json
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
import tempfile
import urllib.request

version = sys.argv[1]
app_digest = sys.argv[2] if len(sys.argv) > 2 else None
migrator_digest = sys.argv[3] if len(sys.argv) > 3 else None
local = os.environ.get('CHATTERMOST_LIFECYCLE_LOCAL') == 'true'
work = Path(tempfile.mkdtemp(prefix='chattermost-lifecycle-'))
root = work / 'installation'
port = os.environ.get('CHATTERMOST_LIFECYCLE_PORT', '18065')
os.umask(0o077)
original_docker_config = os.environ.get('DOCKER_CONFIG')
try:
    subprocess.run(['python3', 'tests/container/published.py', '0.2.3', '--keep', str(work), '--port', port], check=True)
    # Build jobs already use authenticated GHCR pushes, while the baseline
    # installation above deliberately clears Docker credentials in its subprocess.
    if app_digest:
        subprocess.run(['python3', 'distribution/package.py', version, app_digest, migrator_digest, str(work / 'candidate')], check=True)
        tool = work / 'candidate' / f'chattermost-{version}' / 'chattermost'
    else:
        bootstrap = runpy.run_path('distribution/chattermost', run_name='download_bootstrap')
        bootstrap['fetch_release'](root, version)
        tool = root / 'releases' / version / 'chattermost'
    module = runpy.run_path(str(tool), run_name='lifecycle_test')
    namespace = module['switch_release'].__globals__
    actual_fetch = namespace['fetch_release']
    actual_activate = namespace['activate_files']
    actual_compose = namespace['compose']
    actual_run = subprocess.run
    if app_digest:
        candidate = work / 'candidate' / f'chattermost-{version}'
        destination = root / 'releases' / version
        shutil.copytree(candidate, destination)
        module['private_write'](destination / '.verified.json', {'asset_digest': 'sha256:' + 'f' * 64, 'files': module['hashes'](destination)})
        def fetch(root_arg, requested):
            if requested == version:
                return module['cached_release'](root_arg, requested)
            return actual_fetch(root_arg, requested)
        namespace['fetch_release'] = fetch
    else:
        # The final verification downloads and checks the actual public release.
        actual_fetch(root, version)
        tool = root / 'releases' / version / 'chattermost'

    if local:
        def activate(root_arg, release):
            actual_activate(root_arg, release)
            if module['metadata'](release)['app_image'] == f'ghcr.io/cheftaco/chattermost@{app_digest}':
                file = root_arg / 'compose.env'
                data = file.read_text().replace(f'ghcr.io/cheftaco/chattermost@{app_digest}', 'chattermost-local:release').replace(f'ghcr.io/cheftaco/chattermost-migrator@{migrator_digest}', 'chattermost-migrator-local:release')
                file.write_text(data)
        namespace['activate_files'] = activate
        def run(command, *args, **kwargs):
            if isinstance(command, list) and command[:2] == ['docker', 'pull'] and command[-1] in {f'ghcr.io/cheftaco/chattermost@{app_digest}', f'ghcr.io/cheftaco/chattermost-migrator@{migrator_digest}'}:
                return subprocess.CompletedProcess(command, 0)
            return actual_run(command, *args, **kwargs)
        subprocess.run = run

    def smoke():
        actual_run(['python3', 'tests/container/smoke.py', str(root), 'verify'], check=True)

    secret_hashes = module['hashes'](root / 'secrets')
    namespace['fetch_release'](root, '0.2.3')
    baseline_backup = module['snapshot'](root)
    # Real application activation, not a mocked migration or datastore.
    module['switch_release'](root, version)
    smoke()
    assert module['read_state'](root)['current'] == version
    assert secret_hashes == module['hashes'](root / 'secrets')
    backup = module['snapshot'](root)
    assert module['verify_backup'](root, backup)[0]['recoverable']
    module['switch_release'](root, '0.2.3', rollback=True)
    smoke()
    module['switch_release'](root, version)
    smoke()
    # Prove point-in-time recovery: remove a retained post through the API and
    # physically erase the disposable files before restoring the saved backup.
    credentials = dict((k, json.loads(v)) for k, v in (line.split('=', 1) for line in (root / 'secrets/runtime.env').read_text().splitlines()))
    fixture = json.loads((root / 'synthetic-fixture.json').read_text())
    origin = f'http://127.0.0.1:{port}'
    login = urllib.request.Request(origin + '/api/v4/users/login', data=json.dumps({'login_id': credentials['ADMIN_USERNAME'], 'password': credentials['ADMIN_PASSWORD']}).encode(), headers={'Content-Type': 'application/json', 'Origin': origin}, method='POST')
    with urllib.request.urlopen(login, timeout=15) as response:
        token = response.headers['token']
    delete = urllib.request.Request(origin + '/api/v4/posts/' + fixture['post_id'], headers={'Authorization': 'Bearer ' + token}, method='DELETE')
    with urllib.request.urlopen(delete, timeout=15) as response:
        assert response.status == 200
    actual_compose(root, 'exec', '-T', 'app', 'node', '-e', "const fs=require('fs');for(const name of ['files','profile-images']){const dir='/var/lib/chattermost/'+name;fs.rmSync(dir,{recursive:true,force:true});fs.mkdirSync(dir);if(fs.readdirSync(dir).length)process.exit(1);}")
    module['restore'](root, backup)
    smoke()
    assert secret_hashes == module['hashes'](root / 'secrets')

    # Apply genuinely failing additive SQL in a private fault fixture built from
    # the published migration image's own files. No fixture image is published.
    module['switch_release'](root, '0.2.3', rollback=True)
    fixture_root = work / 'failed-migration'
    (fixture_root / 'deploy').mkdir(parents=True)
    migration_image = 'chattermost-migrator-local:release' if local else module['metadata'](root / 'releases' / version)['migrator_image']
    probe = actual_run(['docker', 'create', '--entrypoint', 'true', migration_image], check=True, stdout=subprocess.PIPE, text=True).stdout.strip()
    try:
        actual_run(['docker', 'cp', probe + ':/app/prisma', str(fixture_root / 'prisma')], check=True)
        actual_run(['docker', 'cp', probe + ':/app/deploy/schema-policy.json', str(fixture_root / 'deploy/schema-policy.json')], check=True)
    finally:
        actual_run(['docker', 'rm', probe], check=True, stdout=subprocess.DEVNULL)
    failed_name = '209901010000_synthetic_conflict'
    failed_dir = fixture_root / 'prisma/migrations' / failed_name
    failed_dir.mkdir()
    (failed_dir / 'migration.sql').write_text('CREATE TABLE "RuntimeState" (id TEXT PRIMARY KEY);\n')
    failed_schema = json.loads(actual_run(['node', 'scripts/schema-policy.mjs', 'inspect', str(fixture_root)], check=True, stdout=subprocess.PIPE).stdout)
    module['private_write'](fixture_root / 'schema.json', failed_schema)
    failed_version = '0.3.99'
    failed_release = root / 'releases' / failed_version
    shutil.copytree(root / 'releases' / version, failed_release)
    (failed_release / '.verified.json').unlink()
    manifest = module['metadata'](root / 'releases' / version)
    lineage = hashlib.sha256(b'chattermost-schema-lineage-v1\0').hexdigest()
    ancestry = []
    for file in sorted((fixture_root / 'prisma/migrations').glob('*/migration.sql')):
        checksum = hashlib.sha256(file.read_bytes()).hexdigest()
        lineage = hashlib.sha256(f'{lineage}\0{file.parent.name}\0{checksum}\0'.encode()).hexdigest()
        ancestry.append(lineage)
    module['private_write'](failed_release / 'release.json', {**manifest, 'version': failed_version, 'schema': failed_schema, 'lineage_ancestry': ancestry, 'upgrade_from': ['0.2.3']})
    module['private_write'](failed_release / '.verified.json', {'asset_digest': 'sha256:' + 'e' * 64, 'files': module['hashes'](failed_release)})
    normal_fetch = namespace['fetch_release']
    normal_activate = namespace['activate_files']
    def failed_fetch(root_arg, requested):
        return module['cached_release'](root_arg, requested) if requested == failed_version else normal_fetch(root_arg, requested)
    def failed_activate(root_arg, release):
        normal_activate(root_arg, release)
        if release.name == failed_version:
            file = root_arg / 'compose.yaml'
            mounts = [str(fixture_root / 'prisma/migrations') + ':/app/prisma/migrations:ro', str(fixture_root / 'schema.json') + ':/app/schema.json:ro']
            file.write_text(file.read_text().replace('  migrate:\n', '  migrate:\n    volumes: ' + json.dumps(mounts) + '\n'))
    namespace['fetch_release'] = failed_fetch
    namespace['activate_files'] = failed_activate
    try:
        module['switch_release'](root, failed_version)
        raise AssertionError('Failing migration was accepted')
    except RuntimeError as error:
        assert 'remains stopped' in str(error), str(error)
    observed = module['database_state'](root)
    assert observed['failed'] and any(r['migration_name'] == failed_name for r in observed['rows'])
    assert module['read_state'](root)['recovery_required']
    assert (root / 'pending.json').exists()
    try:
        module['start'](root)
        raise AssertionError('Failed migration allowed start')
    except RuntimeError:
        pass
    assert 'app' not in actual_compose(root, 'ps', '--status', 'running', '--services', capture=True).decode().splitlines()
    module['restore'](root, backup)
    namespace['fetch_release'] = normal_fetch
    namespace['activate_files'] = normal_activate
    shutil.rmtree(failed_release)
    smoke()

    # Force a real candidate container readiness failure. Returning to the
    # verified previous image must keep the database and files untouched.
    module['switch_release'](root, '0.2.3', rollback=True)
    base_activate = namespace['activate_files']
    def unhealthy(root_arg, release):
        base_activate(root_arg, release)
        if release.name == version:
            file = root_arg / 'compose.yaml'
            file.write_text(file.read_text().replace('  app:\n', '  app:\n    command: [synthetic-unhealthy-command]\n'))
    namespace['activate_files'] = unhealthy
    try:
        module['switch_release'](root, version)
        raise AssertionError('Unhealthy candidate was accepted')
    except RuntimeError as error:
        assert 'prior application image was restored' in str(error), str(error)
    namespace['activate_files'] = base_activate
    assert module['read_state'](root)['current'] == '0.2.3'
    assert not (root / 'pending.json').exists()
    smoke()
    module['switch_release'](root, version)

    # Simulate an explicit future schema-generation migration on this disposable
    # database, with its real checksum/lineage. An older image must not activate.
    actual_compose(root, 'stop', 'app')
    sql = 'CREATE TABLE "SyntheticFutureSchema" (id TEXT PRIMARY KEY);'
    name = '209901010001_synthetic_future'
    checksum = hashlib.sha256(sql.encode()).hexdigest()
    actual_compose(root, 'exec', '-T', 'postgres', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'chattermost_app', '-d', 'chattermost', '-c', sql + f" INSERT INTO \"_prisma_migrations\" (id, checksum, migration_name, started_at, finished_at, applied_steps_count) VALUES ('synthetic-future-schema', '{checksum}', '{name}', NOW(), NOW(), 1)")
    state = module['read_state'](root)
    observed = module['database_state'](root)
    future_schema = {**state['schema'], 'schema_generation': 2, 'migration_set_digest': observed['migration_set_digest'], 'schema_lineage_digest': observed['schema_lineage_digest'], 'lineage_ancestry': state['schema']['lineage_ancestry'] + [observed['schema_lineage_digest']]}
    module['private_write'](root / 'state.json', {**state, 'schema': future_schema})
    try:
        module['switch_release'](root, '0.2.3', rollback=True)
        raise AssertionError('Incompatible rollback was accepted')
    except RuntimeError as error:
        assert 'incompatible with the current schema generation' in str(error), str(error)
    assert 'app' not in actual_compose(root, 'ps', '--status', 'running', '--services', capture=True).decode().splitlines()
    module['restore'](root, backup)
    smoke()
    assert secret_hashes == module['hashes'](root / 'secrets')
    # Old release templates lack volume.nocopy; the new manager must still
    # restore their backups without changing application volume ownership.
    module['restore'](root, baseline_backup)
    assert module['read_state'](root)['current'] == '0.2.3'
    smoke()
    module['switch_release'](root, version)
    smoke()
    if not app_digest:
        # Exercise every distributed CLI entry point with real public artifacts.
        cli = [str(root / 'chattermost'), '--directory', str(root)]
        actual_run(cli + ['status'], check=True, stdout=subprocess.DEVNULL)
        actual_run(cli + ['start'], check=True)
        cli_backup = Path(actual_run(cli + ['backup'], check=True, stdout=subprocess.PIPE, text=True).stdout.strip())
        actual_run(cli + ['rollback'], check=True)
        actual_run(cli + ['upgrade', version], check=True)
        actual_run(cli + ['restore', str(cli_backup), '--confirm-database-replacement'], check=True)
        smoke()
    if os.environ.get('CHATTERMOST_LIFECYCLE_BROWSER') == 'true':
        actual_run(['npx', 'playwright', 'test', '-c', 'tests/container/playwright.config.ts'], env={**os.environ, 'CHATTERMOST_CONTAINER_TEST_ROOT': str(root)}, check=True)
    process_arch = actual_compose(root, 'exec', '-T', 'app', 'node', '-p', 'process.arch', capture=True).decode().strip()
    assert process_arch == {'x86_64': 'x64', 'aarch64': 'arm64'}[os.uname().machine], 'Container was emulated rather than executed natively'
    final_release = module['metadata'](root / 'releases' / version)
    report = Path(os.environ.get('CHATTERMOST_LIFECYCLE_REPORT', 'output/container-lifecycle-proof.json'))
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps({'baseline': '0.2.3', 'version': version, 'architecture': os.uname().machine, 'execution': 'native', 'candidate_app_digest': app_digest, 'candidate_migrator_digest': migrator_digest, 'app_image': final_release['app_image'], 'migrator_image': final_release['migrator_image'], 'public_archive_cli': not bool(app_digest), 'browser_login_and_websocket': os.environ.get('CHATTERMOST_LIFECYCLE_BROWSER') == 'true', 'passed': ['upgrade', 'backup_restore', 'compatible_rollback', 'migration_failure', 'health_failure_recovery', 'incompatible_generation_refusal', 'accounts_bot_tokens_messages_attachments_profiles_preserved', 'secrets_unchanged']}, indent=2) + '\n')
    print('Lifecycle proof passed: published baseline upgrade, backup/restore, compatible rollback, migration failure, health failure recovery and incompatible-generation refusal')
except Exception:
    if (root / 'diagnostics.log').exists():
        diagnostics = (root / 'diagnostics.log').read_text()
        for line in (root / 'secrets/runtime.env').read_text().splitlines():
            value = json.loads(line.split('=', 1)[1])
            if len(value) >= 12:
                diagnostics = diagnostics.replace(value, '<synthetic-value>')
        diagnostics = diagnostics.replace((root / 'secrets/postgres_password').read_text().strip(), '<synthetic-password>')
        print(diagnostics[-16000:], file=sys.stderr)
    raise
finally:
    subprocess.run = actual_run if 'actual_run' in globals() else subprocess.run
    if (root / 'installation.json').exists():
        manager = runpy.run_path(str(root / 'chattermost'), run_name='cleanup_manager')
        manager['compose'](root, 'down', '--volumes', '--remove-orphans')
    if os.environ.get('CHATTERMOST_KEEP_LIFECYCLE_EVIDENCE'):
        if local:
            Path('output/container-last-lifecycle-path').write_text(str(work))
        print('Synthetic lifecycle evidence retained privately')
    else:
        shutil.rmtree(work)
