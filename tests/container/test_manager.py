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
        subprocess.run(['python3', 'distribution/package.py', '0.3.0', 'sha256:' + '0' * 64, 'sha256:' + '1' * 64, str(cls.work / 'bundle')], check=True, stdout=subprocess.DEVNULL)
        cls.package = cls.work / 'bundle/chattermost-0.3.0'
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
        archive = (self.work / 'bundle/chattermost-0.3.0.tar.gz').read_bytes()
        asset = {'name': 'chattermost-0.3.0.tar.gz', 'digest': 'sha256:' + hashlib.sha256(archive).hexdigest(), 'browser_download_url': 'https://github.com/ChefTaco/ChatterMost/releases/download/v0.3.0/chattermost-0.3.0.tar.gz'}
        release = json.dumps({'tag_name': 'v0.3.0', 'assets': [asset]}).encode()
        with patch('urllib.request.urlopen', side_effect=[io.BytesIO(release), io.BytesIO(archive)]):
            self.module['fetch_release'](root, '0.3.0')
        (root / 'releases/0.3.0/compose.yaml').write_text('tampered')
        with self.assertRaisesRegex(RuntimeError, 'integrity mismatch'):
            self.module['cached_release'](root, '0.3.0')
        with patch('urllib.request.urlopen', side_effect=[io.BytesIO(release), io.BytesIO(archive + b'tampered')]):
            with self.assertRaisesRegex(RuntimeError, 'archive integrity mismatch'):
                self.module['fetch_release'](root, '0.3.0')

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
