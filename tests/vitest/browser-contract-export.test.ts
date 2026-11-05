import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { exportBrowserAdminContract } from '../../scripts/lib/browser-contract-export.js';
it('exports only the committed public contract with exact provenance and never overwrites existing exports', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chat-public-contract-'));
  try {
    const git = (args: string[]): string =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    git(['init', '--quiet']);
    await mkdir(join(root, 'src/shared'), { recursive: true });
    const source = 'src/shared/browser-admin.ts',
      publicText = '// Synthetic public contract\nexport const version = 1;\n';
    await writeFile(join(root, source), publicText);
    git(['add', source]);
    git([
      '-c',
      'commit.gpgsign=false',
      '-c',
      'user.name=Example Contributor',
      '-c',
      'user.email=contributor@example.com',
      'commit',
      '--quiet',
      '-m',
      'test: synthetic public contract'
    ]);
    const revision = git(['rev-parse', 'HEAD']);
    await writeFile(join(root, source), '// Unreviewed local changes must not be exported\n');
    await writeFile(join(root, '.env'), 'SYNTHETIC_SECRET=obviously-fake-local-only\n');
    const output = join(root, 'export');
    exportBrowserAdminContract(root, output);
    expect(await readdir(output)).toEqual(['browser-admin.ts', 'provenance.json']);
    expect(await readFile(join(output, 'browser-admin.ts'), 'utf8')).toBe(publicText);
    const manifest = JSON.parse(await readFile(join(output, 'provenance.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(manifest).toMatchObject({
      revision,
      source,
      sha256: createHash('sha256').update(publicText).digest('hex')
    });
    expect((await stat(output)).mode & 0o777).toBe(0o700);
    expect((await stat(join(output, 'browser-admin.ts'))).mode & 0o777).toBe(0o600);
    expect(() => exportBrowserAdminContract(root, output)).toThrow();
    expect(await readFile(join(output, 'browser-admin.ts'), 'utf8')).toBe(publicText);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import { exportBrowserChatContract } from '../../scripts/lib/browser-contract-export.js';
it('conversation artifacts contain only immutable owned wire schemas', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chat-conversation-export-'));
  try {
    const git = (args: string[]) =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    git(['init', '--quiet']);
    await mkdir(join(root, 'src/shared'), { recursive: true });
    const source = 'src/shared/browser-chat.ts',
      text = "import { z } from 'zod';\nexport const value=z.string();\n";
    await writeFile(join(root, source), text);
    git(['add', source]);
    git([
      '-c',
      'commit.gpgsign=false',
      '-c',
      'user.name=Example Contributor',
      '-c',
      'user.email=contributor@example.com',
      'commit',
      '--quiet',
      '-m',
      'test: public wire schema'
    ]);
    await writeFile(join(root, source), '// Local work must not escape\n');
    const output = join(root, 'export');
    exportBrowserChatContract(root, output);
    expect(await readFile(join(output, 'browser-chat.ts'), 'utf8')).toBe(text);
    expect(JSON.parse(await readFile(join(output, 'provenance.json'), 'utf8'))).toMatchObject({
      product: 'chattermost-browser-chat',
      source,
      sha256: createHash('sha256').update(text).digest('hex')
    });
    expect(() => exportBrowserChatContract(root, output)).toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
