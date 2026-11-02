"""Release coverage must match the declared paths before artifacts can publish."""
import json
import os
from pathlib import Path
import runpy
import subprocess
import tempfile
import unittest
from unittest.mock import patch


class LifecycleCoverageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = runpy.run_path('tests/container/lifecycle.py', run_name='lifecycle_plan_test')

    def test_next_release_requires_published_032_even_when_legacy_path_is_present(self):
        for sources in ([], ['0.2.3']):
            with self.subTest(sources=sources):
                with self.assertRaisesRegex(ValueError, 'upgrades from 0.3.2'):
                    self.module['upgrade_sources']('0.3.3', {'version': '0.3.3', 'upgrade_from': sources})
        self.assertEqual(['0.3.2'], self.module['upgrade_sources']('0.3.3', {'version': '0.3.3', 'upgrade_from': ['0.3.2']}))

    def test_existing_public_release_keeps_its_historical_path(self):
        self.assertEqual(['0.2.3'], self.module['upgrade_sources']('0.3.2', {'version': '0.3.2', 'upgrade_from': ['0.2.3']}))

    def test_checked_in_policy_matches_package_and_required_baseline(self):
        version = json.loads(Path('package.json').read_text())['version']
        policy = json.loads(Path('distribution/release-policy.json').read_text())
        self.module['upgrade_sources'](version, policy)

    def test_invalid_same_version_and_duplicate_paths_are_refused(self):
        policies = [
            {'version': '0.3.4', 'upgrade_from': ['0.3.2']},
            {'version': '0.3.3', 'upgrade_from': ['0.3.3', '0.3.2']},
            {'version': '0.3.3', 'upgrade_from': ['0.3.4', '0.3.2']},
            {'version': '0.3.3', 'upgrade_from': ['0.3.2', '0.3.2']},
            {'version': '0.3.3', 'upgrade_from': ['latest', '0.3.2']},
            {'version': '0.3.3', 'upgrade_from': '0.3.2'},
        ]
        for policy in policies:
            with self.subTest(policy=policy):
                with self.assertRaises(ValueError):
                    self.module['upgrade_sources']('0.3.3', policy)

    def proof(self, source):
        return {
            'baseline': source, 'version': '0.3.3',
            'architecture': os.uname().machine, 'execution': 'native',
            'candidate_app_digest': None, 'candidate_migrator_digest': None,
            'public_archive_cli': True, 'browser_login_and_websocket': True,
            'passed': sorted(self.module['REQUIRED_PROOFS']),
        }

    def test_every_supported_source_runs_and_is_bound_into_the_public_report(self):
        observed = []

        def execute(command, **kwargs):
            source = command[-1]
            observed.append(source)
            Path(kwargs['env']['CHATTERMOST_LIFECYCLE_REPORT']).write_text(json.dumps(self.proof(source)))

        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            report = work / 'aggregate.json'
            sources = ['0.2.3', '0.3.2']
            with patch('subprocess.run', side_effect=execute):
                self.module['run_paths']('0.3.3', {'version': '0.3.3', 'upgrade_from': sources}, work, report)
            result = json.loads(report.read_text())
            self.assertEqual(sources, observed)
            self.assertEqual(sources, result['upgrade_from'])
            self.assertEqual(sources, [proof['baseline'] for proof in result['paths']])

    def test_failed_path_does_not_leave_a_success_report(self):
        observed = []

        def execute(command, **kwargs):
            source = command[-1]
            observed.append(source)
            if source == '0.3.2':
                raise subprocess.CalledProcessError(1, command)
            Path(kwargs['env']['CHATTERMOST_LIFECYCLE_REPORT']).write_text(json.dumps(self.proof(source)))

        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            report = work / 'aggregate.json'
            report.write_text('stale success')
            with patch('subprocess.run', side_effect=execute):
                with self.assertRaises(subprocess.CalledProcessError):
                    self.module['run_paths']('0.3.3', {'version': '0.3.3', 'upgrade_from': ['0.2.3', '0.3.2']}, work, report)
            self.assertEqual(['0.2.3', '0.3.2'], observed)
            self.assertFalse(report.exists())

    def test_missing_preservation_wrong_source_and_private_report_fields_fail_closed(self):
        for change in ({'passed': ['upgrade']}, {'baseline': '0.2.3'}, {'operator_path': '/synthetic/private'}, {'browser_login_and_websocket': False}):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                work = Path(directory)
                report = work / 'aggregate.json'

                def execute(command, **kwargs):
                    proof = {**self.proof('0.3.2'), **change}
                    Path(kwargs['env']['CHATTERMOST_LIFECYCLE_REPORT']).write_text(json.dumps(proof))

                with patch.dict(os.environ, {'CHATTERMOST_LIFECYCLE_BROWSER': 'true'}), patch('subprocess.run', side_effect=execute):
                    with self.assertRaises(ValueError):
                        self.module['run_paths']('0.3.3', {'version': '0.3.3', 'upgrade_from': ['0.3.2']}, work, report)
                self.assertFalse(report.exists())
