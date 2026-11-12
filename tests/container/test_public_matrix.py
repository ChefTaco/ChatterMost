"""Public verification cannot succeed with incomplete or non-public matrix proof."""
import copy
import hashlib
import io
import json
import runpy
import tarfile
import unittest
from unittest.mock import patch


class PublicMatrixTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = runpy.run_path('tests/container/public_matrix.py', run_name='matrix_test')

    def fixture(self):
        release = {'version': '0.4.5', 'upgrade_from': ['0.3.2', '0.4.4'],
                   'app_image': 'ghcr.io/cheftaco/chattermost@sha256:' + 'a' * 64,
                   'migrator_image': 'ghcr.io/cheftaco/chattermost-migrator@sha256:' + 'b' * 64}
        plan = self.module['plan_release']('0.4.5', release, 'sha256:' + 'c' * 64)
        fresh = [{'version': plan['version'], 'architecture': arch,
                  'anonymous_pull': True, 'fresh_install': True, 'restart_persistence': True,
                  'synthetic_http_files_bot_websocket': True,
                  'release_asset_digest': plan['archive_digest'], 'images': release}
                 for arch in plan['runners'].values()]
        paths = [{'baseline': row['baseline'], 'version': plan['version'],
                  'architecture': row['architecture'], 'execution': 'native',
                  'candidate_app_digest': None, 'candidate_migrator_digest': None,
                  'app_image': plan['app_image'], 'migrator_image': plan['migrator_image'],
                  'public_archive_cli': True, 'image_source': 'registry',
                  'browser_login_and_websocket': True,
                  'passed': sorted(self.module['POLICY']['REQUIRED_PROOFS'])}
                 for row in plan['matrix']['include']]
        jobs = {key: {'result': 'success'} for key in ['plan', 'install', 'lifecycle']}
        return plan, fresh, paths, jobs

    def test_complete_native_matrix_covers_every_declared_source(self):
        plan, fresh, paths, jobs = self.fixture()
        self.assertEqual(4, len(plan['matrix']['include']))
        self.assertEqual(paths, self.module['aggregate'](plan, fresh, paths, jobs)['paths'])

    def test_historical_policy_without_upgrade_sources_keeps_both_fresh_installs(self):
        _, fresh, _, jobs = self.fixture()
        release = {'version': '0.2.3', 'app_image': fresh[0]['images']['app_image']}
        plan = self.module['plan_release']('0.2.3', release, 'sha256:' + 'c' * 64)
        self.assertEqual([], plan['upgrade_from'])
        self.assertEqual([], plan['matrix']['include'])
        self.assertIsNone(plan['migrator_image'])
        for proof in fresh:
            proof['version'] = '0.2.3'
            proof['images'] = release
        jobs['lifecycle']['result'] = 'skipped'
        result = self.module['aggregate'](plan, fresh, [], jobs)
        self.assertEqual(2, len(result['fresh_installations']))
        with self.assertRaisesRegex(ValueError, 'requested version'):
            self.module['plan_release']('0.2.3', {**release, 'version': '0.2.2'}, plan['archive_digest'])
        with self.assertRaises(ValueError):
            self.module['plan_release']('0.4.5', {**release, 'version': '0.4.5'}, plan['archive_digest'])

    def test_historical_archive_is_integrity_checked_without_modern_policy_fields(self):
        stream = io.BytesIO()
        prefix = 'chattermost-0.2.3'
        release = {'version': '0.2.3', 'app_image': 'synthetic-app'}
        with tarfile.open(fileobj=stream, mode='w:gz') as tar:
            directory = tarfile.TarInfo(prefix)
            directory.type = tarfile.DIRTYPE
            tar.addfile(directory)
            for name in ['chattermost', 'compose.yaml', 'release.json', 'README.md', 'LICENSE', 'NOTICE']:
                data = json.dumps(release).encode() if name == 'release.json' else b'synthetic'
                member = tarfile.TarInfo(prefix + '/' + name)
                member.size = len(data)
                tar.addfile(member, io.BytesIO(data))
        archive = stream.getvalue()
        digest = 'sha256:' + hashlib.sha256(archive).hexdigest()
        metadata = {'tag_name': 'v0.2.3', 'assets': [{'name': prefix + '.tar.gz', 'digest': digest,
                    'browser_download_url': 'https://github.com/ChefTaco/ChatterMost/releases/download/v0.2.3/' + prefix + '.tar.gz'}]}
        with patch('urllib.request.urlopen', side_effect=[io.BytesIO(json.dumps(metadata).encode()), io.BytesIO(archive)]):
            policy, actual = self.module['download_release']('0.2.3')
        self.assertEqual(release, policy)
        self.assertEqual([], self.module['plan_release']('0.2.3', policy, actual)['upgrade_from'])
        with patch('urllib.request.urlopen', side_effect=[io.BytesIO(json.dumps(metadata).encode()), io.BytesIO(archive + b'tampered')]):
            with self.assertRaisesRegex(ValueError, 'integrity mismatch'):
                self.module['download_release']('0.2.3')

    def test_missing_duplicate_wrong_source_and_wrong_platform_fail(self):
        for change in ['missing', 'duplicate', 'source', 'platform']:
            with self.subTest(change=change):
                plan, fresh, paths, jobs = self.fixture()
                if change == 'missing': paths.pop()
                if change == 'duplicate': paths[-1] = copy.deepcopy(paths[0])
                if change == 'source': paths[0]['baseline'] = '0.4.2'
                if change == 'platform': paths[0]['architecture'] = 'emulated'
                with self.assertRaisesRegex(ValueError, 'coverage'):
                    self.module['aggregate'](plan, fresh, paths, jobs)

    def test_failed_skipped_or_missing_jobs_cannot_publish_success(self):
        for status in ['failure', 'skipped', 'cancelled', None]:
            with self.subTest(status=status):
                plan, fresh, paths, jobs = self.fixture()
                jobs['lifecycle']['result'] = status
                with self.assertRaisesRegex(ValueError, 'required verification job'):
                    self.module['aggregate'](plan, fresh, paths, jobs)

    def test_failed_browser_integrity_or_anonymous_claim_is_refused(self):
        for change in [{'passed': ['upgrade']}, {'browser_login_and_websocket': False},
                       {'public_archive_cli': False}, {'execution': 'emulated'},
                       {'app_image': 'unreviewed'}, {'operator_path': '/synthetic/private'}]:
            with self.subTest(change=change):
                plan, fresh, paths, jobs = self.fixture()
                paths[0].update(change)
                with self.assertRaisesRegex(ValueError, 'lifecycle proof'):
                    self.module['aggregate'](plan, fresh, paths, jobs)

    def test_fresh_install_must_cover_both_architectures_and_exact_archive(self):
        for change in ['missing', 'duplicate', 'archive', 'anonymous', 'private']:
            with self.subTest(change=change):
                plan, fresh, paths, jobs = self.fixture()
                if change == 'missing': fresh.pop()
                if change == 'duplicate': fresh[-1] = copy.deepcopy(fresh[0])
                if change == 'archive': fresh[0]['release_asset_digest'] = 'unreviewed'
                if change == 'anonymous': fresh[0]['anonymous_pull'] = False
                if change == 'private': fresh[0]['operator_path'] = '/synthetic/private'
                with self.assertRaises(ValueError):
                    self.module['aggregate'](plan, fresh, paths, jobs)

    def test_plan_cannot_weaken_the_native_platform_contract(self):
        plan, fresh, paths, jobs = self.fixture()
        plan['runners'] = {'ubuntu-24.04': 'x86_64'}
        with self.assertRaisesRegex(ValueError, 'platform contract'):
            self.module['aggregate'](plan, fresh, paths, jobs)
