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


if __name__ == '__main__':
    unittest.main()
