import { readdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
type PackageMetadata = {
  name: string; version: string; license?: unknown; licenses?: unknown;
  dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>;
};
function readPackage(directory: string): PackageMetadata {
  return JSON.parse(readFileSync(`${directory}/package.json`, 'utf8')) as PackageMetadata;
}
if (process.argv[2] === 'prune') {
  const needed = new Set<string>();
  function collect(directory: string): void {
    const pkg = readPackage(directory);
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
      let parent = directory;
      let found = '';
      while (parent.length > 0) {
        const candidate = `${parent}/node_modules/${name}`;
        if (existsSync(`${candidate}/package.json`)) { found = candidate; break; }
        parent = parent.slice(0, parent.lastIndexOf('/'));
      }
      if (!found) {
        if (pkg.optionalDependencies?.[name] !== undefined) continue;
        throw new Error(`Missing runtime dependency ${name}`);
      }
      if (!needed.has(found)) { needed.add(found); collect(found); }
    }
  }
  collect('/app');
  function prune(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = `${directory}/${entry.name}`;
      if (entry.name === '.prisma') continue;
      if (entry.name.startsWith('@') && entry.isDirectory()) { prune(full); continue; }
      if (!needed.has(full)) { rmSync(full, { recursive: true, force: true }); continue; }
      if (existsSync(`${full}/node_modules`)) prune(`${full}/node_modules`);
    }
  }
  prune('/app/node_modules');
}
const packages: { name: string; version: string; license: unknown; path: string }[] = [];
function visit(root: string): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = `${root}/${entry.name}`;
    if (entry.name.startsWith('@')) { visit(dir); continue; }
    if (!existsSync(`${dir}/package.json`)) continue;
    const p = readPackage(dir);
    packages.push({ name: p.name, version: p.version, license: p.license ?? p.licenses ?? 'SEE LICENSE IN PACKAGE', path: dir });
    if (existsSync(`${dir}/node_modules`)) visit(`${dir}/node_modules`);
  }
}
visit('node_modules');
writeFileSync('THIRD_PARTY_NOTICES.json', JSON.stringify(packages, null, 2) + '\n');
