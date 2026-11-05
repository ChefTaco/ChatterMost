#!/usr/bin/env node
// Export only product-owned browser-safe contracts, never backend source.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const index = process.argv.indexOf('--output');
const outputArgument = process.argv[index + 1];
if (index < 0 || !outputArgument) throw Error('--output NEW_DIRECTORY is required');
const output = resolve(outputArgument);
if (existsSync(output)) throw Error('Select a new contract export directory');
const source = 'src/shared/browser-admin.ts', text = readFileSync(new URL('../' + source, import.meta.url));
const manifest = { schema: 1, product: 'chattermost-browser-admin', version: 1, repository: 'https://github.com/ChefTaco/ChatterMost', revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: fileURLToPath(new URL('../', import.meta.url)) }).trim(), source, sha256: createHash('sha256').update(text).digest('hex') };
mkdirSync(output, { recursive: true, mode: 0o700 });
writeFileSync(output + '/browser-admin.ts', text, { mode: 0o600 });
writeFileSync(output + '/provenance.json', JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
