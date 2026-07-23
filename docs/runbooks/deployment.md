# Deployment and rollback runbook

## Safety boundary

Only reviewed `main` commits may deploy staging. Production starts through manual dispatch and requires the `prod` GitHub Environment reviewer. Do not rerun a migration or change traffic while another deployment for the same environment is active.

## Preflight

- Required CI checks are green for the exact commit SHA.
- Terraform foundation/runtime has been applied through an approved saved plan; the migration job and database secret version exist.
- Images were scanned and Artifact Registry contains the exact commit tag/digest.
- Terraform owns Cloud Run configuration while this workflow owns service/job image revisions; an approved plan must not propose reverting a released image.
- Database migration follows expand-and-contract and can run while the previous revision serves traffic.
- The platform-oncall owner has an active notification channel and access to the service-health dashboard.

## Normal release

The workflow updates the migration job image, runs it, then deploys zero-traffic candidate revisions. Web `/api/readiness` and API `/ready` must pass on their candidate URLs. Worker remains internal-only: its Cloud Run HTTP startup probe calls application `/ready`, and the workflow verifies the resulting revision Ready condition before promotion. Record the workflow URL, commit, image digests, migration execution, candidate revisions, smoke results, and approver in `docs/worklog.md`; these records are the release source of truth because Terraform intentionally ignores later image changes.

Health and readiness have different meanings. `/health` only proves the process is alive and is used for liveness; it must not gate traffic promotion. `/ready` includes required dependencies such as PostgreSQL. If any update/startup probe, Web/API candidate readiness request, or worker Ready check fails, the existing `ERR` trap restores the prior routed revisions.

The notification Scheduler remains absent while `enable_notification_dispatcher=false`. Do not enable it during a routine release; activation requires the endpoint/authentication/idempotency/staging acceptance defined by ADR 0004.

## Automatic rollback

`infra/ci/deploy-cloud-run.sh` captures each currently routed revision. An update, smoke, readiness, or promotion error triggers a best-effort restoration to those revisions. The migration is not reversed; expand-and-contract requires the previous application revision to remain compatible with the expanded schema.

## Manual rollback

1. Stop or cancel any newer deployment and declare the incident owner.
2. Find the last known-good revision and digest in the prior successful workflow/worklog.
3. Route 100% traffic back with `gcloud run services update-traffic SERVICE --to-revisions REVISION=100 --region asia-east1 --project PROJECT`.
4. Verify web/API health and readiness, worker Ready, request rate, 5xx rate, and authorization/login synthetic checks.
5. Do not run a down migration. Schedule contract cleanup only after every live revision no longer depends on the old schema.
6. Record timestamps, commands, outcome, affected environment, approver, and follow-up issue without copying tokens, customer data, database URLs, or payloads.

## Failed migration

No application candidate is deployed when the Cloud Run Job fails. Inspect safe structured logs by execution ID, fix forward in a new PR, and rerun only after confirming whether the migration is idempotent. Never edit the production migration table or database schema manually to make CI green.
