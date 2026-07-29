import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadRootEnvironment, runWithRootEnvironment } from './run-with-env.mjs';

test('loads the repository .env without overriding an exported value', async () => {
  const rootPath = await mkdtemp(join(tmpdir(), 'nook-env-'));
  const loadedKey = `NOOK_ENV_LOADED_${process.pid}`;
  const preservedKey = `NOOK_ENV_PRESERVED_${process.pid}`;

  try {
    await writeFile(
      join(rootPath, '.env'),
      `${loadedKey}=from-file\n${preservedKey}=from-file\n`,
      'utf8',
    );
    process.env[preservedKey] = 'from-shell';

    assert.equal(loadRootEnvironment(rootPath), true);
    assert.equal(process.env[loadedKey], 'from-file');
    assert.equal(process.env[preservedKey], 'from-shell');
  } finally {
    delete process.env[loadedKey];
    delete process.env[preservedKey];
    await rm(rootPath, { recursive: true, force: true });
  }
});

test('continues when the optional repository .env is absent', async () => {
  const rootPath = await mkdtemp(join(tmpdir(), 'nook-env-missing-'));

  try {
    assert.equal(loadRootEnvironment(rootPath), false);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test('starts the command from the repository root with the loaded environment', async () => {
  const rootPath = await mkdtemp(join(tmpdir(), 'nook-env-command-'));
  const environmentKey = `NOOK_ENV_COMMAND_${process.pid}`;
  const calls = [];

  try {
    await writeFile(join(rootPath, '.env'), `${environmentKey}=available\n`, 'utf8');
    const child = { once() {} };

    const result = runWithRootEnvironment('example-command', ['one', 'two'], {
      rootPath,
      spawnProcess(command, args, options) {
        calls.push({ command, args, options });
        return child;
      },
    });

    assert.equal(result, child);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, 'example-command');
    assert.deepEqual(calls[0].args, ['one', 'two']);
    assert.equal(calls[0].options.cwd, rootPath);
    assert.equal(calls[0].options.env[environmentKey], 'available');
    assert.equal(calls[0].options.stdio, 'inherit');
  } finally {
    delete process.env[environmentKey];
    await rm(rootPath, { recursive: true, force: true });
  }
});
