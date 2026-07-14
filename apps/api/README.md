# API

NestJS REST API for synchronous application use cases. Scaffolded by task `P1-001`.

Phase 1 contracts are documented in `docs/api/openapi.yaml`. Tenant endpoints require a bearer principal verified by the injected `IdentityTokenVerifier`; the default verifier fails closed until P1-004 configures Identity Platform.
