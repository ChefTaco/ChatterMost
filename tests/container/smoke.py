#!/usr/bin/env python3
"""Synthetic installation proof: real HTTP, files, bot auth, WebSocket delivery."""
import base64
import hashlib
import json
from pathlib import Path
import socket
import struct
import sys
import urllib.request
from urllib.parse import urlparse

root = Path(sys.argv[1])
mode = sys.argv[2]
config = json.loads((root / 'installation.json').read_text())
values = dict((k, json.loads(v)) for k, v in (line.split('=', 1) for line in (root / 'secrets/runtime.env').read_text().splitlines()))
base = f'http://127.0.0.1:{config["port"]}'


def request(method, route, data=None, token=None, raw=None, content_type=None):
    headers = {'Origin': config['server_url']}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    if data is not None:
        raw = json.dumps(data).encode()
        headers['Content-Type'] = 'application/json'
    if content_type:
        headers['Content-Type'] = content_type
    response = urllib.request.urlopen(urllib.request.Request(base + route, data=raw, headers=headers, method=method), timeout=15)
    body = response.read()
    return (json.loads(body) if 'application/json' in response.headers.get('content-type', '') else body), response.headers


def multipart(route, fields, name, filename, payload, mime, token):
    boundary = 'ChatterMostSyntheticBoundary'
    body = b''
    for key, value in fields.items():
        body += f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode()
    body += f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{filename}"\r\nContent-Type: {mime}\r\n\r\n'.encode() + payload + f'\r\n--{boundary}--\r\n'.encode()
    return request('POST', route, token=token, raw=body, content_type=f'multipart/form-data; boundary={boundary}')[0]


def receive(sock):
    def exact(n):
        data = b''
        while len(data) < n:
            part = sock.recv(n - len(data))
            if not part:
                raise RuntimeError('WebSocket closed prematurely')
            data += part
        return data
    header = exact(2)
    size = header[1] & 127
    if size == 126:
        size = struct.unpack('!H', exact(2))[0]
    if size == 127:
        size = struct.unpack('!Q', exact(8))[0]
    return json.loads(exact(size))


me, headers = request('POST', '/api/v4/users/login', {'login_id': values['ADMIN_USERNAME'], 'password': values['ADMIN_PASSWORD']})
token = headers['token']
fixture_file = root / 'synthetic-fixture.json'
if mode == 'seed':
    teams, _ = request('GET', '/api/v4/users/me/teams', token=token)
    channels, _ = request('GET', f'/api/v4/users/me/teams/{teams[0]["id"]}/channels', token=token)
    channel = channels[0]['id']
    upload = multipart('/api/v4/files', {'channel_id': channel}, 'files', 'synthetic.txt', b'synthetic attachment recovery proof\n', 'text/plain', token)
    file_id = upload['file_infos'][0]['id']
    post, _ = request('POST', '/api/v4/posts', {'channel_id': channel, 'message': 'Synthetic distribution persistence proof', 'file_ids': [file_id]}, token)
    image = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=')
    multipart(f'/api/v4/users/{me["id"]}/image', {}, 'image', 'avatar.png', image, 'image/png', token)
    fixture = {'admin_id': me['id'], 'post_id': post['id'], 'file_id': file_id, 'channel_id': channel, 'profile_sha': hashlib.sha256(image).hexdigest()}
    fixture_file.write_text(json.dumps(fixture))
    fixture_file.chmod(0o600)
fixture = json.loads(fixture_file.read_text())
assert fixture['admin_id'] == me['id']
post, _ = request('GET', '/api/v4/posts/' + fixture['post_id'], token=token)
assert post['message'] == 'Synthetic distribution persistence proof'
assert post['delete_at'] == 0
assert fixture['file_id'] in post['file_ids']
content, _ = request('GET', '/api/v4/files/' + fixture['file_id'], token=token)
assert content == b'synthetic attachment recovery proof\n'
content, _ = request('GET', f'/api/v4/users/{me["id"]}/image', token=token)
assert hashlib.sha256(content).hexdigest() == fixture['profile_sha']
bot, _ = request('GET', '/api/v4/users/me', token=values['HERMES_BOT_TOKEN'])
assert bot['is_bot']
# The bot can authenticate, and the administrator receives its own persisted
# post over a real WebSocket. Tokens remain in memory and private fixtures.
parsed = urlparse(base)
with socket.create_connection((parsed.hostname, parsed.port), timeout=15) as sock:
    sock.settimeout(15)
    key = base64.b64encode(b'0123456789abcdef').decode()
    sock.sendall((f'GET /api/v4/websocket HTTP/1.1\r\nHost: {parsed.netloc}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nAuthorization: Bearer {token}\r\n\r\n').encode())
    response = b''
    while not response.endswith(b'\r\n\r\n'):
        response += sock.recv(1)
    assert response.startswith(b'HTTP/1.1 101')
    assert receive(sock)['event'] == 'hello'
    posted, _ = request('POST', '/api/v4/posts', {'channel_id': fixture['channel_id'], 'message': 'Synthetic WebSocket delivery proof'}, token)
    for _ in range(30):
        event = receive(sock)
        if event.get('event') == 'posted' and json.loads(event['data']['post'])['id'] == posted['id']:
            break
    else:
        raise RuntimeError('Posted event was not delivered')
print('Synthetic accounts, bot auth, messages, attachments, profile image and WebSocket delivery: passed')
