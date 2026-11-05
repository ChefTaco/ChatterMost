import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Export one reviewed public blob from an immutable commit, never working-tree bytes. */
export function exportBrowserAdminContract(root: string, output: string): void {
  const git = (args: string[]): Buffer =>
    execFileSync('git', ['--no-replace-objects', ...args], { cwd: root });
  const revision = git(['rev-parse', '--verify', 'HEAD^{commit}']).toString('utf8').trim();
  const source = 'src/shared/browser-admin.ts';
  const text = git(['show', revision + ':' + source]);
  const manifest = {
    schema: 1,
    product: 'chattermost-browser-admin',
    version: 1,
    repository: 'https://github.com/ChefTaco/ChatterMost',
    revision,
    source,
    sha256: createHash('sha256').update(text).digest('hex')
  };
  // Exclusive directory creation preserves existing exports and operator files.
  mkdirSync(output, { mode: 0o700 });
  writeFileSync(join(output, 'browser-admin.ts'), text, { mode: 0o600, flag: 'wx' });
  writeFileSync(join(output, 'provenance.json'), JSON.stringify(manifest, null, 2) + '\n', {
    mode: 0o600,
    flag: 'wx'
  });
}

/** Conversation export is separate from the administration release contract. */
export function exportBrowserChatContract(root: string, output: string): void {
  const git = (args: string[]): Buffer =>
    execFileSync('git', ['--no-replace-objects', ...args], { cwd: root });
  const revision = git(['rev-parse', '--verify', 'HEAD^{commit}']).toString('utf8').trim(),
    source = 'src/shared/browser-chat.ts',
    text = git(['show', revision + ':' + source]);
  if (
    [...text.toString('utf8').matchAll(/from\s+['"]([^'"]+)['"]/gu)].some(
      (match) => match[1] !== 'zod'
    )
  )
    throw Error('Browser contract imports server implementation');
  mkdirSync(output, { mode: 0o700 });
  writeFileSync(join(output, 'browser-chat.ts'), text, { mode: 0o600, flag: 'wx' });
  writeFileSync(
    join(output, 'provenance.json'),
    JSON.stringify(
      {
        schema: 1,
        product: 'chattermost-browser-chat',
        version: 1,
        repository: 'https://github.com/ChefTaco/ChatterMost',
        revision,
        source,
        sha256: createHash('sha256').update(text).digest('hex')
      },
      null,
      2
    ) + '\n',
    { mode: 0o600, flag: 'wx' }
  );
}
