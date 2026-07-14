# CI and release contract

## Required pull request checks

GitHub rulesets for `main`, `phase1`, and later `dev` should require all matrix results from:

- `verify`: frozen install, lint, typecheck, unit, migration, integration, build, production dependency audit.
- `terraform`: five configuration validations, mocked tests, isolation contract, HIGH/CRITICAL misconfiguration scan.
- `container-images (web|api|worker)`: multi-stage build, non-root assertion, HIGH/CRITICAL image scan.

PR jobs have only `contents: read`; they never request OIDC or cloud credentials. Every external action is pinned to a full commit SHA. The Trivy action is pinned to the immutable post-incident v0.36.0 commit rather than a movable tag.

## Release ordering

`main` triggers staging only. Production has a separate manual workflow and the `prod` GitHub Environment must require reviewers. The reusable release job binds the selected environment before requesting OIDC, matching Terraform's WIF environment condition.

1. Build commit-SHA images and push to the environment project.
2. Resolve registry digests and reject missing digest output.
3. Update only the migration job image and wait for its expand-compatible migration.
4. Deploy all application revisions with zero traffic and a candidate tag.
5. Smoke web/API candidate URLs and verify worker Ready condition.
6. Promote candidate traffic; on failure, restore the revisions that had traffic before the release.

Migration, smoke, or readiness failure stops the workflow. Production does not follow staging automatically.

## Required environment variables

Each `stg`/`prod` GitHub Environment owns non-secret variables `GCP_PROJECT_ID`, `WIF_PROVIDER`, and `DEPLOYER_SERVICE_ACCOUNT`. No service-account key is stored. Terraform must already have provisioned the registry, runtime services, migration job, runtime secret reference, WIF provider, and deployer account.
