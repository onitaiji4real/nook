import { readFileSync } from 'node:fs';

const files = [
  '.github/workflows/ci.yml',
  '.github/workflows/_deploy.yml',
  '.github/workflows/deploy-staging.yml',
  '.github/workflows/deploy-production.yml',
];
const contents = Object.fromEntries(files.map((file) => [file, readFileSync(file, 'utf8')]));

for (const [file, content] of Object.entries(contents)) {
  assert(content.includes('contents: read'), `${file} must default to read-only repository access`);
  for (const line of content.split('\n').filter((value) => value.trim().startsWith('uses:'))) {
    if (line.includes('./.github/workflows/')) continue;
    assert(
      /@[0-9a-f]{40}(?:\s+#|$)/.test(line),
      `${file} action must be pinned by full SHA: ${line.trim()}`,
    );
  }
}

assert(
  !contents['.github/workflows/ci.yml'].includes('id-token: write'),
  'PR CI must not request OIDC',
);
assert(
  contents['.github/workflows/_deploy.yml'].includes('id-token: write'),
  'deploy must request OIDC',
);
assert(
  contents['.github/workflows/_deploy.yml'].includes('environment: ${{ inputs.environment }}'),
  'deploy must bind a GitHub Environment',
);
assert(
  contents['.github/workflows/deploy-staging.yml'].includes('branches: [main]'),
  'staging must follow main',
);
assert(
  contents['.github/workflows/deploy-production.yml'].includes('workflow_dispatch:'),
  'production must require a manual dispatch',
);

const reusable = contents['.github/workflows/_deploy.yml'];
assert(
  reusable.indexOf('Run backward-compatible migration') <
    reusable.indexOf('Deploy candidate revisions'),
  'migration must run before deployment',
);
assert(
  reusable.includes('cancel-in-progress: false'),
  'deployments must not cancel an active migration/release',
);

process.stdout.write('Workflow security and ordering contracts passed.\n');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
