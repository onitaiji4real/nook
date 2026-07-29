# Docker

Phase 1 uses the root `docker-compose.yml` for local PostgreSQL 16 + PostGIS 3.5. Production images use one multi-stage Dockerfile per deployable application:

- `apps/web/Dockerfile`: Next.js standalone server.
- `apps/api/Dockerfile`: Nest API and Prisma migration assets.
- `apps/worker/Dockerfile`: internal Nest worker.

Build from repository root, for example `docker build -f apps/api/Dockerfile -t nook-api:test .`. Every runtime stage uses a digest-pinned Google distroless Node 24 base, the unprivileged `65532:65532` user, and a healthcheck. CI builds all three images with the commit SHA, asserts that runtime identity, and scans HIGH/CRITICAL findings before any registry push.

Deployment resolves Artifact Registry tags to immutable digests. `latest` is never used as a runtime reference. API/worker use `pnpm deploy --prod` so dev tools are absent from runtime. The API image includes the pinned Prisma CLI solely so the separately managed Cloud Run migration job can invoke it through the distroless Node binary; application startup remains `dist/main.js` and never runs migrations.
