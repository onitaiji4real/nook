# Consumer CRM security與privacy contract

## Authorization matrix

| Operation                      | OWNER | MANAGER          | VIEWER/STAFF | Consumer self           |
| ------------------------------ | ----- | ---------------- | ------------ | ----------------------- |
| Customer bounded list/detail   | allow | allow            | deny         | deny                    |
| Notes read/write/delete        | allow | allow            | deny         | deny                    |
| Approved tags mutate           | allow | allow            | deny         | deny                    |
| Export request/status/download | allow | allow            | deny         | deny                    |
| Revoke any tenant export       | allow | own request only | deny         | deny                    |
| Coarse marketing state/version | allow | allow            | deny         | own tenant-purpose only |
| Consent evidence/event detail  | deny  | deny             | deny         | own current state only  |
| Marketing grant/withdraw       | deny  | deny             | deny         | own identity only       |

Tenant routes每次都重驗ACTIVE membership及role；consumer route只從verified bearer principal取user ID。Selected tenant、customer ID、export job ID、cursor與Cloud Task body都不是授權證據。Unknown與cross-tenant customer/note/tag/job固定404，非member或錯role固定403。

## Purpose separation與停止利用

- Appointment operational data只用於履約、客服與紀錄；不得用「已有customer row」推導marketing eligibility。
- P4-001的「停止利用」明定為撤回`MARKETING_MESSAGES`目的；不是廣義停止履約資料處理。廣義restriction/DSAR由P5-002 adjudicate，P4 API不得用模糊名稱假裝已完成。
- Marketing send/query必須在external call linearization前重讀ACTIVE consent document及latest stream event。`WITHDRAWN`、`SUPERSEDED`、unknown或provider unavailable都fail closed。
- Withdrawal commit後，不建立新的marketing jobs；已排程但尚未external-linearize的工作必須取消。已開始的外部request無法撤回，但要留下safe attempt evidence供incident review。
- CRM list/detail、operational notes/tags與tenant export仍可依履約目的及RBAC使用；export中的marketing eligibility必須為false。Marketing state只回coarse enum及文案version，不揭露其他tenant的關係。

## PII presentation與cache

- List allowlist：customer ID、營運用途display label、relationship/visit timestamps、completed/no-show counts、coarse marketing state/active document version、tag IDs/display labels。Display label是既有LINE-authenticated `User.display_name` current truth，明確允許用於該tenant的預約履約畫面與CRM export；不得延伸成LINE subject/avatar/profile snapshot或行銷資格。長度上限沿用User的120字元，缺值使用「顧客」中性fallback。不得回phone/email、notes、consumer user ID或其他LINE資料。
- Detail是獨立OWNER/MANAGER endpoint，才可回notes與未來verified contact；每次成功／拒絕都留safe PII access audit。
- 所有CRM、consent與export responses設`Cache-Control: private, no-store`；Web不得寫localStorage、sessionStorage、IndexedDB或service worker cache。
- Structured log/audit只允許requestId、operation、outcome、tenantId及safe customer/note/tag/job/event ID。不得記姓名、聯絡資料、note/tag值、consent文案、ciphertext、wrapped key、object key、signed URL、cursor或完整query URL。

## Encryption與key custody

- Note plaintext只在已授權application service記憶體中存在。每筆獨立DEK，AES-256-GCM，secure random 96-bit nonce；AAD exact canonical bytes綁定environment、tenant、customer、note及schema version。
- Cloud KMS CryptoKey只授權API runtime所需最小encrypt/decrypt；worker若只做export，需獨立exact key permission並在activation plan證明。Web、Cloud Tasks、Scheduler及CI沒有decrypt權限。
- Runtime config只接受`asia-east1` exact CryptoKey resource且不得指定version；encrypt response保存provider回傳的exact CryptoKeyVersion，unwrap先驗該version是configured CryptoKey的子資源，再以CryptoKey作`DecryptRequest.name`，由KMS依ciphertext選擇正確version。KMS request／response需通過CRC32C完整性驗證；timeout、disabled key、authentication failure、CRC mismatch、invalid tag或AAD mismatch回503/安全錯誤，不回cipher detail、不重試成明文。
- Rotation先切current version，再bounded rewrap。舊version在引用歸零及owner核准前不得destroy。疑似洩漏立即disable notes/export、保全metadata、依runbook rotate與重包。

## Export controls

- Request需`Idempotency-Key`，body不可包含customer IDs、filters或PII；v1固定全tenant CRM snapshot。Request及download都要求bearer token的verified `auth_time >= database now - 5 minutes`，過期回401 `reauthentication_required`，不以client timestamp或單純再次送同token冒充二次驗證。Cloud Task body exact `{jobId}`。
- Worker開始與完成前都重驗tenant/job nonterminal state、claim token、tenant consent watermark及active document generation。Artifact private、15分鐘，並套用10,000 customers、50,000 notes、100,000 tag links、200 MiB uncompressed、50 MiB compressed、512 MiB temp disk與120秒硬限制；超界失敗且以generation-match刪除partial object。
- Download endpoint在每次呼叫重驗ACTIVE OWNER/MANAGER、READY、not expired/revoked及object integrity，再簽最多60秒URL。URL不得進log/audit/referrer；response設`Referrer-Policy: no-referrer`。
- Revoke先transaction內改REVOKED，使後續download authorization立即404，再以generation-match刪object。已簽URL是bearer capability，可能在簽發後最多60秒內繼續使用；UI、support與audit必須揭露此residual window。Cleanup每分鐘bounded處理expired/revoked/stale-attempt objects；刪除失敗告警但不能恢復新URL eligibility。

## Abuse與negative tests

- Cursor限制512 bytes、exact version/keys及bounded limit<=100；payload固定`v,asOf,relationshipStartedAt,id`，列表固定`relationshipStartedAt DESC,id DESC`且只納入`customers.createdAt<=asOf`。Customer第一次投影會從全部既有appointments固定最早confirmedAt，之後不改sort key。任何篡改仍重套tenant predicate。
- Note 1..2000 code points；tag normalization、長度、control/format與sensitive taxonomy fail closed。
- 必測：OWNER/MANAGER allow、VIEWER/STAFF deny、removed membership、cross-tenant ID、consumer impersonation、grant/withdraw race、same-key mismatch、KMS unavailable、cipher/AAD tamper、expired/revoked download、signed URL不出log、CSV injection escaping。
- Production activation前需legal/product、security/platform及tag owner三組核准；缺任一項只允許migration與fake-provider tests。
