from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import urllib.request

import github_api


class GitHubApiAuthTest(unittest.TestCase):
    def tearDown(self):
        urllib.request.install_opener(None)

    def test_without_token_nothing_is_installed(self):
        self.assertFalse(github_api.install({}))
        self.assertFalse(github_api.install({github_api.TOKEN_ENV: '  '}))

    def test_token_is_sent_to_the_api_host_only(self):
        handler = github_api.GitHubApiAuth('example-token')
        api = handler.https_request(urllib.request.Request('https://api.github.com/repos/o/r/releases/tags/v1.0.0'))
        self.assertEqual(api.unredirected_hdrs.get('Authorization'), 'Bearer example-token')
        for url in ('https://github.com/o/r/releases/download/v1.0.0/a.tar.gz',
                    'https://objects.githubusercontent.com/a', 'https://ghcr.io/v2/'):
            other = handler.https_request(urllib.request.Request(url))
            self.assertNotIn('Authorization', other.unredirected_hdrs)
            self.assertNotIn('Authorization', other.headers)

    def test_install_uses_the_token(self):
        self.assertTrue(github_api.install({github_api.TOKEN_ENV: 'example-token'}))

    def test_manager_command_is_the_tool_itself_without_a_token(self):
        self.assertEqual(github_api.manager_command('/opt/release/chattermost', {}), ['/opt/release/chattermost'])
        self.assertEqual(github_api.manager_command('/opt/release/chattermost', {github_api.TOKEN_ENV: ' '}), ['/opt/release/chattermost'])

    def test_manager_command_runs_the_tool_as_a_program_with_authenticated_api_reads(self):
        with tempfile.TemporaryDirectory() as directory:
            tool = Path(directory) / 'chattermost'
            tool.write_text(
                'import sys, urllib.request\n'
                'if __name__ == "__main__":\n'
                '    handlers = [type(h).__name__ for h in (urllib.request._opener.handlers if urllib.request._opener else [])]\n'
                '    print(" ".join(sys.argv[1:]), __file__ == sys.argv[0], "GitHubApiAuth" in handlers)\n'
                '    sys.exit(3)\n'
            )
            environ = {github_api.TOKEN_ENV: 'example-token'}
            command = github_api.manager_command(tool, environ)
            self.assertEqual(command[0], sys.executable)
            result = subprocess.run([*command, '--directory', '/srv/x', 'backup'], env=environ, capture_output=True, text=True)
            self.assertEqual(result.returncode, 3)
            self.assertEqual(result.stdout.strip(), '--directory /srv/x backup True True')


if __name__ == '__main__':
    unittest.main()
