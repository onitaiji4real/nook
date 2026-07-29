import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolve } from 'node:path';

import { checkDeploymentReadiness } from './check-deployment-readiness.mjs';

const root = resolve(import.meta.dirname, '../..');

function repositoryContract() {
  return {
    terraform: readFileSync(resolve(root, 'infra/terraform/modules/platform/main.tf'), 'utf8'),
    deployScript: readFileSync(resolve(root, 'infra/ci/deploy-cloud-run.sh'), 'utf8'),
  };
}

test('accepts application readiness before promotion', () => {
  assert.deepEqual(checkDeploymentReadiness(repositoryContract()), []);
});

test('rejects TCP-only startup and health-only candidate smoke', () => {
  const contract = repositoryContract();
  contract.terraform = contract.terraform
    .replace('http_get {\n          path = local.readiness_paths[each.key]', 'tcp_socket {')
    .replace('readiness_paths', 'removed_readiness_paths');
  contract.deployScript = contract.deployScript
    .replace('path="/ready"', 'path="/health"')
    .replace('path="/api/readiness"', 'path="/api/health"');

  const failures = checkDeploymentReadiness(contract);
  assert.ok(failures.some((failure) => failure.includes('readiness path')));
  assert.ok(failures.some((failure) => failure.includes('startup probe')));
  assert.ok(failures.some((failure) => failure.includes('candidate smoke')));
});

test('rejects worker verification after traffic promotion', () => {
  const contract = repositoryContract();
  const workerBlock = contract.deployScript.slice(
    contract.deployScript.indexOf('worker_application_ready='),
    contract.deployScript.indexOf(
      '\n\n',
      contract.deployScript.indexOf('worker_application_ready='),
    ),
  );
  contract.deployScript = contract.deployScript
    .replace(`${workerBlock}\n\n`, '')
    .replace('\ntrap - ERR', `\n${workerBlock}\n\ntrap - ERR`);

  assert.deepEqual(checkDeploymentReadiness(contract), [
    'worker Ready verification must run before traffic promotion',
  ]);
});
