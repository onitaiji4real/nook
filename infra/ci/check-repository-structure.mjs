import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const expectedApps = ['api', 'web', 'worker'];
const expectedPackages = [
  'auth',
  'config',
  'contracts',
  'database',
  'domain',
  'line',
  'observability',
  'payments',
  'ui',
];
const requiredDirectories = [
  '.github/workflows',
  'docs/adr',
  'docs/api',
  'docs/phase-1',
  'docs/product',
  'docs/runbooks',
  'docs/security',
  'docs/tasks',
  'infra/ci',
  'infra/docker',
  'infra/terraform/bootstrap',
  'infra/terraform/environments/dev',
  'infra/terraform/environments/prod',
  'infra/terraform/environments/stg',
  'infra/terraform/modules',
  'tests/e2e',
  'tests/fixtures',
];
const sourceExtensionPattern = /\.(?:[cm]?[jt]sx?)$/;

export function findTrackedArtifactErrors(trackedFiles) {
  const forbiddenDirectoryPattern =
    /(?:^|\/)(?:node_modules|dist|\.next|\.pnpm-store|\.terraform|\.turbo)(?:\/|$)/;
  const forbiddenFilePattern =
    /(?:^|\/)(?:\.DS_Store|[^/]+\.tfstate(?:\..*)?|[^/]+\.tfplan|crash\.log)$/;

  return trackedFiles.flatMap((file) => {
    if (forbiddenDirectoryPattern.test(file) || forbiddenFilePattern.test(file)) {
      return [`generated or local artifact must not be tracked: ${file}`];
    }
    if (/(?:^|\/)\.env(?:\..+)?$/.test(file) && !file.endsWith('.env.example')) {
      return [`environment file must not be tracked: ${file}`];
    }
    return [];
  });
}

export function extractModuleSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1] !== undefined) specifiers.push(match[1]);
    }
  }

  return [...new Set(specifiers)];
}

export function findImportBoundaryErrors({ workspace, sourceFile, source, workspaceByName }) {
  const errors = [];
  const declaredDependencies = new Set([
    ...Object.keys(workspace.manifest.dependencies ?? {}),
    ...Object.keys(workspace.manifest.devDependencies ?? {}),
    ...Object.keys(workspace.manifest.peerDependencies ?? {}),
    ...Object.keys(workspace.manifest.optionalDependencies ?? {}),
  ]);

  for (const specifier of extractModuleSpecifiers(source)) {
    if (specifier.startsWith('.')) {
      const target = resolve(dirname(sourceFile), specifier);
      const relativeTarget = relative(workspace.absolutePath, target);
      if (relativeTarget === '..' || relativeTarget.startsWith(`..${sep}`)) {
        errors.push(
          `${relativeToRoot(sourceFile, workspace.rootPath)} escapes workspace ${workspace.relativePath}: ${specifier}`,
        );
      }
      continue;
    }

    if (!specifier.startsWith('@nook/')) continue;
    const importedName = specifier.split('/').slice(0, 2).join('/');
    const importedWorkspace = workspaceByName.get(importedName);
    if (importedWorkspace === undefined) {
      errors.push(
        `${relativeToRoot(sourceFile, workspace.rootPath)} imports unknown workspace ${importedName}`,
      );
      continue;
    }
    if (workspace.kind === 'package' && importedWorkspace.kind === 'app') {
      errors.push(
        `${workspace.manifest.name} package must not depend on deployable ${importedName}`,
      );
    }
    if (workspace.kind === 'app' && importedWorkspace.kind === 'app') {
      errors.push(`${workspace.manifest.name} app must not depend on deployable ${importedName}`);
    }
    if (importedName !== workspace.manifest.name && !declaredDependencies.has(importedName)) {
      errors.push(
        `${relativeToRoot(sourceFile, workspace.rootPath)} imports undeclared dependency ${importedName}`,
      );
    }
  }

  return errors;
}

export function validateRepositoryStructure(rootPath = process.cwd(), trackedFiles) {
  const root = resolve(rootPath);
  const errors = [];
  const requiredRootFiles = [
    'AGENTS.md',
    'README.md',
    'docker-compose.yml',
    '.nvmrc',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'tsconfig.base.json',
    'turbo.json',
  ];

  for (const path of [...requiredRootFiles, ...requiredDirectories]) {
    if (!existsSync(join(root, path))) errors.push(`required repository path is missing: ${path}`);
  }

  validateRootWorkspaceContract(root, errors);

  const appDirectories = listDirectories(join(root, 'apps'));
  const packageDirectories = listDirectories(join(root, 'packages'));
  for (const app of expectedApps) {
    if (!appDirectories.includes(app)) errors.push(`required deployable is missing: apps/${app}`);
  }
  for (const packageName of expectedPackages) {
    if (!packageDirectories.includes(packageName)) {
      errors.push(`required shared package is missing: packages/${packageName}`);
    }
  }

  const workspaces = [
    ...appDirectories.map((name) => createWorkspace(root, 'app', name, errors)),
    ...packageDirectories.map((name) => createWorkspace(root, 'package', name, errors)),
  ].filter((workspace) => workspace !== undefined);
  const workspaceByName = new Map();

  for (const workspace of workspaces) {
    const packageName = workspace.manifest.name;
    if (typeof packageName !== 'string' || packageName.length === 0) {
      errors.push(`${workspace.relativePath}/package.json must define a package name`);
      continue;
    }
    if (workspaceByName.has(packageName))
      errors.push(`duplicate workspace package name: ${packageName}`);
    workspaceByName.set(packageName, workspace);
  }

  for (const workspace of workspaces) {
    const dependencies = {
      ...workspace.manifest.dependencies,
      ...workspace.manifest.devDependencies,
      ...workspace.manifest.peerDependencies,
      ...workspace.manifest.optionalDependencies,
    };
    for (const [dependency, version] of Object.entries(dependencies)) {
      if (!dependency.startsWith('@nook/')) continue;
      const target = workspaceByName.get(dependency);
      if (target === undefined) {
        errors.push(
          `${workspace.manifest.name} declares unknown workspace dependency ${dependency}`,
        );
      } else if (typeof version !== 'string' || !version.startsWith('workspace:')) {
        errors.push(
          `${workspace.manifest.name} must declare ${dependency} with the workspace protocol`,
        );
      } else if (workspace.kind === 'package' && target.kind === 'app') {
        errors.push(
          `${workspace.manifest.name} package must not depend on deployable ${dependency}`,
        );
      } else if (workspace.kind === 'app' && target.kind === 'app') {
        errors.push(`${workspace.manifest.name} app must not depend on deployable ${dependency}`);
      }
    }

    for (const sourceFile of listSourceFiles(workspace.absolutePath)) {
      errors.push(
        ...findImportBoundaryErrors({
          workspace,
          sourceFile,
          source: readFileSync(sourceFile, 'utf8'),
          workspaceByName,
        }),
      );
    }
  }

  const files = trackedFiles ?? listTrackedFiles(root);
  errors.push(...findTrackedArtifactErrors(files));
  return [...new Set(errors)].sort();
}

