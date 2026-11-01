import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const scanner = path.resolve('scripts/check-privacy.mjs');

function fixture(run) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'chattermost-privacy-'));
  const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  const write = (file, content) => {
    mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    writeFileSync(path.join(cwd, file), content);
  };
  const scan = () => spawnSync(process.execPath, [scanner], { cwd, encoding: 'utf8' });
  try {
    git('init', '--quiet');
    run({ cwd, git, write, scan });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('allows reserved examples and synthetic fixture networks', () => fixture(({ git, write, scan }) => {
  write('.env.example', 'ADMIN_EMAIL=admin@example.test\nCHAT_SERVER_URL=https://chat.example.test\n');
  write('tests/network.json', JSON.stringify({ address: '10.0.0.1' }));
  git('add', '.env.example', 'tests/network.json');
  assert.equal(scan().status, 0);
}));

test('rejects force-added ignored credentials and trust pins without printing values', () => fixture(({ git, write, scan }) => {
  const secret = 'synthetic-private-' + 'value-for-test';
  write('.gitignore', '.env\ndeploy/ssh_known_hosts\n');
  write('.env', `COOKIE_SECRET=${secret}\n`);
  write('deploy/ssh_known_hosts', 'synthetic-host ssh-ed25519 test-pin\n');
  git('add', '.gitignore');
  git('add', '-f', '.env', 'deploy/ssh_known_hosts');
  const result = scan();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /private environment file/u);
  assert.match(result.stderr, /private or generated artifact/u);
  assert.ok(!result.stderr.includes(secret));
}));

test('checks staged bytes even when a working file has been cleaned', () => fixture(({ git, write, scan }) => {
  const domain = ['node', 'private-tailnet', 'ts', 'net'].join('.');
  write('README.md', `https://${domain}\n`);
  git('add', 'README.md');
  write('README.md', 'https://chat.example.test\n');
  const result = scan();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /private endpoint/u);
  assert.ok(!result.stderr.includes(domain));
}));

test('detects local secrets copied to otherwise innocuous paths', () => fixture(({ git, write, scan }) => {
  const secret = 'synthetic-cookie-' + 'unique-private-value';
  write('.env', `COOKIE_SECRET=${secret}\n`);
  write('notes.md', `setting: ${secret}\n`);
  git('add', 'notes.md');
  assert.match(scan().stderr, /private local configuration value/u);
}));

test('rejects personal identities, private networks, keys, tokens, and binary dumps', () => fixture(({ git, write, scan }) => {
  write('contact.md', ['person', '@', 'personal-mail', '.', 'org'].join(''));
  write('paths.md', ['/home/', 'private-operator', '/project'].join(''));
  write('network.md', '192.168.1.42');
  write('notes.md', ['-----BEGIN ', 'PRIVATE KEY-----'].join(''));
  write('token.md', ['ghp_', 'A'.repeat(36)].join(''));
  write('archive.db', Buffer.from([0, 1, 2]));
  git('add', 'contact.md', 'paths.md', 'network.md', 'notes.md', 'token.md', 'archive.db');
  const result = scan();
  assert.equal(result.status, 1);
  for (const rule of ['personal email', 'personal home path', 'private network address', 'private key', 'provider credential', 'binary requires separate publication review']) {
    assert.ok(result.stderr.includes(rule), rule);
  }
}));
