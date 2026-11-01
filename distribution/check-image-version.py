#!/usr/bin/env python3
"""Refuse reuse of a GHCR version; unknown registry states fail closed."""
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

version = sys.argv[1]
for name in ('chattermost', 'chattermost-migrator'):
    query = urllib.parse.urlencode({'scope': f'repository:cheftaco/{name}:pull', 'service': 'ghcr.io'})
    with urllib.request.urlopen('https://ghcr.io/token?' + query, timeout=30) as response:
        token = json.load(response)['token']
    request = urllib.request.Request(f'https://ghcr.io/v2/cheftaco/{name}/manifests/{version}', method='HEAD', headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json'})
    try:
        with urllib.request.urlopen(request, timeout=30):
            raise SystemExit('Image version already exists; choose a new immutable version')
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise SystemExit('Cannot prove image version is unused; registry check failed') from None
print('Both immutable image versions are unused')
