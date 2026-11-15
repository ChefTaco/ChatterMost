import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import urllib.error
import urllib.request

import github_api

SECRET = 'example-credential-value'
CREDENTIALS = {name: SECRET for name in github_api.CREDENTIAL_ENV}
RELEASE_URL = 'https://api.github.com/repos/ChefTaco/ChatterMost/releases/tags/v0.3.2'
# A started program reports its argv and whether any credential reached its
# environment, then starts a grandchild (as docker, compose or the browser
# would be started) that reports the same.
PROBE = (
    'import json, os, subprocess, sys\n'
    'names = json.loads(os.environ["PROBE_NAMES"])\n'
    'def seen(): return [n for n in names if n in os.environ]\n'
    'child = subprocess.run([sys.executable, "-c", "import json, os, sys; names = json.loads(os.environ[\\"PROBE_NAMES\\"]); print(json.dumps({\\"argv\\": sys.argv, \\"seen\\": [n for n in names if n in os.environ]}))", "grandchild"], check=True, stdout=subprocess.PIPE, text=True)\n'
    'print(json.dumps({"argv": sys.argv, "seen": seen(), "child": json.loads(child.stdout)}))\n'
)


class ProvidedReleaseMetadataTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        (self.root / 'v0.3.2.json').write_text(json.dumps({'tag_name': 'v0.3.2', 'assets': []}))

    def tearDown(self):
        urllib.request.install_opener(None)
        self.directory.cleanup()

    def test_without_metadata_nothing_is_installed(self):
        self.assertFalse(github_api.install({}))
        self.assertFalse(github_api.install({github_api.METADATA_ENV: '  '}))

    def test_release_reads_are_answered_from_the_provided_metadata(self):
        self.assertTrue(github_api.install({github_api.METADATA_ENV: str(self.root)}))
        request = urllib.request.Request(RELEASE_URL, headers={'User-Agent': 'ChatterMost-installation-manager'})
        with urllib.request.urlopen(request, timeout=30) as response:
            self.assertEqual(json.load(response)['tag_name'], 'v0.3.2')
            self.assertEqual(response.status, 200)

    def test_unplanned_api_reads_fail_closed(self):
        handler = github_api.ProvidedReleaseMetadata(self.root)
        for url in (RELEASE_URL.replace('v0.3.2', 'v0.3.3'),
                    'https://api.github.com/repos/ChefTaco/ChatterMost/releases/latest',
                    'https://api.github.com/repos/other/repo/releases/tags/v0.3.2',
                    'https://api.github.com/repos/ChefTaco/ChatterMost/releases/tags/v0.3.2/../../x'):
            with self.subTest(url=url), self.assertRaises(urllib.error.URLError):
                handler.https_open(urllib.request.Request(url))
        with self.assertRaises(urllib.error.URLError):
            handler.https_open(urllib.request.Request(RELEASE_URL, data=b'{}', method='POST'))

    def test_other_hosts_are_left_to_the_network(self):
        handler = github_api.ProvidedReleaseMetadata(self.root)
        for url in ('https://github.com/ChefTaco/ChatterMost/releases/download/v0.3.2/a.tar.gz',
                    'https://objects.githubusercontent.com/a', 'https://ghcr.io/v2/'):
            self.assertIsNone(handler.https_open(urllib.request.Request(url)))

    def test_manager_command_is_the_tool_itself_without_metadata(self):
        self.assertEqual(github_api.manager_command('/opt/release/chattermost', {}), ['/opt/release/chattermost'])
        self.assertEqual(github_api.manager_command('/opt/release/chattermost', {github_api.METADATA_ENV: ' '}), ['/opt/release/chattermost'])

    def test_manager_command_runs_the_tool_as_a_program_with_provided_metadata(self):
        tool = self.root / 'chattermost'
        tool.write_text(
            'import json, sys, urllib.request\n'
            'if __name__ == "__main__":\n'
            '    with urllib.request.urlopen(sys.argv[-1], timeout=30) as response:\n'
            '        tag = json.load(response)["tag_name"]\n'
            '    print(" ".join(sys.argv[1:-1]), __file__ == sys.argv[0], tag)\n'
            '    sys.exit(3)\n'
        )
        environ = {**os.environ, github_api.METADATA_ENV: str(self.root)}
        command = github_api.manager_command(tool, environ)
        self.assertEqual(command[0], sys.executable)
        result = subprocess.run([*command, '--directory', '/srv/x', 'backup', RELEASE_URL], env=environ, capture_output=True, text=True)
        self.assertEqual(result.returncode, 3, result.stderr)
        self.assertEqual(result.stdout.strip(), '--directory /srv/x backup True v0.3.2')


class CredentialIsolationTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.probe = self.root / 'probe'
        self.probe.write_text(PROBE)

    def tearDown(self):
        urllib.request.install_opener(None)
        self.directory.cleanup()

    def assert_no_credential(self, report):
        self.assertEqual(report['seen'], [])
        self.assertNotIn(SECRET, json.dumps(report['argv']))
        if 'child' in report:
            self.assert_no_credential(report['child'])

    def test_install_removes_every_credential(self):
        environ = {**CREDENTIALS, 'PATH': '/usr/bin', github_api.METADATA_ENV: str(self.root)}
        self.assertTrue(github_api.install(environ))
        self.assertEqual(environ, {'PATH': '/usr/bin', github_api.METADATA_ENV: str(self.root)})

    def test_processes_started_after_install_inherit_no_credential(self):
        names = json.dumps(sorted(CREDENTIALS))
        with mock.patch.dict(os.environ, {**CREDENTIALS, 'PROBE_NAMES': names, github_api.METADATA_ENV: str(self.root)}):
            github_api.install()
            # As docker, compose, the application and the browser are started.
            plain = subprocess.run([sys.executable, str(self.probe)], check=True, stdout=subprocess.PIPE, text=True)
            browser = subprocess.run([sys.executable, str(self.probe)], env={**os.environ, 'EXTRA': '1'}, check=True, stdout=subprocess.PIPE, text=True)
            # The wrapped manager command.
            command = [*github_api.manager_command(self.probe), '--directory', str(self.root), 'backup']
            manager = subprocess.run(command, check=True, stdout=subprocess.PIPE, text=True)
        self.assertNotIn(SECRET, json.dumps(command))
        for result in (plain, browser, manager):
            self.assert_no_credential(json.loads(result.stdout))

    def test_wrapped_manager_drops_a_credential_it_was_handed(self):
        # Even a caller that did not scrub cannot pass one on to the manager or what it starts.
        environ = {**os.environ, **CREDENTIALS, 'PROBE_NAMES': json.dumps(sorted(CREDENTIALS)), github_api.METADATA_ENV: str(self.root)}
        command = [*github_api.manager_command(self.probe, environ), 'backup']
        result = subprocess.run(command, env=environ, check=True, stdout=subprocess.PIPE, text=True)
        self.assertNotIn(SECRET, json.dumps(command))
        self.assert_no_credential(json.loads(result.stdout))


if __name__ == '__main__':
    unittest.main()
