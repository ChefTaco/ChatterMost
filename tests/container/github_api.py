"""Workflow-provided GitHub release metadata for release tests, with no token.

Every upgrade path reads release metadata from api.github.com many times.
Anonymous reads share a small hourly budget per runner address, and hosted
runners share addresses, so a release run can find that budget already spent.
The release workflow therefore fetches the metadata of each declared upgrade
source once, in its own step, and points CHATTERMOST_GITHUB_RELEASE_METADATA at
the directory of those responses. These tests then answer the manager's
releases/tags reads from that directory, including in manager commands the
tests start (see manager_command()), and refuse any other api.github.com read.
No token reaches the test process or anything it starts. Asset downloads and
registry pulls stay anonymous, the manager code is unchanged, and the public
verification workflow does not set the directory, so it still proves the
anonymous installation path.
"""
import email.message
import io
import os
from pathlib import Path
import re
import runpy
import sys
import urllib.error
import urllib.parse
import urllib.request
import urllib.response

METADATA_ENV = 'CHATTERMOST_GITHUB_RELEASE_METADATA'
API_HOST = 'api.github.com'
RELEASE_PATH = re.compile(r'/repos/ChefTaco/ChatterMost/releases/tags/(v0\.[0-9]+\.[0-9]+)')
# Credentials a release test never needs. They are removed before anything is
# started, so docker, compose, the application and the browser cannot see one.
CREDENTIAL_ENV = ('GITHUB_TOKEN', 'GH_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN',
                  'CHATTERMOST_GITHUB_API_TOKEN', 'ACTIONS_RUNTIME_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN')


class ProvidedReleaseMetadata(urllib.request.BaseHandler):
    handler_order = 400

    def __init__(self, directory):
        self.directory = Path(directory)

    def https_open(self, request):
        if request.host != API_HOST:
            return None
        url = request.full_url
        path = urllib.parse.urlsplit(url).path
        match = RELEASE_PATH.fullmatch(path)
        file = self.directory / f'{match.group(1)}.json' if match and request.get_method() == 'GET' else None
        if file is None or not file.is_file():
            # Fail closed: an unplanned read would spend the shared anonymous budget.
            raise urllib.error.URLError(f'GitHub API read not provided to this release test: {path}')
        headers = email.message.Message()
        headers['Content-Type'] = 'application/json'
        response = urllib.response.addinfourl(io.BytesIO(file.read_bytes()), headers, url, 200)
        response.msg = 'OK'
        return response


def scrub_credentials(environ=None):
    """Remove every GitHub credential from the environment that started processes inherit."""
    environ = os.environ if environ is None else environ
    for name in CREDENTIAL_ENV:
        environ.pop(name, None)
    return environ


def install(environ=None):
    """Drop inherited credentials; answer api.github.com release reads from provided metadata when set."""
    environ = scrub_credentials(environ)
    directory = environ.get(METADATA_ENV, '').strip()
    if not directory:
        return False
    urllib.request.install_opener(urllib.request.build_opener(ProvidedReleaseMetadata(directory)))
    return True


def manager_command(tool, environ=None):
    """The argv prefix that runs a manager CLI, reading the provided release metadata when set."""
    if not (os.environ if environ is None else environ).get(METADATA_ENV, '').strip():
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
