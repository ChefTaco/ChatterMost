import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, mkdir, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import WebSocket, { type RawData } from 'ws';
import { assertPrivateEnvFile, loadEnv } from '../src/server/env.js';

type Migration = { migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null };
const command = process.argv[2] ?? 'serve';

function runPrisma(args: string[], databaseUrl: string): string {
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', ...args], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8', timeout: 240_000
  });
  if (result.status !== 0) {
    // Prisma diagnostics may contain connection strings. Keep details in the private
    // install journal on the host, but never echo credential-bearing output here.
    throw new Error(`Prisma ${args[0]} failed (exit ${String(result.status)}); inspect database migration history before recovery`);
  }
  return result.stdout;
}

async function configure(): Promise<string> {
  const secretFile = process.env.CHATTERMOST_ENV_FILE ?? '/run/secrets/runtime.env';
  const passwordFile = process.env.POSTGRES_PASSWORD_FILE ?? '/run/secrets/postgres_password';
  assertPrivateEnvFile(secretFile);
  assertPrivateEnvFile(passwordFile);
  const password = (await readFile(passwordFile, 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/u.test(password)) throw new Error('Invalid protected database password');
  process.env.DATABASE_URL = `postgresql://chattermost_app:${password}@postgres:5432/chattermost?schema=public`;
  process.env.CHATTERMOST_ENV_FILE = secretFile;
  const env = loadEnv({ envFile: secretFile });
  // Migration CLI must use the same validated configuration as the server.
  process.env.DATABASE_URL = env.DATABASE_URL;
  return env.DATABASE_URL;
}

async function migrate(url: string): Promise<void> {
  const policy = spawnSync(process.execPath, ['scripts/schema-policy.mjs', 'inspect', '/app'], { encoding: 'utf8' });
  if (policy.status !== 0) throw new Error('Expansion-only schema policy rejected this image');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const scratchName = `cm_validate_${randomBytes(8).toString('hex')}`;
  const scratchUrl = new URL(url);
  scratchUrl.pathname = `/${scratchName}`;
  let scratchCreated = false;
  let scratchDir: string | undefined;
  try {
    // A connection-held transaction lock covers validation and migration. Prisma
    // also takes its own migration lock. Never disable either lock.
    await prisma.$transaction(async (tx) => {
      const lock = await tx.$queryRawUnsafe<{ locked: boolean }[]>('SELECT pg_try_advisory_xact_lock(734258419) AS locked');
      if (lock[0]?.locked !== true) throw new Error('Another container migration holds the database lock');
      const tables = await tx.$queryRawUnsafe<{ name: string }[]>("SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'");
      const historyExists = tables.some((t) => t.name === '_prisma_migrations');
      const history = historyExists ? await tx.$queryRawUnsafe<Migration[]>('SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name') : [];
      if (!historyExists && tables.length !== 0) throw new Error('Untracked nonempty schema; container workflow refuses repair or baselining');
      if (history.some((m) => m.finished_at === null && m.rolled_back_at === null)) throw new Error('Unfinished migration; refusing automatic recovery');
      const applied = history.filter((m) => m.finished_at !== null && m.rolled_back_at === null);
      const names = (await readdir('prisma/migrations', { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
      for (const [index, row] of applied.entries()) {
        if (names[index] !== row.migration_name) throw new Error('Database lineage is not an exact prefix of this release');
        const sql = await readFile(`prisma/migrations/${row.migration_name}/migration.sql`);
        if (createHash('sha256').update(sql).digest('hex') !== row.checksum) throw new Error('Applied migration checksum mismatch');
      }
      // Compare actual schema against a disposable database reconstructed from the
      // applied prefix. Network/permission/checksum/drift errors fail closed.
      await prisma.$executeRawUnsafe(`CREATE DATABASE "${scratchName}"`);
      scratchCreated = true;
      scratchDir = await mkdtemp(path.join(tmpdir(), 'cm-migrations-'));
      await cp('prisma/schema.prisma', path.join(scratchDir, 'schema.prisma'));
      await mkdir(path.join(scratchDir, 'migrations'));
      await cp('prisma/migrations/migration_lock.toml', path.join(scratchDir, 'migrations/migration_lock.toml'));
      for (const row of applied) await cp(`prisma/migrations/${row.migration_name}`, path.join(scratchDir, 'migrations', row.migration_name), { recursive: true });
      if (applied.length > 0) runPrisma(['migrate', 'deploy', '--schema', path.join(scratchDir, 'schema.prisma')], scratchUrl.toString());
      runPrisma(['migrate', 'diff', '--from-url', scratchUrl.toString(), '--to-url', url, '--exit-code'], url);
      runPrisma(['migrate', 'deploy'], url);
      // Validate the final schema too; never activate a drifted deployment.
      runPrisma(['migrate', 'deploy'], scratchUrl.toString());
      runPrisma(['migrate', 'diff', '--from-url', scratchUrl.toString(), '--to-url', url, '--exit-code'], url);
    }, { timeout: 600_000, maxWait: 10_000 });
    process.stdout.write('Migration validation and deployment complete\n');
  } finally {
    if (scratchCreated) await prisma.$executeRawUnsafe(`DROP DATABASE "${scratchName}" WITH (FORCE)`);
    await prisma.$disconnect();
    if (scratchDir !== undefined) await rm(scratchDir, { recursive: true, force: true });
  }
}

async function probe(): Promise<void> {
  const response = await fetch('http://127.0.0.1:8065/api/v4/system/ping', { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error('Health check failed');
  if (command !== 'ready') return;
  await configure();
  const env = loadEnv({ envFile: process.env.CHATTERMOST_ENV_FILE ?? '/run/secrets/runtime.env' });
  const login = await fetch('http://127.0.0.1:8065/api/v4/users/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: env.SERVER_URL },
    body: JSON.stringify({ login_id: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD })
  });
  const token = login.headers.get('token');
  if (!login.ok || token === null) throw new Error('Readiness login failed; use current administrator credentials in the protected runtime file');
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket('ws://127.0.0.1:8065/api/v4/websocket', { headers: { Authorization: `Bearer ${token}` } });
    const timer = setTimeout(() => { socket.terminate(); reject(new Error('WebSocket readiness timeout')); }, 5000);
    socket.on('message', (frame) => {
      const data: RawData = frame;
      const text = Array.isArray(data) ? Buffer.concat(data).toString('utf8') : Buffer.from(data as ArrayBuffer).toString('utf8');
      const message = JSON.parse(text) as { event?: string };
      if (message.event === 'hello') { clearTimeout(timer); socket.close(); resolve(); }
    });
    socket.on('error', (error) => { clearTimeout(timer); reject(error); });
  });
  process.stdout.write('HTTP, authentication and WebSocket ready\n');
}

try {
  if (command === 'health' || command === 'ready') await probe();
  else if (command === 'schema') process.stdout.write(await readFile('/app/schema.json', 'utf8'));
  else {
    const url = await configure();
    if (command === 'migrate') await migrate(url);
    else if (command === 'serve') await import('../src/server/index.js');
    else throw new Error('Unknown container command');
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Container operation failed'}\n`);
  process.exitCode = 1;
}
