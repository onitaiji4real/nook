# CI and release contract

## Required pull request checks

GitHub rulesets for `main`, `phase1`, and later `dev` should require all matrix results from:

- `verify`: frozen install, repository/workspace/workflow architecture contracts, full repository format check, lint, typecheck, unit, migration, integration, build, production dependency audit.
- `terraform`: five configuration validations, mocked tests, isolation contract, HIGH/CRITICAL misconfiguration scan.
- `container-images (web|api|worker)`: multi-stage build, non-root assertion, HIGH/CRITICAL image scan.

PR jobs have only `contents: read`; they never request OIDC or cloud credentials. Every external action is pinned to a full commit SHA. The Trivy action is pinned to the immutable post-incident v0.36.0 commit rather than a movable tag.

`pnpm check:architecture` fails closed when a required Phase 1 directory or workspace entry is missing, a workspace manifest does not match its directory, an app depends on another deployable app, a shared package depends on an app, an `@nook/*` source import is undeclared, or generated/local/Terraform state data is tracked. It also executes the workflow security and release-ordering contract. New workspace packages are allowed when they follow the same manifest and boundary rules; the required Phase 1 apps/packages cannot silently disappear.

The Terraform job also enforces ADR 0004: only Cloud Run service/job image fields are delegated to CD, broad template ignores are rejected, and the notification Scheduler remains disabled unless an explicit runtime-dependent feature flag is enabled. Repository architecture checks additionally require HTTP application-readiness startup probes for all three services and prevent candidate smoke from falling back to process-only health checks.

## Release ordering

`main` triggers staging only. Production has a separate manual workflow and the `prod` GitHub Environment must require reviewers. The reusable release job binds the selected environment before requesting OIDC, matching Terraform's WIF environment condition.

1. Build commit-SHA images and push to the environment project.
2. Resolve registry digests and reject missing digest output.
3. Update only the migration job image and wait for its expand-compatible migration.
4. Deploy all application revisions with zero traffic and a candidate tag.
5. Smoke web/API candidate readiness URLs. Worker remains private: its Cloud Run startup probe calls application `/ready`, then the release verifies the resulting revision Ready condition.
6. Promote candidate traffic; on failure, restore the revisions that had traffic before the release.

Migration, smoke, or readiness failure stops the workflow. Production does not follow staging automatically.

Terraform owns service/job existence and image-independent runtime configuration. The release workflow owns all image updates after bootstrap and records their digests; a later Terraform apply must not revert those revisions.

## Required environment variables

Each `stg`/`prod` GitHub Environment owns non-secret variables `GCP_PROJECT_ID`, `WIF_PROVIDER`, and `DEPLOYER_SERVICE_ACCOUNT`. No service-account key is stored. Terraform must already have provisioned the registry, runtime services, migration job, runtime secret reference, WIF provider, and deployer account.
