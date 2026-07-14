# Engineering Rules

本檔適用於整個 repository。開始任何工作前，先閱讀：

1. `docs/product/business-technical-plan.md`
2. `docs/phase-1/implementation-plan.md`
3. `docs/tasks/README.md` 與指派的垂直任務
4. `docs/worklog.md` 最新紀錄

## Product and communication

- Use Traditional Chinese for user-facing copy and English for code identifiers.
- Taiwan and `Asia/Taipei` are the product defaults; store timestamps in UTC.
- Keep the LINE-first flow usable in an external browser.
- Do not expand beyond the active task's acceptance criteria without documenting the decision.

## Architecture

- Keep a modular monolith with three deployable applications: web, API, and worker.
- Controllers must not access Prisma directly.
- Every tenant-owned query must require `tenantId`.
- All write APIs must validate authorization in the application service.
- Appointment status changes must use the domain state machine.
- Booking confirmation must run in a PostgreSQL transaction.
- External webhook handlers must be idempotent and store the raw event.
- Use entitlements; never branch business behavior on a hard-coded plan name.

## Code and data

- Use TypeScript strict mode. Do not use `any` without an explicit justification comment.
- Validate configuration at startup and fail closed when required values are missing.
- Never log PII, tokens, secrets, payment payloads, or customer notes.
- Use structured logs with `requestId`, operation, outcome, and safe entity identifiers.
- Migrations must be backward compatible and follow expand-and-contract.
- Application startup must never run database migrations automatically.

## Tests and delivery

- Add unit tests for domain logic and integration tests for database constraints.
- Add tenant-isolation and authorization tests to every tenant-owned vertical slice.
- Update OpenAPI and ADRs when changing a public contract or architecture decision.
- Do not add a GCP service or third-party dependency without an ADR.
- Run the relevant lint, typecheck, tests, Terraform checks, and build before completion.
- Update `docs/worklog.md` during every task with decisions, verification, and remaining risks.
- Update the task file status and check its acceptance criteria before handoff.

## Git hygiene

- Never commit directly on `main` and never push updates directly to `main`.
- Phase 1 implementation targets `phase1`; use `dev` as the integration branch after Phase 1.
- Prefer task branches such as `codex/p1-001-repository-foundation` when a slice benefits from isolated review.
- Merge `phase1` or `dev` into `main` only through a reviewed pull request after required checks pass.
- Keep commits scoped to one vertical slice or infrastructure change.
- Never commit credentials, `.env` files, Terraform state, or generated provider artifacts.
- Preserve unrelated changes already present in the worktree.
