"""Optional authentication for GitHub release metadata reads in release tests.

Every upgrade path reads release metadata from api.github.com several times.
Anonymous reads share a small hourly budget per runner address, so a release
with many declared upgrade sources can exhaust it part-way through. When
CHATTERMOST_GITHUB_API_TOKEN is set, these tests send it to api.github.com
only. Asset downloads, registry pulls and the installation manager itself stay
anonymous, and the public verification workflow does not set the token.
"""
import os
import urllib.request

TOKEN_ENV = 'CHATTERMOST_GITHUB_API_TOKEN'
API_HOST = 'api.github.com'


class GitHubApiAuth(urllib.request.BaseHandler):
    handler_order = 400

    def __init__(self, token):
        self.token = token

    def https_request(self, request):
        if request.host == API_HOST:
            request.add_unredirected_header('Authorization', f'Bearer {self.token}')
        return request


def install(environ=None):
    """Authenticate api.github.com reads in this process when a token is provided."""
    token = (os.environ if environ is None else environ).get(TOKEN_ENV, '').strip()
    if not token:
        return False
    urllib.request.install_opener(urllib.request.build_opener(GitHubApiAuth(token)))
    return True
