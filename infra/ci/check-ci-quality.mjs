import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export function checkCiQuality(workflow) {
  const failures = [];
  const verifyStart = workflow.indexOf('  verify:');
  const terraformStart = workflow.indexOf('  terraform:', verifyStart);
  const verify = workflow.slice(verifyStart, terraformStart);
  const install = verify.indexOf('run: pnpm install --frozen-lockfile');
  const architecture = verify.indexOf('run: pnpm check:architecture');
  const format = verify.indexOf('run: pnpm format:check');
  const lint = verify.indexOf('run: pnpm lint');
  const typecheck = verify.indexOf('run: pnpm typecheck');

  if (verifyStart < 0 || terraformStart < 0) {
    failures.push('CI workflow must contain a verify job before terraform');
  }
  if (format < 0) {
    failures.push('verify job must run pnpm format:check');
  }
  if (!(install < architecture && architecture < format && format < lint && lint < typecheck)) {
    failures.push('verify quality gates must run install, architecture, format, lint, typecheck');
  }

  const formatStep = verify.slice(Math.max(0, verify.lastIndexOf('- name:', format)), lint);
  if (formatStep.includes('continue-on-error: true')) {
    failures.push('format gate must fail the required verify job');
  }

  return failures;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const root = resolve(import.meta.dirname, '../..');
  const failures = checkCiQuality(readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8'));
  if (failures.length > 0) {
    process.stderr.write(`${failures.join('\n')}\n`);
    process.exit(1);
  }

  process.stdout.write('CI required quality gate checks passed.\n');
}
