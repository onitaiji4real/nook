import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractModuleSpecifiers,
  findImportBoundaryErrors,
  findTrackedArtifactErrors,
} from './check-repository-structure.mjs';

function workspace(input) {
  return {
    absolutePath: `/repo/${input.relativePath}`,
    kind: input.kind,
    manifest: {
      name: input.name,
      private: true,
      ...(input.dependencies === undefined ? {} : { dependencies: input.dependencies }),
    },
    relativePath: input.relativePath,
    rootPath: '/repo',
  };
}

test('extracts static, dynamic, require, and export module specifiers', () => {
  assert.deepEqual(
    extractModuleSpecifiers(`
      import type { Contract } from '@nook/contracts';
      export { value } from '@nook/domain';
      import '@nook/observability';
      const config = await import('@nook/config');
      const database = require('@nook/database');
    `),
    ['@nook/contracts', '@nook/domain', '@nook/observability', '@nook/config', '@nook/database'],
  );
});

test('rejects generated artifacts, Terraform state, and non-example environment files', () => {
  assert.deepEqual(
    findTrackedArtifactErrors([
      'apps/api/dist/main.js',
      'infra/terraform/dev.tfstate',
      '.env.production',
      '.env.example',
    ]),
    [
      'generated or local artifact must not be tracked: apps/api/dist/main.js',
      'generated or local artifact must not be tracked: infra/terraform/dev.tfstate',
      'environment file must not be tracked: .env.production',
    ],
  );
});

test('rejects undeclared workspace imports and relative imports that escape a workspace', () => {
  const api = workspace({ kind: 'app', name: '@nook/api', relativePath: 'apps/api' });
  const contracts = workspace({
    kind: 'package',
    name: '@nook/contracts',
    relativePath: 'packages/contracts',
  });
  const errors = findImportBoundaryErrors({
    workspace: api,
    sourceFile: '/repo/apps/api/src/controller.ts',
    source: `
      import { schema } from '@nook/contracts';
      import { secret } from '../../../packages/config/src/index';
    `,
    workspaceByName: new Map([
      [api.manifest.name, api],
      [contracts.manifest.name, contracts],
    ]),
  });

  assert.deepEqual(errors, [
    'apps/api/src/controller.ts imports undeclared dependency @nook/contracts',
    'apps/api/src/controller.ts escapes workspace apps/api: ../../../packages/config/src/index',
  ]);
});

test('rejects package-to-app and app-to-app dependencies', () => {
  const domain = workspace({
    kind: 'package',
    name: '@nook/domain',
    relativePath: 'packages/domain',
    dependencies: { '@nook/api': 'workspace:*' },
  });
  const web = workspace({
    kind: 'app',
    name: '@nook/web',
    relativePath: 'apps/web',
    dependencies: { '@nook/api': 'workspace:*' },
  });
  const api = workspace({ kind: 'app', name: '@nook/api', relativePath: 'apps/api' });
  const workspaceByName = new Map([
    [domain.manifest.name, domain],
    [web.manifest.name, web],
    [api.manifest.name, api],
  ]);

  assert.deepEqual(
    findImportBoundaryErrors({
      workspace: domain,
      sourceFile: '/repo/packages/domain/src/index.ts',
      source: `import '@nook/api';`,
      workspaceByName,
    }),
    ['@nook/domain package must not depend on deployable @nook/api'],
  );
  assert.deepEqual(
    findImportBoundaryErrors({
      workspace: web,
      sourceFile: '/repo/apps/web/src/app.ts',
      source: `import '@nook/api';`,
      workspaceByName,
    }),
    ['@nook/web app must not depend on deployable @nook/api'],
  );
});

test('accepts declared package-to-package imports', () => {
  const domain = workspace({
    kind: 'package',
    name: '@nook/domain',
    relativePath: 'packages/domain',
  });
  const contracts = workspace({
    kind: 'package',
    name: '@nook/contracts',
    relativePath: 'packages/contracts',
    dependencies: { '@nook/domain': 'workspace:*' },
  });

  assert.deepEqual(
    findImportBoundaryErrors({
      workspace: contracts,
      sourceFile: '/repo/packages/contracts/src/index.ts',
      source: `import type { DomainEvent } from '@nook/domain';`,
      workspaceByName: new Map([
        [domain.manifest.name, domain],
        [contracts.manifest.name, contracts],
      ]),
    }),
    [],
  );
});
