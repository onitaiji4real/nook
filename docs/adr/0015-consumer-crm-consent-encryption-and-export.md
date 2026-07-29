# ADR 0015：Consumer CRM、同意證據、加密筆記與匯出邊界

狀態：Accepted for repository implementation；production activation gated
日期：2026-07-28

## Context

店家需要以真實預約關係查看顧客與服務紀錄，但「履行預約／客服」不等於「可以發送行銷」。若把預約成立直接當成行銷同意，或讓店家代替consumer勾選，會失去可驗證的目的、文案版本與撤回證據。另一方面，顧客投影、自由文字筆記及完整匯出都會集中PII；重播事件、改期鏈、跨tenant ID猜測、明文暫存或長效下載連結都會放大風險。

Phase 4尚未核准最終retention、行銷文案、KMS key與production incident owner。Repository可以先建立fail-closed資料模型與adapter，但不得因程式完成而自動啟用production notes、tags、marketing或export。

## Decision

- `customer`是tenant內的營運read model，以`tenant_id + consumer_user_id`唯一。只有server驗證的appointment第一次進入`CONFIRMED`時建立關係；browser、匯入檔或店家操作不能任意建立。取消或改期後仍保留既有營運關係。統計永遠由appointment current truth重算，不累加event delta。
- `COMPLETED` effective leaf才計一次visit，`NO_SHOW` effective leaf才計一次no-show。取消不計數；A→B→C改期鏈只以root的current effective leaf計算。`first_visit_at`／`last_visit_at`取已完成leaf的service `start_at`。沒有server-owned final settlement時`total_spent`固定為unknown，不保存推算值。
- 行銷目的第一版只有`MARKETING_MESSAGES`。Consent document是platform-owned、immutable、versioned文案；consumer只可對目前ACTIVE版本自行grant或withdraw。店家與管理員沒有代grant endpoint。新文案版本啟用時，舊grant保留為證據但eligibility立即false，直到consumer明確接受新版本。
- 每個`tenant + consumer + purpose`使用transaction內row lock、正整數`revision`與immutable event形成唯一順序。Grant與withdraw都帶expected revision及idempotency key。Concurrent withdrawal若先輸掉CAS，server在同一command內對最新revision重試並寫入withdraw；concurrent grant若看到withdraw或revision conflict則409且不得自動重試，因此withdrawal優先。相同idempotency key只可重播exact command/result。Grant event另保存server-rendered tenant display identity snapshot及evidence hash，不能只靠之後可變的tenant名稱。
- Marketing current state由event stream及ACTIVE document version衍生：`NOT_GRANTED | GRANTED | WITHDRAWN | SUPERSEDED`。P4-001所稱「停止利用」只涵蓋此purpose-specific marketing withdrawal；廣義operational restriction、DSAR、刪除與匿名化屬P5-002。Withdraw在尚無stream時固定404且不建立event；latest已是WITHDRAWN時exact或新key皆回現況、不增加revision；SUPERSEDED仍可新增WITHDRAWN evidence；沒有ACTIVE document不妨礙既有stream withdraw。Withdrawal commit後，所有eligibility read、future marketing enqueue與export中的eligibility欄位立即反映false；營運CRM read/write/export仍只依履約目的與tenant RBAC，不取消既有appointment，也不刪除履約資料。
- Consent get/grant只在server能證明tenant曾有該consumer的CONFIRMED appointment或已有consent stream時存在；grant另要求tenant ACTIVE及目前ACTIVE document。Relationship projection延遲時，application直接以tenant+consumer appointment current truth驗證，不依賴customer row。Withdraw只要求既有stream，即使customer投影、tenant或關係後續不可用仍保持可執行。
- 第一版contact不從LINE subject/profile、appointment notes、地址或店家輸入推測phone/email。Customer display label可讀既有`User.display_name` current truth；phone/email保持null，直到另有consumer-owned verified contact ADR/API。List不回contact；detail也只回明確verified來源。
- Notes使用application envelope encryption：每筆隨機AES-256-GCM DEK、nonce與auth tag；Google Cloud KMS KEK只wrap/unwrap DEK。AAD UTF-8 bytes固定為JSON array `["nook-customer-note-aad-v1",environment,tenantId,customerId,noteId,1]`，不得增減欄位、改序或以object重編碼。資料庫只存ciphertext、wrapped DEK與key resource version；KMS unavailable、provider disabled或metadata不完整一律fail closed，絕不降級明文。Node adapter使用固定版本`@google-cloud/kms`官方client及`fast-crc32c`驗證KMS request／response CRC32C；後者只採pure-JS fallback，pnpm明確禁止其optional legacy native build。
- Key rotation對新寫入立即使用current KEK；既有note以bounded background rewrap DEK，不需重加密ciphertext。失敗保留舊wrapped DEK並可重試；不能刪除仍被引用的key version。
- CRM export採非同步job。Worker在一個read-only REPEATABLE READ transaction取得一致`asOf`，並受120秒處理、10,000 customers、50,000 notes、100,000 tag links、200 MiB uncompressed、50 MiB compressed及512 MiB temporary disk硬限制；超界以`export_too_large`失敗，不產生部分檔。Cloud Task body只有job ID。
- Artifact是UTF-8 ZIP，固定包含versioned `customers.csv`、`consents.csv`、`notes.csv`、`tags.csv`。Consent檔只含customer current coarse state，不提供immutable evidence detail。Job claim使用token、lease、attempt及CAS；每次attempt寫獨立object，舊worker不能覆寫或完成新claim。
- Consent transition會增加tenant privacy watermark；active document切換會改變global document generation。Export capture兩者，完成及download時若不相等就把job撤銷，因此舊READY或進行中artifact不會在withdrawal／supersede後繼續簽新URL。
- Artifact保存於private object storage、ready後15分鐘到期；request與download都要求verified principal的`auth_time`在5分鐘內，否則回`reauthentication_required`。Download endpoint另重驗ACTIVE OWNER／MANAGER及tenant，回應最多60秒single-purpose signed URL並設`Cache-Control: private, no-store`。Requester或OWNER可立即阻止新download authorization並best-effort刪物件；已簽出的bearer URL有最多60秒residual window，UI與audit不得宣稱零秒撤銷。Job metadata保留天數仍待legal核准，production功能在核准前disabled。
- Notes/export採既有GCS與新增Cloud KMS adapter。KMS capability、IAM exact scope、key custody與rotation需在Terraform activation commit中以本ADR及runbook驗證；repository不建立key material、不輸出key URI或signed URL。`@google-cloud/kms`會帶入Google gRPC/auth dependency tree，增加供應鏈與runtime體積；因此版本固定於lockfile、CI執行既有dependency policy，且只有`CRM_NOTES_MODE=active`才建立client。CRC32C mismatch、timeout或provider錯誤一律視為不可用，不能跳過完整性檢查。
- Tag值只可在owner核准taxonomy後啟用；v1 schema仍限制NFKC後1..32字元、禁止控制字元與敏感分類。核准前API回`feature_disabled`，不得先以自由字串落庫。