function validateRootWorkspaceContract(root, errors) {
  const manifestPath = join(root, 'package.json');
  const workspacePath = join(root, 'pnpm-workspace.yaml');
  const nodeVersionPath = join(root, '.nvmrc');
  if (![manifestPath, workspacePath, nodeVersionPath].every((path) => existsSync(path))) return;

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const nodeVersion = readFileSync(nodeVersionPath, 'utf8').trim().replace(/^v/, '');
    const pnpmVersion =
      typeof manifest.packageManager === 'string'
        ? manifest.packageManager.match(/^pnpm@(.+)$/)?.[1]
        : undefined;
    if (manifest.private !== true) errors.push('root package must be private');
    if (nodeVersion.length === 0 || !satisfiesMinimumVersion(nodeVersion, manifest.engines?.node)) {
      errors.push('.nvmrc version must satisfy package.json engines.node');
    }
    if (
      pnpmVersion === undefined ||
      !satisfiesMinimumVersion(pnpmVersion, manifest.engines?.pnpm)
    ) {
      errors.push('packageManager pnpm version must satisfy package.json engines.pnpm');
    }
  } catch (error) {
    errors.push(`root package.json is invalid JSON: ${errorMessage(error)}`);
  }

  const workspace = readFileSync(workspacePath, 'utf8');
  for (const pattern of ['apps/*', 'packages/*']) {
    if (!workspace.includes(`- ${pattern}`)) {
      errors.push(`pnpm-workspace.yaml must include ${pattern}`);
    }
  }
}

function satisfiesMinimumVersion(version, range) {
  if (typeof range !== 'string') return false;
  const minimum = range.match(/^>=\s*(\d+)\.(\d+)\.(\d+)$/);
  const actual = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (minimum === null || actual === null) return false;

  for (let index = 1; index <= 3; index += 1) {
    const actualPart = Number(actual[index]);
    const minimumPart = Number(minimum[index]);
    if (actualPart > minimumPart) return true;
    if (actualPart < minimumPart) return false;
  }
  return true;
}

function createWorkspace(root, kind, name, errors) {
  const relativePath = `${kind === 'app' ? 'apps' : 'packages'}/${name}`;
  const absolutePath = join(root, relativePath);
  const manifestPath = join(absolutePath, 'package.json');
  const requiredPaths =
    kind === 'app'
      ? ['Dockerfile', 'README.md', 'package.json', 'src', 'tsconfig.json']
      : ['README.md', 'package.json', 'src/index.ts', 'tsconfig.build.json', 'tsconfig.json'];

  for (const path of requiredPaths) {
    if (!existsSync(join(absolutePath, path))) {
      errors.push(`workspace path is missing: ${relativePath}/${path}`);
    }
  }
  if (!existsSync(manifestPath)) return undefined;

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    errors.push(`${relativePath}/package.json is invalid JSON: ${errorMessage(error)}`);
    return undefined;
  }

  if (manifest.name !== `@nook/${name}`) {
    errors.push(`${relativePath} must use package name @nook/${name}`);
  }
  if (manifest.private !== true) errors.push(`${manifest.name ?? relativePath} must be private`);
  for (const script of ['build', 'lint', 'test', 'typecheck']) {
    if (typeof manifest.scripts?.[script] !== 'string') {
      errors.push(`${manifest.name ?? relativePath} must define the ${script} script`);
    }
  }

  return { absolutePath, kind, manifest, relativePath, rootPath: root };
}

function listDirectories(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
}

function listSourceFiles(workspacePath) {
  const roots = ['src', 'test']
    .map((directory) => join(workspacePath, directory))
    .filter((path) => existsSync(path));
  const files = [];

  while (roots.length > 0) {
    const current = roots.pop();
    if (current === undefined) break;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) roots.push(path);
      else if (entry.isFile() && sourceExtensionPattern.test(entry.name)) files.push(path);
    }
  }
  return files.sort();
}

function listTrackedFiles(root) {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

function relativeToRoot(path, root) {
  if (!isAbsolute(path)) return path;
  return relative(root, path).split(sep).join('/');
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const errors = validateRepositoryStructure();
  if (errors.length > 0) {
    process.stderr.write(`Repository structure contract failed:\n- ${errors.join('\n- ')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('Repository structure and dependency boundaries passed.\n');
  }
}
