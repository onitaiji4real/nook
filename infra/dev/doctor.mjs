import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const requiredTools = ['tsc', 'turbo', 'vitest'];
const serviceHealthChecks = [
  ['web', 'http://localhost:3000/api/health'],
  ['api', 'http://localhost:8080/health'],
  ['worker', 'http://localhost:8081/health'],
];

export function compareVersions(actual, minimum) {
  const actualParts = actual.split('.').map(Number);
  const minimumParts = minimum.split('.').map(Number);

  for (let index = 0; index < Math.max(actualParts.length, minimumParts.length); index += 1) {
    const difference = (actualParts[index] ?? 0) - (minimumParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function environmentKeys(contents) {
  return new Set(
    contents
      .split(/\r?\n/u)
      .map((line) => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=/u)?.[1])
      .filter((key) => key !== undefined),
  );
}

export function inspectLocalDevelopment({
  nodeVersion,
  pnpmVersion,
  packageJson,
  envExists,
  envKeys,
  toolExists,
}) {
  const results = [];
  const minimumNodeVersion = packageJson.engines.node.replace(/^>=/u, '');
  const minimumPnpmVersion = packageJson.engines.pnpm.replace(/^>=/u, '');

  results.push({
    level: compareVersions(nodeVersion, minimumNodeVersion) >= 0 ? 'pass' : 'fail',
    message: `Node ${nodeVersion}（需要 >=${minimumNodeVersion}）`,
  });
  results.push({
    level:
      pnpmVersion !== undefined && compareVersions(pnpmVersion, minimumPnpmVersion) >= 0
        ? 'pass'
        : 'fail',
    message:
      pnpmVersion === undefined
        ? `pnpm 無法執行（需要 >=${minimumPnpmVersion}）`
        : `pnpm ${pnpmVersion}（需要 >=${minimumPnpmVersion}）`,
  });
  results.push({
    level: envExists ? 'pass' : 'fail',
    message: envExists ? '.env 已存在' : '.env 不存在；請先執行 cp .env.example .env',
  });
  results.push({
    level: envKeys.has('DATABASE_URL') ? 'pass' : 'fail',
    message: envKeys.has('DATABASE_URL') ? 'DATABASE_URL key 已設定' : '.env 缺少 DATABASE_URL',
  });

  for (const tool of requiredTools) {
    results.push({
      level: toolExists(tool) ? 'pass' : 'fail',
      message: toolExists(tool)
        ? `node_modules/.bin/${tool} 可用`
        : `node_modules/.bin/${tool} 缺失；請重新執行 pnpm install --frozen-lockfile`,
    });
  }

  return results;
}

function readPnpmVersion() {
  const result = spawnSync('pnpm', ['--version'], {
    encoding: 'utf8',
    timeout: 5_000,
  });
  if (result.status !== 0) return undefined;
  const version = result.stdout.trim();
  return /^\d+\.\d+\.\d+$/u.test(version) ? version : undefined;
}

function localToolExists(tool) {
  return existsSync(join(repositoryRoot, 'node_modules', '.bin', tool));
}

async function checkService(name, url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return {
      level: response.ok ? 'pass' : 'warn',
      message: `${name} health ${response.status} — ${url}`,
    };
  } catch {
    return { level: 'warn', message: `${name} 尚未回應 — ${url}` };
  }
}

function checkDocker() {
  const result = spawnSync('docker', ['compose', 'ps', '--status', 'running'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: 5_000,
  });
  if (result.status !== 0) {
    return {
      level: 'warn',
      message: '無法讀取 Docker Compose；請確認 Docker Desktop 或 OrbStack 已啟動',
    };
  }
  const postgresRunning = result.stdout.includes('postgres');
  return {
    level: postgresRunning ? 'pass' : 'warn',
    message: postgresRunning
      ? 'PostgreSQL container 正在執行'
      : 'PostgreSQL container 尚未執行；請執行 pnpm dev:services',
  };
}

function printResult(result) {
  const marker = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' }[result.level];
  process.stdout.write(`[${marker}] ${result.message}\n`);
}

async function main() {
  const packageJson = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'));
  const envPath = join(repositoryRoot, '.env');
  const envExists = existsSync(envPath);
  const envKeys = envExists ? environmentKeys(readFileSync(envPath, 'utf8')) : new Set();
  const localResults = inspectLocalDevelopment({
    nodeVersion: process.versions.node,
    pnpmVersion: readPnpmVersion(),
    packageJson,
    envExists,
    envKeys,
    toolExists: localToolExists,
  });

  for (const result of localResults) printResult(result);
  printResult(checkDocker());
  for (const [name, url] of serviceHealthChecks) {
    printResult(await checkService(name, url));
  }

  if (localResults.some((result) => result.level === 'fail')) {
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
