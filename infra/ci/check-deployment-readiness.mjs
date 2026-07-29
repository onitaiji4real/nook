import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export function checkDeploymentReadiness({ terraform, deployScript }) {
  const failures = [];

  for (const [service, path] of [
    ['web', '/api/readiness'],
    ['api', '/ready'],
    ['worker', '/ready'],
  ]) {
    if (!new RegExp(`${service}\\s+=\\s+"${path}"`).test(terraform)) {
      failures.push(`${service}: Terraform readiness path is missing`);
    }
  }

  if (
    !/startup_probe\s*\{[\s\S]*?http_get\s*\{[\s\S]*?path\s*=\s*local\.readiness_paths\[each\.key\]/.test(
      terraform,
    )
  ) {
    failures.push('Cloud Run startup probe must call the application readiness path');
  }

  if (/startup_probe\s*\{[\s\S]*?tcp_socket\s*\{/.test(terraform)) {
    failures.push('TCP-only startup probes cannot prove application readiness');
  }

  if (!deployScript.includes('path="/ready"') || !deployScript.includes('path="/api/readiness"')) {
    failures.push('public candidate smoke must call Web and API readiness endpoints');
  }

  const workerCheck = deployScript.indexOf('worker_application_ready=');
  const promotion = deployScript.indexOf('for service in "${services[@]}"; do', workerCheck);
  if (workerCheck < 0 || promotion < 0 || workerCheck > promotion) {
    failures.push('worker Ready verification must run before traffic promotion');
  }

  return failures;
}

function repositoryContract() {
  const root = resolve(import.meta.dirname, '../..');
  return {
    terraform: readFileSync(resolve(root, 'infra/terraform/modules/platform/main.tf'), 'utf8'),
    deployScript: readFileSync(resolve(root, 'infra/ci/deploy-cloud-run.sh'), 'utf8'),
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const failures = checkDeploymentReadiness(repositoryContract());
  if (failures.length > 0) {
    process.stderr.write(`${failures.join('\n')}\n`);
    process.exit(1);
  }

  process.stdout.write('Deployment application readiness checks passed.\n');
}
