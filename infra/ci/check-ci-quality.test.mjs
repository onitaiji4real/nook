import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolve } from 'node:path';

import { checkCiQuality } from './check-ci-quality.mjs';

const workflow = readFileSync(
  resolve(import.meta.dirname, '../../.github/workflows/ci.yml'),
  'utf8',
);

test('accepts the required verify quality order', () => {
  assert.deepEqual(checkCiQuality(workflow), []);
});

test('rejects a missing format gate', () => {
  const changed = workflow.replace('      - name: Format\n        run: pnpm format:check\n\n', '');
  const failures = checkCiQuality(changed);
  assert.ok(failures.some((failure) => failure.includes('format:check')));
  assert.ok(failures.some((failure) => failure.includes('quality gates')));
});

test('rejects a non-blocking format gate', () => {
  const changed = workflow.replace(
    '      - name: Format\n        run: pnpm format:check',
    '      - name: Format\n        continue-on-error: true\n        run: pnpm format:check',
  );
  assert.deepEqual(checkCiQuality(changed), ['format gate must fail the required verify job']);
});
