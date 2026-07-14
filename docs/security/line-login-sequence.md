# LINE login exchange sequence

```mermaid
sequenceDiagram
  participant Browser as External browser / LIFF
  participant API as Nook API
  participant LINE as LINE verify endpoint
  participant DB as PostgreSQL
  participant IDP as Identity Platform

  Browser->>API: POST /v1/auth/line/exchange {idToken, nonce}
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
  API->>IDP: verifyIdToken
  API-->>Browser: tenant-scoped response
```

## Failure and logging contract

- Invalid/expired/wrong-audience token 或 nonce mismatch 回 401；LINE timeout/unavailable 回 503。
- log 只含 `requestId`、operation、outcome、provider latency；不得包含 raw token、nonce、LINE subject、email 或 profile。
- custom token 只存在 response body，不建立 cookie，也不寫入 log/audit/database。
