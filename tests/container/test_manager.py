"""Fail-closed release and recovery boundaries for the standalone manager."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import tempfile
import tarfile
import unittest
from unittest.mock import patch


class ManagerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.work = Path(tempfile.mkdtemp(prefix='chattermost-manager-unit-'))
        cls.version = json.loads(Path('package.json').read_text())['version']
        subprocess.run(['python3', 'distribution/package.py', cls.version, 'sha256:' + '0' * 64, 'sha256:' + '1' * 64, str(cls.work / 'bundle')], check=True, stdout=subprocess.DEVNULL)
        cls.package = cls.work / 'bundle' / f'chattermost-{cls.version}'
        cls.module = runpy.run_path(str(cls.package / 'chattermost'), run_name='manager_test')

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.work)

    def install(self, name):
        root = self.work / name
        old = os.umask(0o077)
        try:
            self.module['setup'](argparse.Namespace(directory=root, server_url='http://127.0.0.1:18065', port=18065, bind='127.0.0.1', redis=False, trusted_proxies=''))
        finally:
            os.umask(old)
        return root

    def test_setup_generates_unique_credentials_and_refuses_existing_directory(self):
        one, two = self.install('one'), self.install('two')
        self.assertNotEqual((one / 'secrets/runtime.env').read_bytes(), (two / 'secrets/runtime.env').read_bytes())
        password = (one / 'secrets/postgres_password').read_bytes()
        with self.assertRaisesRegex(RuntimeError, 'already exists'):
            self.module['setup'](argparse.Namespace(directory=one))
        self.assertEqual(password, (one / 'secrets/postgres_password').read_bytes())
        self.assertEqual((one / 'secrets/runtime.env').stat().st_mode & 0o777, 0o600)
        self.assertEqual((one / 'releases' / self.version).stat().st_mode & 0o777, 0o700)

    def test_private_write_protects_directory_and_temporary_file(self):
        root = self.install('private-write')
        target = root / 'secrets' / 'test-secret'
        original_replace = os.replace
        observed_modes = []

        def inspect_replace(source, destination):
            observed_modes.append(Path(source).stat().st_mode & 0o777)
            original_replace(source, destination)

        old = os.umask(0)
        try:
            with patch('os.replace', side_effect=inspect_replace):
                self.module['private_write'](target, 'synthetic secret')
        finally:
            os.umask(old)
        self.assertEqual(observed_modes, [0o600])
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)

        (root / 'secrets').chmod(0o755)
        with self.assertRaisesRegex(RuntimeError, 'Protected directory'):
            self.module['private_write'](target, 'replacement')
        self.assertEqual(target.read_text(), 'synthetic secret')
        (root / 'secrets').chmod(0o700)
        (root / 'linked-secrets').symlink_to(root / 'secrets', target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, 'Protected directory'):
            self.module['private_write'](root / 'linked-secrets' / 'test-secret', 'replacement')

    def test_exposed_or_linked_secret_file_is_refused(self):
        root = self.install('permissions')
        file = root / 'secrets/runtime.env'
        file.chmod(0o640)
        with self.assertRaisesRegex(RuntimeError, 'Protected file'):
            self.module['check_private'](file)
        file.chmod(0o600)
        link = root / 'linked-secret'
        link.symlink_to(file)
        with self.assertRaises(RuntimeError):
            self.module['check_private'](link)

    def test_rollback_requires_generation_and_ancestry_proof(self):
        release = self.module['metadata'](self.package)
        schema = self.module['schema_record'](release)
        self.assertTrue(self.module['compatible'](release, schema))
        self.assertFalse(self.module['compatible'](release, {**schema, 'schema_generation': 2}))
        self.assertFalse(self.module['compatible'](release, {**schema, 'lineage_ancestry': ['f' * 64]}))

    def test_release_hash_and_cached_bytes_are_both_checked(self):
        root = self.install('integrity')
        archive = (self.work / 'bundle' / f'chattermost-{self.version}.tar.gz').read_bytes()
        asset = {'name': f'chattermost-{self.version}.tar.gz', 'digest': 'sha256:' + hashlib.sha256(archive).hexdigest(), 'browser_download_url': f'https://github.com/ChefTaco/ChatterMost/releases/download/v{self.version}/chattermost-{self.version}.tar.gz'}
        release = json.dumps({'tag_name': f'v{self.version}', 'assets': [asset]}).encode()
        with patch('urllib.request.urlopen', side_effect=[io.BytesIO(release), io.BytesIO(archive)]):
            self.module['fetch_release'](root, self.version)
        installed = root / 'releases' / self.version
        self.assertEqual(installed.stat().st_mode & 0o777, 0o700)
        installed.chmod(0o755)
        with patch('urllib.request.urlopen', side_effect=[io.BytesIO(release), io.BytesIO(archive)]):
            self.module['fetch_release'](root, self.version)
        self.assertEqual(installed.stat().st_mode & 0o777, 0o700)
        (root / 'releases' / self.version / 'compose.yaml').write_text('tampered')
        with self.assertRaisesRegex(RuntimeError, 'integrity mismatch'):
            self.module['cached_release'](root, self.version)
        with patch('urllib.request.urlopen', side_effect=[io.BytesIO(release), io.BytesIO(archive + b'tampered')]):
            with self.assertRaisesRegex(RuntimeError, 'archive integrity mismatch'):
                self.module['fetch_release'](root, self.version)

    def test_backup_rejects_unhashed_secret_files(self):
        root = self.install('backup-boundary')
        source = self.work / 'backup-fixture'
        source.mkdir(mode=0o700)
        (source / 'secrets').mkdir(mode=0o700)
        for name in ('installation.json', 'state.json', 'secrets/runtime.env', 'secrets/postgres_password'):
            self.module['private_write'](source / name, (root / name).read_text())
        self.module['private_write'](source / 'database.dump', 'synthetic dump fixture')
        with tarfile.open(source / 'files.tar.gz', 'w:gz'):
            pass
        (source / 'files.tar.gz').chmod(0o600)
        self.module['private_write'](source / 'backup.json', {
            'backup_format': 1, 'recoverable': True, 'clean_shutdown': True,
            'project': json.loads((root / 'installation.json').read_text())['project'],
            'postgres_major': 16, 'files': self.module['hashes'](source)
        })
        self.module['verify_backup'](root, source)
        self.module['private_write'](source / 'secrets/unhashed', 'synthetic injected value')
        with self.assertRaisesRegex(RuntimeError, 'inventory'):
            self.module['verify_backup'](root, source)

    def test_mutable_versions_and_pending_start_are_refused(self):
        root = self.install('blocked')
        with self.assertRaisesRegex(RuntimeError, 'explicit supported'):
            self.module['fetch_release'](root, 'latest')
        self.module['private_write'](root / 'pending.json', {'kind': 'upgrade'})
        with self.assertRaisesRegex(RuntimeError, 'Recovery is pending'):
            self.module['assert_unblocked'](root)
