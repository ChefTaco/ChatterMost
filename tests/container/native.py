#!/usr/bin/env python3
"""Build-job proof using locally loaded images, isolated from all operator state."""
import json
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
import tempfile

version = sys.argv[1]
work = Path(tempfile.mkdtemp(prefix='chattermost-native-'))
root = work / 'installation'
try:
    subprocess.run(['python3', 'distribution/package.py', version, 'sha256:' + '0' * 64, 'sha256:' + '1' * 64, str(work / 'bundle')], check=True)
    package = work / 'bundle' / f'chattermost-{version}'
    subprocess.run([str(package / 'chattermost'), '--directory', str(root), 'setup', '--server-url', 'http://127.0.0.1:18065', '--port', '18065', '--redis'], check=True)
    env_file = root / 'compose.env'
    data = env_file.read_text().replace('ghcr.io/cheftaco/chattermost@sha256:' + '0' * 64, os.environ.get('CHATTERMOST_TEST_IMAGE', 'chattermost-local:release')).replace('ghcr.io/cheftaco/chattermost-migrator@sha256:' + '1' * 64, os.environ.get('CHATTERMOST_TEST_MIGRATOR', 'chattermost-migrator-local:release'))
    env_file.write_text(data)
    manager = runpy.run_path(str(root / 'chattermost'), run_name='test_manager')
    compose = manager['compose']
    compose(root, 'pull', 'postgres', 'redis')
    compose(root, 'up', '-d', '--wait', 'postgres', 'redis')
    compose(root, 'run', '--rm', 'initialize')
    compose(root, 'run', '--rm', 'migrate')
    manager['ready'](root)
    subprocess.run(['python3', 'tests/container/smoke.py', str(root), 'seed'], check=True)
    compose(root, 'stop', 'app')
    manager['ready'](root)
    subprocess.run(['python3', 'tests/container/smoke.py', str(root), 'verify'], check=True)
    # Runtime tools and private build inputs must be absent.
    compose(root, 'exec', '-T', 'app', 'node', '-e', "const fs=require('fs');for(const p of ['.env','.git','output','node_modules/prisma','node_modules/typescript','node_modules/@playwright/test','node_modules/eslint'])if(fs.existsSync(p))process.exit(1);if(process.getuid()===0)process.exit(1)")
    compose(root, 'stop', 'app')
    logs = compose(root, 'logs', '--no-color', 'app', capture=True)
    assert b'chattermost_server_stopped' in logs
    print('Native architecture container installation and graceful restart persistence: passed')
except Exception:
    if (root / 'diagnostics.log').exists():
        # Only synthetic isolated diagnostics; redact generated secrets before CI output.
        diagnostics = (root / 'diagnostics.log').read_text()
        for line in (root / 'secrets/runtime.env').read_text().splitlines():
            value = json.loads(line.split('=', 1)[1])
            if len(value) >= 12:
                diagnostics = diagnostics.replace(value, '<synthetic-value>')
        diagnostics = diagnostics.replace((root / 'secrets/postgres_password').read_text().strip(), '<synthetic-password>')
        print(diagnostics[-14000:], file=sys.stderr)
    raise
finally:
    if (root / 'installation.json').exists():
        manager = runpy.run_path(str(root / 'chattermost'), run_name='test_manager')
        manager['compose'](root, 'down', '--volumes', '--remove-orphans')
    shutil.rmtree(work)
