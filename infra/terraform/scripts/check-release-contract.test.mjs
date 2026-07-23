import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolve } from 'node:path';

import { checkReleaseContract } from './check-release-contract.mjs';

const terraformRoot = resolve(import.meta.dirname, '..');

function repositoryContract() {
  return {
    moduleMain: readFileSync(resolve(terraformRoot, 'modules/platform/main.tf'), 'utf8'),
    moduleVariables: readFileSync(resolve(terraformRoot, 'modules/platform/variables.tf'), 'utf8'),
    environments: Object.fromEntries(
      ['dev', 'stg', 'prod'].map((name) => [
        name,
        {
          main: readFileSync(resolve(terraformRoot, 'environments', name, 'main.tf'), 'utf8'),
          example: readFileSync(
            resolve(terraformRoot, 'environments', name, 'terraform.tfvars.example'),
            'utf8',
          ),
        },
      ]),
    ),
  };
}

test('accepts the repository release ownership contract', () => {
  assert.deepEqual(checkReleaseContract(repositoryContract()), []);
});

test('rejects broad image ownership and implicit scheduler activation', () => {
  const contract = repositoryContract();
  contract.moduleMain = contract.moduleMain
    .replace('ignore_changes = [template[0].containers[0].image]', 'ignore_changes = [template]')
    .replace(
      'count = var.deploy_runtime && var.enable_notification_dispatcher ? 1 : 0',
      'count = var.deploy_runtime ? 1 : 0',
    );

  const failures = checkReleaseContract(contract);
  assert.ok(failures.some((failure) => failure.includes('narrow image lifecycle ownership')));
  assert.ok(failures.some((failure) => failure.includes('entire Cloud Run resource')));
  assert.ok(failures.some((failure) => failure.includes('explicit activation')));
});

test('rejects an enabled environment example', () => {
  const contract = repositoryContract();
  contract.environments.prod.example = contract.environments.prod.example.replace(
    /enable_notification_dispatcher\s*=\s*false/,
    'enable_notification_dispatcher = true',
  );

  assert.deepEqual(checkReleaseContract(contract), [
    'prod: dispatcher example must remain disabled by default',
  ]);
});

test('rejects dispatcher validation that omits LINE activation', () => {
  const contract = repositoryContract();
  contract.moduleVariables = contract.moduleVariables.replace(
    '!var.enable_notification_dispatcher || (var.deploy_runtime && var.enable_line_notifications)',
    '!var.enable_notification_dispatcher || var.deploy_runtime',
  );

  assert.deepEqual(checkReleaseContract(contract), [
    'notification dispatcher variable must default off and require runtime plus LINE activation',
  ]);
});

test('rejects project-wide enqueue or missing worker OIDC actAs activation', () => {
  const contract = repositoryContract();
  contract.moduleMain = contract.moduleMain
    .replace(
      'resource "google_cloud_tasks_queue_iam_member" "notification_enqueuer"',
      'resource "google_project_iam_member" "task_enqueuer"',
    )
    .replace(
      'var.enable_line_notifications ? { worker = true } : {}',
      'var.enable_line_notifications ? {} : {}',
    );

  const failures = checkReleaseContract(contract);
  assert.ok(
    failures.includes(
      'task producers must not receive project-wide Cloud Tasks enqueue permission',
    ),
  );
  assert.ok(failures.includes('task enqueue permission must be scoped to each dedicated queue'));
  assert.ok(
    failures.includes('task producers must receive activation-scoped OIDC service-account actAs'),
  );
});
