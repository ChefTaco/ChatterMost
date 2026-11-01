#!/usr/bin/env python3
"""Create an allowlisted public release bundle; never archive the working tree."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile

version, app_digest, migrator_digest, output = sys.argv[1:]
out = Path(output)
out.mkdir(parents=True, exist_ok=True)
stage = out / f'chattermost-{version}'
stage.mkdir()
for name in ('compose.yaml', 'chattermost'):
    shutil.copyfile(Path('distribution') / name, stage / name)
for name in ('LICENSE', 'NOTICE'):
    shutil.copyfile(name, stage / name)
shutil.copyfile('docs/containers.md', stage / 'README.md')
schema = json.loads(subprocess.check_output(['node', 'scripts/schema-policy.mjs', 'inspect', '.']))
manifest = {
    'format': 1, 'version': version,
    'revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
    'app_image': f'ghcr.io/cheftaco/chattermost@{app_digest}',
    'migrator_image': f'ghcr.io/cheftaco/chattermost-migrator@{migrator_digest}',
    'postgres_image': 'postgres:16-alpine@sha256:0cefaabd882e42bcb2a2f3dc56d3ce4770560ba62fd7f197f1a2e008fd5731ab',
    'redis_image': 'redis:7.4-alpine@sha256:8da19c7399dca900c6822a1cf30f9d2285585e2c4b457ff4095b0f4500054d3f',
    'postgres_major': 16, 'schema': schema, 'upgrade_from': [] if version.startswith('0.2.') else ['0.2.3'],
    'platforms': ['linux/amd64', 'linux/arm64'], 'instances': 1
}
(stage / 'release.json').write_text(json.dumps(manifest, indent=2) + '\n')
(stage / 'chattermost').chmod(0o755)
archive = out / f'chattermost-{version}.tar.gz'
def public_metadata(info):
    info.uid = info.gid = 0
    info.uname = info.gname = ''
    info.mtime = 0
    return info

with tarfile.open(archive, 'w:gz') as tar:
    tar.add(stage, arcname=stage.name, filter=public_metadata)
shutil.copyfile(stage / 'release.json', out / 'release.json')
shutil.copyfile(stage / 'compose.yaml', out / 'compose.yaml')
shutil.copyfile(stage / 'chattermost', out / 'chattermost')
(out / 'SHA256SUMS').write_text(''.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n' for p in (archive, out / 'release.json', out / 'compose.yaml', out / 'chattermost')))
print(archive.name)
