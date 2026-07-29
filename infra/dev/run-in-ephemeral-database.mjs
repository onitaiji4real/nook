import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { dirname, resolve } from 'node:path';

import { loadRootEnvironment } from './run-with-env.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function run(command, args, env) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env,
      stdio: 'inherit',
    });
    child.once('error', rejectRun);
    child.once('exit', (code) => resolveRun(code ?? 1));
  });
}

export function localPostgresEnvironment(databaseUrl, processEnvironment = process.env) {
  const parsed = new URL(databaseUrl);
  if (
    parsed.protocol !== 'postgresql:' ||
    !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
  ) {
    throw new Error('Ephemeral integration databases are restricted to local PostgreSQL.');
  }

  const environment = {
    ...processEnvironment,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGDATABASE: 'postgres',
  };
  if (parsed.username !== '') environment.PGUSER = decodeURIComponent(parsed.username);
  if (parsed.password !== '') environment.PGPASSWORD = decodeURIComponent(parsed.password);
  const sslMode = parsed.searchParams.get('sslmode');
  if (sslMode !== null) environment.PGSSLMODE = sslMode;
  return { parsed, environment };
}

async function main() {
  loadRootEnvironment(repositoryRoot);
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined) throw new Error('DATABASE_URL is required.');

  const separator = process.argv.indexOf('--');
  const command = separator >= 0 ? process.argv[separator + 1] : undefined;
  const args = separator >= 0 ? process.argv.slice(separator + 2) : [];
  if (command === undefined) {
    throw new Error('Usage: node infra/dev/run-in-ephemeral-database.mjs -- <command> [...args]');
  }

  const { parsed, environment } = localPostgresEnvironment(databaseUrl);
  const databaseName = `nook_test_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const testUrl = new URL(parsed);
  testUrl.pathname = `/${databaseName}`;
  testUrl.searchParams.delete('schema');
  const testEnvironment = {
    ...process.env,
    DATABASE_URL: testUrl.toString(),
  };

  let created = false;
  try {
    const createCode = await run('createdb', [databaseName], environment);
    if (createCode !== 0) throw new Error('Unable to create the ephemeral integration database.');
    created = true;

    const migrationCode = await run(
      'pnpm',
      ['--filter', '@nook/database', 'prisma:migrate:deploy'],
      testEnvironment,
    );
    if (migrationCode !== 0)
      throw new Error('Unable to migrate the ephemeral integration database.');

    process.exitCode = await run(command, args, testEnvironment);
  } finally {
    if (created) {
      const dropCode = await run('dropdb', ['--if-exists', databaseName], environment);
      if (dropCode !== 0) {
        process.stderr.write('Unable to remove the ephemeral integration database.\n');
        process.exitCode = 1;
      }
    }
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Ephemeral integration database failed.'}\n`,
    );
    process.exitCode = 1;
  });
}
