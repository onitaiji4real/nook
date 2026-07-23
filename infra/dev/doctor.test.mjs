import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareVersions,
  environmentKeys,
  inspectLocalDevelopment,
} from './doctor.mjs';

const packageJson = {
  engines: { node: '>=24.14.0', pnpm: '>=11.7.0' },
};

test('compares semantic version components numerically', () => {
  assert.equal(compareVersions('24.14.0', '24.14.0'), 0);
  assert.equal(compareVersions('24.18.0', '24.14.0'), 4);
  assert.equal(compareVersions('20.17.0', '24.14.0'), -4);
});

test('extracts environment names without returning values', () => {
  assert.deepEqual(
    [...environmentKeys('DATABASE_URL=secret\n# TOKEN=hidden\n NODE_ENV=development\n')],
    ['DATABASE_URL', 'NODE_ENV'],
  );
});

test('reports a complete local toolchain as ready', () => {
  const results = inspectLocalDevelopment({
    nodeVersion: '24.18.0',
    pnpmVersion: '11.9.0',
    packageJson,
    envExists: true,
    envKeys: new Set(['DATABASE_URL']),
    toolExists: () => true,
  });

  assert.equal(results.every((result) => result.level === 'pass'), true);
});

test('reports incomplete dependencies and missing environment without exposing values', () => {
  const results = inspectLocalDevelopment({
    nodeVersion: '20.17.0',
    pnpmVersion: undefined,
    packageJson,
    envExists: false,
    envKeys: new Set(),
    toolExists: () => false,
  });
  const messages = results.map((result) => result.message).join('\n');

  assert.equal(results.filter((result) => result.level === 'fail').length, 7);
  assert.match(messages, /pnpm 無法執行/u);
  assert.match(messages, /DATABASE_URL/u);
  assert.match(messages, /node_modules\/.bin\/turbo 缺失/u);
  assert.doesNotMatch(messages, /secret/u);
});
