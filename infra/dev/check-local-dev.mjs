import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function validateLocalDevContract(packageJson, turboJson, workspaceSource) {
  const errors = [];
  const dev = packageJson.scripts?.dev;
  const workspace = packageJson.scripts?.['dev:workspace'];
  const doctor = packageJson.scripts?.doctor;

  if (dev !== 'node infra/dev/run-with-env.mjs pnpm run dev:workspace') {
    errors.push('dev must load root .env before delegating to dev:workspace.');
  }
  if (doctor !== 'node infra/dev/doctor.mjs') {
    errors.push('doctor must remain available without workspace dependencies.');
  }
  if (!/^pmOnFail:\s+warn\s*$/mu.test(workspaceSource)) {
    errors.push('pnpm workspace must allow engine-compatible local versions with pmOnFail: warn.');
  }
  if (typeof workspace !== 'string') {
    errors.push('dev:workspace must exist.');
  } else {
    const buildPosition = workspace.indexOf("pnpm --filter './packages/*'");
    const concurrencyPosition = workspace.indexOf('--workspace-concurrency=1');
    const devPosition = workspace.indexOf('turbo run dev');
    if (buildPosition === -1 || concurrencyPosition === -1 || devPosition === -1) {
      errors.push('dev:workspace must sequentially build shared packages before turbo dev.');
    } else if (!(buildPosition < concurrencyPosition && concurrencyPosition < devPosition)) {
      errors.push('shared package build must precede turbo dev.');
    }
  }

  const devTask = turboJson.tasks?.dev;
  if (devTask?.dependsOn?.includes('^build') === true) {
    errors.push('turbo dev must not repeat package builds concurrently.');
  }
  if (devTask?.persistent !== true || devTask?.cache !== false) {
    errors.push('turbo dev must remain persistent and uncached.');
  }

  return errors;
}

function main() {
  const packageJson = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'));
  const turboJson = JSON.parse(readFileSync(resolve(repositoryRoot, 'turbo.json'), 'utf8'));
  const workspaceSource = readFileSync(resolve(repositoryRoot, 'pnpm-workspace.yaml'), 'utf8');
  const errors = validateLocalDevContract(packageJson, turboJson, workspaceSource);
  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }
  process.stdout.write('Local development startup contract passed.\n');
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
