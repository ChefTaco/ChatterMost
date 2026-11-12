#!/usr/bin/env python3
"""Plan and aggregate anonymous native verification of immutable public releases."""
import argparse
import json
import os
from pathlib import Path
import runpy
import tempfile

POLICY = runpy.run_path(str(Path(__file__).with_name('lifecycle.py')), run_name='public_matrix_policy')
RUNNERS = {'ubuntu-24.04': 'x86_64', 'ubuntu-24.04-arm': 'aarch64'}


def plan_release(version, release, archive_digest):
    sources = POLICY['upgrade_sources'](version, release)
    if POLICY['version_tuple'](version) < (0, 3, 0):
        sources = []  # Historical 0.2 releases have fresh-install verification only.
    return {
        'version': version, 'upgrade_from': sources, 'runners': RUNNERS,
        'app_image': release['app_image'], 'migrator_image': release['migrator_image'],
        'archive_digest': archive_digest,
        'matrix': {'include': [
            {'runner': runner, 'architecture': architecture, 'baseline': baseline}
            for runner, architecture in RUNNERS.items() for baseline in sources
        ]},
    }


def aggregate(plan, fresh, paths, jobs):
    if plan['runners'] != RUNNERS:
        raise ValueError('Unexpected native platform contract')
    POLICY['upgrade_sources'](plan['version'], plan)
    expected_results = {'plan': 'success', 'install': 'success',
                        'lifecycle': 'success' if plan['upgrade_from'] else 'skipped'}
    if {name: jobs.get(name, {}).get('result') for name in expected_results} != expected_results:
        raise ValueError('Missing, failed or skipped required verification job')
    expected_arches = set(plan['runners'].values())
    if len(fresh) != len(expected_arches) or {p.get('architecture') for p in fresh} != expected_arches:
        raise ValueError('Missing or duplicate native fresh-install platform')
    for proof in fresh:
        if (not set(proof).issubset({'version', 'architecture', 'anonymous_pull', 'fresh_install',
                                    'restart_persistence', 'synthetic_http_files_bot_websocket',
                                    'release_asset_digest', 'images'})
                or proof.get('version') != plan['version']
                or any(proof.get(key) is not True for key in (
                    'anonymous_pull', 'fresh_install', 'restart_persistence', 'synthetic_http_files_bot_websocket'))
                or proof.get('release_asset_digest') != plan['archive_digest']
                or any(proof.get('images', {}).get(key) != plan[key] for key in ('app_image', 'migrator_image'))):
            raise ValueError('Fresh-install proof differs from the published release')
    expected = {(source, arch) for source in plan['upgrade_from'] for arch in expected_arches}
    observed = {(p.get('baseline'), p.get('architecture')) for p in paths}
    if len(paths) != len(expected) or observed != expected:
        raise ValueError('Missing, duplicate or wrong-source/platform lifecycle coverage')
    for proof in paths:
        if (proof.get('version') != plan['version'] or proof.get('execution') != 'native'
                or proof.get('candidate_app_digest') is not None or proof.get('candidate_migrator_digest') is not None
                or proof.get('public_archive_cli') is not True or proof.get('image_source') != 'registry'
                or proof.get('browser_login_and_websocket') is not True
                or not isinstance(proof.get('passed'), list)
                or not POLICY['REQUIRED_PROOFS'].issubset(proof['passed'])
                or not set(proof).issubset(POLICY['PUBLIC_FIELDS'])
                or any(proof.get(key) != plan[key] for key in ('app_image', 'migrator_image'))):
            raise ValueError('Failed or mismatched anonymous native lifecycle proof')
    return {'version': plan['version'], 'upgrade_from': plan['upgrade_from'],
            'fresh_installations': fresh, 'paths': paths}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    create = sub.add_parser('plan')
    create.add_argument('version')
    create.add_argument('--output', type=Path, required=True)
    collect = sub.add_parser('aggregate')
    collect.add_argument('--plan', type=Path, required=True)
    collect.add_argument('--proofs', type=Path, required=True)
    collect.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    args.output.unlink(missing_ok=True)
    if args.command == 'plan':
        POLICY['version_tuple'](args.version)
        manager = runpy.run_path('distribution/chattermost', run_name='anonymous_matrix_plan')
        with tempfile.TemporaryDirectory(prefix='chattermost-public-plan-') as temporary:
            root = Path(temporary)
            (root / 'releases').mkdir(mode=0o700)
            release = manager['fetch_release'](root, args.version)
            receipt = json.loads((root / 'releases' / args.version / '.verified.json').read_text())
            result = plan_release(args.version, release, receipt['asset_digest'])
        if os.environ.get('GITHUB_OUTPUT'):
            with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
                output.write('matrix=' + json.dumps(result['matrix']) + '\n')
                output.write('has_paths=' + str(bool(result['upgrade_from'])).lower() + '\n')
    else:
        result = aggregate(json.loads(args.plan.read_text()),
                           [json.loads(p.read_text()) for p in args.proofs.rglob('public-verification.json')],
                           [json.loads(p.read_text()) for p in args.proofs.rglob('lifecycle-path.json')],
                           json.loads(os.environ['PUBLIC_JOB_RESULTS']))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n')


if __name__ == '__main__':
    main()
