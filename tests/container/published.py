#!/usr/bin/env python3
"""Anonymous install proof using only a public release bundle and registry pulls."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('version')
parser.add_argument('--keep', type=Path)
parser.add_argument('--port', type=int, default=18065)
args = parser.parse_args()
work = args.keep.resolve() if args.keep else Path(tempfile.mkdtemp(prefix='chattermost-public-'))
work.mkdir(mode=0o700, parents=True, exist_ok=True)
root = work / 'installation'
root_created = False
os.umask(0o077)
# No source tree, local build or registry authentication is used by the installer.
config = work / 'anonymous-docker'
config.mkdir(exist_ok=True)
(config / 'config.json').write_text('{"auths":{}}\n')
os.environ['DOCKER_CONFIG'] = str(config)
# Keep the user's installed Compose plugin discoverable under the empty config.
plugin_source = Path.home() / '.docker/cli-plugins'
if plugin_source.exists():
    (config / 'cli-plugins').symlink_to(plugin_source)
release_url = f'https://api.github.com/repos/ChefTaco/ChatterMost/releases/tags/v{args.version}'
release = json.load(urllib.request.urlopen(release_url))
asset = next(a for a in release['assets'] if a['name'] == f'chattermost-{args.version}.tar.gz')
archive = work / asset['name']
archive.write_bytes(urllib.request.urlopen(asset['browser_download_url']).read())
digest = 'sha256:' + hashlib.sha256(archive.read_bytes()).hexdigest()
assert digest == asset['digest'], 'GitHub release asset integrity mismatch'
with tarfile.open(archive) as tar:
    prefix = f'chattermost-{args.version}'
    allowed = {prefix, *(prefix + '/' + n for n in ('chattermost', 'compose.yaml', 'release.json', 'README.md', 'LICENSE', 'NOTICE'))}
    assert all(m.name in allowed and (m.isfile() or m.isdir()) for m in tar.getmembers())
    tar.extractall(work, filter='data')
package = work / prefix
try:
    subprocess.run([str(package / 'chattermost'), '--directory', str(root), 'setup', '--server-url', f'http://127.0.0.1:{args.port}', '--port', str(args.port)], check=True)
    root_created = True
    subprocess.run([str(root / 'chattermost'), '--directory', str(root), 'start'], check=True)
    subprocess.run(['python3', 'tests/container/smoke.py', str(root), 'seed'], check=True)
    manager = runpy.run_path(str(root / 'chattermost'), run_name='test_manager')
    manager['compose'](root, 'stop', 'app')
    subprocess.run([str(root / 'chattermost'), '--directory', str(root), 'start'], check=True)
    subprocess.run(['python3', 'tests/container/smoke.py', str(root), 'verify'], check=True)
    evidence = {'version': args.version, 'architecture': os.uname().machine, 'anonymous_pull': True, 'fresh_install': True, 'restart_persistence': True, 'synthetic_http_files_bot_websocket': True, 'release_asset_digest': digest, 'images': json.loads((package / 'release.json').read_text())}
    (work / 'public-verification.json').write_text(json.dumps(evidence, indent=2) + '\n')
    print('Anonymous public image pulls and source-free published installation: passed')
finally:
    if not args.keep:
        if root_created:
            manager = runpy.run_path(str(root / 'chattermost'), run_name='test_manager')
            manager['compose'](root, 'down', '--volumes', '--remove-orphans')
        shutil.rmtree(work)
