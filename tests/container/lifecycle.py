#!/usr/bin/env python3
"""Verify every declared upgrade path, including 0.3.2 for the next release.

Candidate mode uses the reviewed source policy. Public mode obtains the policy
from the integrity-checked published archive. Each path gets its own disposable
installation; only sanitized proof records are aggregated for publication.
"""
import argparse
import json
import os
from pathlib import Path
import re
import runpy
import subprocess
import sys
import tempfile

import github_api

REQUIRED_BASELINE = '0.3.2'
VERSION = re.compile(r'^0\.(?:[2-9]|[1-9][0-9]+)\.[0-9]+$')
REQUIRED_PROOFS = {
    'upgrade', 'backup_restore', 'compatible_rollback', 'migration_failure',
    'health_failure_recovery', 'incompatible_generation_refusal',
    'accounts_bot_tokens_messages_attachments_profiles_preserved',
    'secrets_unchanged', 'baseline_backup_cli', 'baseline_backup_restore',
    'post_upgrade_writes_preserved',
}
PUBLIC_FIELDS = {
    'baseline', 'version', 'architecture', 'execution', 'candidate_app_digest',
    'candidate_migrator_digest', 'app_image', 'migrator_image',
    'public_archive_cli', 'browser_login_and_websocket', 'passed',
    'image_source',
}


def version_tuple(version):
    if not isinstance(version, str) or not VERSION.fullmatch(version):
        raise ValueError('Lifecycle proof requires explicit stable supported versions')
    return tuple(int(part) for part in version.split('.'))


def upgrade_sources(version, policy):
    target = version_tuple(version)
    if policy.get('version') != version:
        raise ValueError('Lifecycle target differs from the reviewed release policy')
    sources = policy.get('upgrade_from')
    if not isinstance(sources, list) or any(not isinstance(source, str) for source in sources):
        raise ValueError('Release must declare an upgrade_from list')
    if len(sources) != len(set(sources)):
        raise ValueError('Duplicate upgrade sources cannot establish separate coverage')
    for source in sources:
        if version_tuple(source) >= target:
            raise ValueError('An upgrade source must precede the target release')
    if target > version_tuple(REQUIRED_BASELINE) and REQUIRED_BASELINE not in sources:
        raise ValueError('Releases after 0.3.2 must declare and test upgrades from 0.3.2')
    if target >= version_tuple('0.3.0') and not sources:
        raise ValueError('Lifecycle releases must declare a tested upgrade source')
    return sources


def run_paths(version, policy, work, report, app_digest=None, migrator_digest=None):
    report.unlink(missing_ok=True)
    sources = upgrade_sources(version, policy)
    if not sources:
        raise ValueError('This release has no lifecycle upgrade paths')
    proofs = []
    for source in sources:
        path_report = work / f'lifecycle-{source}.json'
        command = [sys.executable, 'tests/container/lifecycle_case.py', version]
        if app_digest:
            command.extend([app_digest, migrator_digest])
        command.extend(['--baseline', source])
        subprocess.run(command, check=True, env={**os.environ, 'CHATTERMOST_LIFECYCLE_REPORT': str(path_report)})
        proof = json.loads(path_report.read_text())
        if (proof.get('baseline') != source or proof.get('version') != version
                or proof.get('execution') != 'native'
                or proof.get('candidate_app_digest') != app_digest
                or proof.get('candidate_migrator_digest') != migrator_digest
                or proof.get('public_archive_cli') != (not bool(app_digest))
                or proof.get('architecture') != os.uname().machine
                or not REQUIRED_PROOFS.issubset(proof.get('passed', []))):
            raise ValueError('Incomplete or mismatched lifecycle proof')
        if not set(proof).issubset(PUBLIC_FIELDS):
            raise ValueError('Lifecycle report contains unreviewed publication fields')
        if os.environ.get('CHATTERMOST_LIFECYCLE_BROWSER') == 'true' and proof.get('browser_login_and_websocket') is not True:
            raise ValueError('Required browser lifecycle proof is missing')
        proofs.append(proof)
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps({'version': version, 'upgrade_from': sources, 'paths': proofs}, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('version')
    parser.add_argument('app_digest', nargs='?')
    parser.add_argument('migrator_digest', nargs='?')
    parser.add_argument('--plan', action='store_true', help='Validate and print the source policy before any builds or pushes')
    args = parser.parse_args()
    if bool(args.app_digest) != bool(args.migrator_digest):
        parser.error('Candidate application and migrator digests must be supplied together')
    if any(digest and not re.fullmatch(r'sha256:[a-f0-9]{64}', digest) for digest in (args.app_digest, args.migrator_digest)):
        parser.error('Candidate images require immutable SHA-256 digests')
    if os.environ.get('CHATTERMOST_LIFECYCLE_LOCAL') == 'true' and not args.app_digest:
        parser.error('Local candidate mode cannot establish public archive proof')
    version_tuple(args.version)
    os.umask(0o077)
    github_api.install()
    with tempfile.TemporaryDirectory(prefix='chattermost-lifecycle-plan-') as directory:
        work = Path(directory)
        if args.plan or args.app_digest:
            policy = json.loads(Path('distribution/release-policy.json').read_text())
        else:
            manager = runpy.run_path('distribution/chattermost', run_name='lifecycle_download')
            (work / 'releases').mkdir(mode=0o700)
            policy = manager['fetch_release'](work, args.version)
        if args.plan:
            print(json.dumps(upgrade_sources(args.version, policy)))
            return
        report = Path(os.environ.get('CHATTERMOST_LIFECYCLE_REPORT', 'output/container-lifecycle-proof.json'))
        run_paths(args.version, policy, work, report, args.app_digest, args.migrator_digest)
        print('All declared published-baseline upgrade paths passed')


if __name__ == '__main__':
    main()
