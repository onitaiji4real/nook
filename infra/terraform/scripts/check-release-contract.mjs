import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const imagePaths = [
  'template[0].containers[0].image',
  'template[0].template[0].containers[0].image',
];

export function checkReleaseContract({ moduleMain, moduleVariables, environments }) {
  const failures = [];

  for (const path of imagePaths) {
    if (!moduleMain.includes(`ignore_changes = [${path}]`)) {
      failures.push(`missing narrow image lifecycle ownership for ${path}`);
    }
  }

  if (
    moduleMain.includes('ignore_changes = all') ||
    moduleMain.includes('ignore_changes = [template]')
  ) {
    failures.push('release ownership must not ignore the entire Cloud Run resource or template');
  }

  if (
    !moduleMain.includes('count = var.deploy_runtime && var.enable_notification_dispatcher ? 1 : 0')
  ) {
    failures.push('notification dispatcher is not gated by runtime and explicit activation');
  }

  if (moduleMain.includes('resource "google_project_iam_member" "task_enqueuer"')) {
    failures.push('task producers must not receive project-wide Cloud Tasks enqueue permission');
  }

  if (
    !moduleMain.includes('resource "google_cloud_tasks_queue_iam_member" "media_enqueuer"') ||
    !moduleMain.includes('resource "google_cloud_tasks_queue_iam_member" "notification_enqueuer"')
  ) {
    failures.push('task enqueue permission must be scoped to each dedicated queue');
  }

  if (
    !/resource "google_service_account_iam_member" "runtime_automation_service_account_user"[\s\S]*?var\.enable_media_pipeline \? \{ api = true \} : \{\}[\s\S]*?var\.enable_line_notifications \? \{ worker = true \} : \{\}/.test(
      moduleMain,
    )
  ) {
    failures.push('task producers must receive activation-scoped OIDC service-account actAs');
  }

  if (
    !/variable "enable_notification_dispatcher"\s*\{[\s\S]*?default\s+=\s+false[\s\S]*?condition\s+=\s+!var\.enable_notification_dispatcher\s*\|\|\s*\(\s*var\.deploy_runtime\s*&&\s*var\.enable_line_notifications\s*\)/.test(
      moduleVariables,
    )
  ) {
    failures.push(
      'notification dispatcher variable must default off and require runtime plus LINE activation',
    );
  }

  for (const [name, files] of Object.entries(environments)) {
    if (
      !/enable_notification_dispatcher\s*=\s*var\.enable_notification_dispatcher/.test(files.main)
    ) {
      failures.push(`${name}: dispatcher flag is not wired into the platform module`);
    }

    if (!/^enable_notification_dispatcher\s*=\s*false\s*$/m.test(files.example)) {
      failures.push(`${name}: dispatcher example must remain disabled by default`);
    }
  }

  return failures;
}

function loadRepositoryContract() {
  const repositoryRoot = resolve(import.meta.dirname, '../../..');
  const terraformRoot = resolve(repositoryRoot, 'infra/terraform');
  const environments = Object.fromEntries(
    ['dev', 'stg', 'prod'].map((name) => {
      const directory = resolve(terraformRoot, 'environments', name);
      return [
        name,
        {
          main: readFileSync(resolve(directory, 'main.tf'), 'utf8'),
          example: readFileSync(resolve(directory, 'terraform.tfvars.example'), 'utf8'),
        },
      ];
    }),
  );

  return {
    moduleMain: readFileSync(resolve(terraformRoot, 'modules/platform/main.tf'), 'utf8'),
    moduleVariables: readFileSync(resolve(terraformRoot, 'modules/platform/variables.tf'), 'utf8'),
    environments,
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const failures = checkReleaseContract(loadRepositoryContract());
  if (failures.length > 0) {
    process.stderr.write(`${failures.join('\n')}\n`);
    process.exit(1);
  }

  process.stdout.write('Terraform release ownership checks passed.\n');
}
