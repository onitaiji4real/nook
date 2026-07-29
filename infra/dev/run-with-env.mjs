import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function loadRootEnvironment(rootPath = repositoryRoot) {
  const environmentPath = join(rootPath, '.env');
  if (!existsSync(environmentPath)) return false;

  loadEnvFile(environmentPath);
  return true;
}

export function runWithRootEnvironment(
  command,
  args,
  { rootPath = repositoryRoot, spawnProcess = spawn } = {},
) {
  loadRootEnvironment(rootPath);

  return spawnProcess(command, args, {
    cwd: rootPath,
    env: process.env,
    stdio: 'inherit',
  });
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === undefined) {
    process.stderr.write('Usage: node infra/dev/run-with-env.mjs <command> [...args]\n');
    process.exitCode = 1;
    return;
  }

  const child = runWithRootEnvironment(command, args);
  child.once('error', (error) => {
    process.stderr.write(`Unable to start ${command}: ${error.message}\n`);
    process.exitCode = 1;
  });
  child.once('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
