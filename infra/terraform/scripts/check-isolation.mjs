import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const terraformRoot = resolve(repositoryRoot, 'infra/terraform');
const environments = ['dev', 'stg', 'prod'];

const failures = [];

for (const environment of environments) {
  const directory = resolve(terraformRoot, 'environments', environment);
  const main = readFileSync(resolve(directory, 'main.tf'), 'utf8');
  const backend = readFileSync(resolve(directory, 'backend.hcl.example'), 'utf8');
  const variables = readFileSync(resolve(directory, 'terraform.tfvars.example'), 'utf8');

  if (!new RegExp(`environment\\s+=\\s+"${environment}"`).test(main)) {
    failures.push(`${environment}: module environment is not explicit`);
  }

  if (!backend.includes(`prefix = "platform/${environment}"`)) {
    failures.push(`${environment}: backend prefix is not isolated`);
  }

  if (!backend.includes(`-${environment}-`) && !backend.includes(`-${environment}-unique`)) {
    failures.push(`${environment}: backend bucket example does not identify its environment`);
  }

  if (!new RegExp(`project_id\\s+=\\s+"beauty-platform-${environment}-unique"`).test(variables)) {
    failures.push(`${environment}: project example is not isolated`);
  }

  if (!variables.includes('github_repository = "onitaiji4real/nook"')) {
    failures.push(`${environment}: GitHub repository condition is missing`);
  }
}

const allTerraform = environments
  .flatMap((environment) => [
    readFileSync(resolve(terraformRoot, 'environments', environment, 'main.tf'), 'utf8'),
    readFileSync(
      resolve(terraformRoot, 'environments', environment, 'terraform.tfvars.example'),
      'utf8',
    ),
  ])
  .join('\n');

const forbiddenPatterns = [
  /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/,
  /credentials\s*=\s*[{\[]/,
  /private_key\s*=/,
  /service_account_key/,
];

for (const pattern of forbiddenPatterns) {
  if (pattern.test(allTerraform)) {
    failures.push(`forbidden credential pattern found: ${pattern}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('Terraform environment isolation checks passed.\n');