## Consequences

- CRM能服務預約營運，又不把商業關係誤當行銷授權；撤回與文案升版都有可重播證據。
- Current-truth recompute比delta counter成本高，但能讓事件重播、取消與改期不重複計數；projection可依customer stream局部重算。
- Notes與匯出需要KMS、private object、cleanup及incident流程；外部owner未核准時，功能保持關閉而不是以弱化方案先上線。
- Google KMS client及其transitive dependencies增加image大小與更新責任；每次升版需重跑CRC32C、timeout、rotation、tamper、container與dependency-policy evidence。
- 第一版contact資料較少，但避免把LINE或預約資料轉作未告知用途；未來若新增verified contact，需獨立source與authorization contract。

## Rejected alternatives

- 預約成立自動grant marketing：混淆履約與行銷目的，consumer也無法證明接受哪個版本。
- 店家代grant或匯入consent：缺乏consumer authentication與可信來源。
- 以event delta累加visit/no-show：replay、取消或A→B→C改期容易重複。
- 從LINE profile或預約內容推測聯絡方式：來源與目的不明，也無verified current truth。
- Notes先存明文、之後再加密：會留下migration、backup與log中的永久風險。
- 省略CRC32C驗證或啟用`fast-crc32c`舊native addon：前者失去KMS傳輸完整性evidence，後者增加未必要的native build與供應鏈面；採官方欄位驗證加pure-JS fallback。
- 同步回傳完整CSV或長效public URL：request timeout、PII授權與撤銷都不可控。

## References

- [Google Cloud KMS symmetric encrypt/decrypt](https://cloud.google.com/kms/docs/encrypt-decrypt)
- [Google Cloud KMS RPC contract](https://cloud.google.com/kms/docs/reference/rpc/google.cloud.kms.v1)
