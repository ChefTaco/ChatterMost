"""Public verification cannot succeed with incomplete or non-public matrix proof."""
import copy
import runpy
import unittest


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
