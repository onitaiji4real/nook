import assert from 'node:assert/strict';
import test from 'node:test';

import { validateLocalDevContract } from './check-local-dev.mjs';

const validPackage = {
  scripts: {
    dev: 'node infra/dev/run-with-env.mjs pnpm run dev:workspace',
    doctor: 'node infra/dev/doctor.mjs',
    'dev:workspace':
      "pnpm --filter './packages/*' --workspace-concurrency=1 run build && turbo run dev",
  },
};
const validTurbo = { tasks: { dev: { cache: false, persistent: true } } };
const validWorkspace = 'packages:\n  - apps/*\npmOnFail: warn\n';

test('accepts sequential package preparation before persistent apps', () => {
  assert.deepEqual(validateLocalDevContract(validPackage, validTurbo, validWorkspace), []);
});

test('rejects a concurrent or missing package preparation', () => {
  const invalid = { scripts: { ...validPackage.scripts } };
  invalid.scripts['dev:workspace'] = "pnpm --filter './packages/*' run build && turbo run dev";
  assert.match(
    validateLocalDevContract(invalid, validTurbo, validWorkspace).join('\n'),
    /sequentially build/,
  );
});

test('rejects removing the dependency-independent doctor', () => {
  const invalid = { scripts: { ...validPackage.scripts } };
  delete invalid.scripts.doctor;
  assert.match(validateLocalDevContract(invalid, validTurbo, validWorkspace).join('\n'), /doctor/);
});

test('rejects implicit Turbo dependency builds in a persistent dev graph', () => {
  const invalidTurbo = {
    tasks: { dev: { cache: false, persistent: true, dependsOn: ['^build'] } },
  };
  assert.match(
    validateLocalDevContract(validPackage, invalidTurbo, validWorkspace).join('\n'),
    /must not repeat/,
  );
});

test('rejects automatic local package-manager downloads', () => {
  assert.match(
    validateLocalDevContract(validPackage, validTurbo, 'packages:\n  - apps/*\n').join('\n'),
    /pmOnFail/,
  );
});
