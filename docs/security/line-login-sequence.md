# LINE login exchange sequence

```mermaid
sequenceDiagram
  participant Browser as External browser / LIFF
  participant API as Nook API
  participant LINE as LINE verify endpoint
  participant DB as PostgreSQL
  participant IDP as Identity Platform

  Browser->>API: POST /v1/auth/line/exchange {idToken, nonce}
  API->>DB: atomically consume global + token-fingerprint buckets
  alt rate limit exceeded
    API-->>Browser: 429 Problem Details + Retry-After
  end
  API->>LINE: raw id_token + channel ID + nonce (3s timeout)
  LINE-->>API: verified claims
  API->>API: verify iss/aud/exp/nonce/sub
  API->>DB: transaction find-or-create (LINE, subject)
  DB-->>API: local userId
  API->>IDP: createCustomToken(local userId) via ADC/signBlob
  IDP-->>API: custom token
  API-->>Browser: {customToken, expiresIn}; no cookie
  Browser->>IDP: exchange custom token for ID token
  Browser->>API: Authorization: Bearer ID token
  API->>IDP: verifyIdToken(checkRevoked=true)
  API->>DB: require ACTIVE local user
  API-->>Browser: tenant-scoped response
```

## Failure and logging contract

- Invalid/expired/wrong-audience token 或 nonce mismatch 回 401；LINE timeout/unavailable 回 503。
- Provider 前使用 PostgreSQL fixed-window global/token-fingerprint buckets；超限回 429 與 `Retry-After`，database unavailable 回 503且不呼叫 LINE。Bucket 只保存短期 SHA-256 digest，不保存 raw token、nonce、subject 或 IP。
- Identity Platform ID token invalid、expired、revoked、disabled/deleted user 回 401；certificate、permission、network、internal 或 unknown verifier failure 回 503。只有 401 應觸發 client reauthentication，503 應保留 session 並稍後重試。
- Firebase revocation check 不取代 PostgreSQL `User.status`；每次 authenticated request 仍須通過 local active-user authorization。
- log 只含 `requestId`、operation、outcome、provider latency；不得包含 raw token、nonce、LINE subject、email 或 profile。
- custom token 只存在 response body，不建立 cookie，也不寫入 log/audit/database。
- P1-015 的 global limit 不是 per-IP edge defense；正式大量導流前仍須依 ADR 0006 增加可信 load balancer／Cloud Armor policy。
