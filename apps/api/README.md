# API

NestJS REST API for synchronous application use cases. Scaffolded by task `P1-001`.

Phase 1 contracts are documented in `docs/api/openapi.yaml`. Tenant endpoints require an Identity Platform bearer ID token. `POST /v1/auth/line/exchange` verifies a LINE ID token and nonce before issuing a one-hour custom token contract.

Authentication defaults to `AUTH_ADAPTER_MODE=disabled` and fails closed. Production uses `firebase` with `LINE_CHANNEL_ID`, `IDENTITY_PLATFORM_PROJECT_ID`, and optional `IDENTITY_PLATFORM_SERVICE_ACCOUNT_ID`; credentials come from ADC, never a JSON key.
