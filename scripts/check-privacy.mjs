#!/usr/bin/env node
// Checks staged bytes so force-added ignored files and staged-only changes are covered.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';

const git = (...args) => execFileSync('git', args, { maxBuffer: 32 * 1024 * 1024 });
const entries = git('ls-files', '--stage', '-z').toString('utf8').split('\0').filter(Boolean);
const failures = [];
const patterns = [
  ['private key', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/u],
  ['provider credential', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{40,})\b/u],
  ['private endpoint', /\b(?:[a-z0-9-]+\.)+(?:ts\.net|internal|lan|local)\b/iu],
  ['personal home path', /\/(?:home|Users)\/(?!chattermost(?:\/|\b)|example(?:\/|\b)|user(?:\/|\b))[a-zA-Z0-9_.-]+\//u],
  ['personal email', /\b[A-Z0-9._%+-]+@(?!(?:[A-Z0-9-]+\.)*(?:example\.(?:com|net|org|test)|localhost|invalid|test)\b|users\.noreply\.github\.com\b)[A-Z0-9.-]+\.[A-Z]{2,}\b/iu]
];
const localValues = [];
if (existsSync('.env')) {
  for (const [name, value] of Object.entries(parse(readFileSync('.env')))) {
    if (value.length < 12 || /^(?:replace-with-|change-this-)/u.test(value)) continue;
    if (/(?:(?:SECRET|PASSWORD|TOKEN)(?:_HASH)?|DEPLOY_HOST|DEPLOY_PATH|ADMIN_EMAIL)$/u.test(name)) {
      localValues.push(value);
    }
    if (/URL$/u.test(name)) {
      try {
        const host = new URL(value).hostname;
        if (host !== 'localhost' && !host.startsWith('127.') && !host.endsWith('.test')) localValues.push(host);
      } catch { /* Non-URL placeholders do not define private endpoints. */ }
    }
  }
}

for (const entry of entries) {
  const match = /^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/u.exec(entry);
  if (!match) throw new Error('Unrecognized Git index entry');
  const [, mode, oid, stage, file] = match;
  const reject = (rule) => failures.push(`${JSON.stringify(file)}: ${rule}`);
  if (stage !== '0') { reject('unresolved merge'); continue; }
  if (mode !== '100644' && mode !== '100755') { reject('unsupported link or submodule'); continue; }
  if (/(?:^|\/)(?:\.env(?:\..*)?|\.envrc)$/u.test(file) && file !== '.env.example') reject('private environment file');
  if (/(?:^|\/)(?:secrets\/(?:runtime\.env|postgres_password)|installation\.json|compose\.env|transactions\.jsonl|migration-evidence\.json|pending\.json|\.verified\.json)$/u.test(file)) reject('private container installation state');
  if (/^(?:data|dist|output|coverage|node_modules|playwright-report|test-results|private|backups|shared|releases|mmcli_linux_bin|\.playwright-cli)\//u.test(file) || /^(?:deploy\/ssh_known_hosts|ethersage\.project\.yaml)$/u.test(file)) reject('private or generated artifact');
  if (/\.(?:pem|key|p12|pfx|crt|cer|har|bundle|dump|sqlite3?|db|zip|tar(?:\.gz)?|sql\.gz)$/iu.test(file)) reject('sensitive archive, database, certificate, or key');
  const size = Number(git('cat-file', '-s', oid).toString('utf8').trim());
  if (size > 1024 * 1024) { reject('file exceeds 1 MiB publication limit'); continue; }
  const bytes = git('cat-file', 'blob', oid);
  if (bytes.includes(0)) { reject('binary requires separate publication review'); continue; }
  const content = bytes.toString('utf8');
  for (const [label, pattern] of patterns) if (pattern.test(content)) reject(label);
  if (localValues.some((value) => content.includes(value))) reject('private local configuration value');
  // Test fixtures intentionally exercise private network/proxy ranges with synthetic records.
  if (!file.startsWith('tests/') && /\b(?:10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})\b/u.test(content)) reject('private network address');
}
if (failures.length) {
  console.error('Publication privacy check failed (matched values are withheld):\n' + failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Publication privacy check passed for ${entries.length} staged files. Review prose, metadata, and media manually too.`);
}
