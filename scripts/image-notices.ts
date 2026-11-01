import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
const packages: { name: string; version: string; license: unknown; path: string }[] = [];
function visit(root: string): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = `${root}/${entry.name}`;
    if (entry.name.startsWith('@')) { visit(dir); continue; }
    if (!existsSync(`${dir}/package.json`)) continue;
    const p = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8')) as { name: string; version: string; license?: unknown; licenses?: unknown };
    packages.push({ name: p.name, version: p.version, license: p.license ?? p.licenses ?? 'SEE LICENSE IN PACKAGE', path: dir });
    if (existsSync(`${dir}/node_modules`)) visit(`${dir}/node_modules`);
  }
}
visit('node_modules');
writeFileSync('THIRD_PARTY_NOTICES.json', JSON.stringify(packages, null, 2) + '\n');
