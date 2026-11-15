"""Optional authentication for GitHub release metadata reads in release tests.

Every upgrade path reads release metadata from api.github.com several times.
Anonymous reads share a small hourly budget per runner address, and hosted
runners share addresses, so a release run can find that budget already spent.
When CHATTERMOST_GITHUB_API_TOKEN is set, these tests send it to api.github.com
only, including from manager commands the tests start (see manager_command()).
Asset downloads and registry pulls stay anonymous, the manager code is
unchanged, and the public verification workflow does not set the token, so it
still proves the anonymous installation path.
"""
import os
from pathlib import Path
import runpy
import sys
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


def manager_command(tool, environ=None):
    """The argv prefix that runs a manager CLI, with authenticated API reads when a token is set."""
    token = (os.environ if environ is None else environ).get(TOKEN_ENV, '').strip()
    if not token:
        return [str(tool)]
    return [sys.executable, str(Path(__file__).resolve()), str(tool)]


if __name__ == '__main__':
    # python3 github_api.py MANAGER ARGS...: run MANAGER as a program in this process.
    install()
    tool = sys.argv[1]
    sys.argv = sys.argv[1:]
    # As if MANAGER were run directly: its own directory first on the import path, not this one.
    sys.path[0] = str(Path(tool).resolve().parent)
    runpy.run_path(tool, run_name='__main__')
