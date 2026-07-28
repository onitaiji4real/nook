# Consumer CRM、consent與export design

## Merchant experience

`/studio/customers`提供390×844與desktop可用的bounded list，固定依`relationshipStartedAt DESC,id DESC`分頁。第一次回應的database `asOf`與last key編進cursor；後續頁只納入`customers.createdAt<=asOf`，因此首頁之後才完成的projection/backfill不會插入舊分頁。Customer首次建立時從全部既有appointment固定最早confirmedAt，sort key之後不變。預設只顯示顧客名稱、首次關係、最近完成服務、完成／未到店次數、coarse行銷狀態／active文案version及已核准tag；沒有完成服務時顯示「尚無完成紀錄」，金額顯示「尚無可確認消費金額」而非0。

Detail route另取PII及解密notes。VIEWER/STAFF看不到入口；role在request時失效要清除畫面state並導回studio。切換tenant或登出會銷毀customer、note與download state。

## Relationship projection

1. Appointment進入CONFIRMED的transaction已有versioned outbox。CRM掃描六種exact appointment event，不讀寫notification使用的shared `outbox.status/attempt_count`。
2. Dispatcher為每個event upsert `(consumer_crm_v1,outboxEventId)` delivery（含tenant+consumer），再以`SKIP LOCKED LIMIT 1`及claim token/lease取得PENDING或expired PROCESSING delivery；BLOCKED stream的delivery不在candidate中。
3. Worker upsert/lock tenant+consumer projection stream，再重讀appointment root/direct links。第一次可信CONFIRMED會從全部既有appointments取最早confirmedAt建立customer；取消／改期不刪既有relationship。Invariant corruption會在同transaction把delivery TERMINAL及stream BLOCKED，後續event不越過它。
4. 同一transaction鎖customer後，查該tenant+consumer的appointment roots及每條current effective leaf；COMPLETED leaf形成visit，NO_SHOW leaf形成no-show，其餘不計。
5. 以查詢結果完整覆寫counts/min/max，再以exact claim token將delivery標PROJECTED。Retryable failure退PENDING；invariant corruption標TERMINAL並停止該stream，不能靜默跳過。
6. Backfill以`createdAt,id`走訪曾CONFIRMED的關係，保存獨立cursor並呼叫相同recompute。中斷從cursor續跑；版本升級建立新projector name，不重解釋舊checkpoint。

任何chain cycle、跨tenant link、兩個current leaf或缺consumer都標safe failure並停止該stream，不猜測修復。

## Consent state machine

```text
NOT_GRANTED -- consumer grant active version --> GRANTED
GRANTED ----- consumer withdraw -------------> WITHDRAWN
GRANTED ----- active document changes -------> SUPERSEDED
WITHDRAWN --- explicit new consumer grant ----> GRANTED
SUPERSEDED -- grant new active version -------> GRANTED
SUPERSEDED -- consumer withdraw -------------> WITHDRAWN
```

- Grant form顯示完整ACTIVE `zh-TW`文案、version及撤回方式；server不信任client回傳的文字或hash，只接受document ID並重讀ACTIVE row。
- Command傳`expectedRevision`與`Idempotency-Key`。Exact retry不重做command並保留原event/outcome evidence，但HTTP每次由latest stream與ACTIVE document重算current state，不能在後續withdraw後重播過期的`eligible=true`；same key不同fingerprint回409。
- 同時grant/withdraw時，withdraw可在CAS失敗後針對latest revision重試；grant遇到revision變更或latest withdraw固定409，UI必須重新顯示current state，由consumer再次明確確認。
- 新文案ACTIVE後舊grant在read時為SUPERSEDED；不靠batch更新才能停止marketing。
- 無stream的get/grant只在存在曾CONFIRMED appointment時成立；application可直接驗appointment，不能因customer projection lag拒絕。無streamwithdraw固定404。Latest WITHDRAWN再次withdraw是無新event的200 replay；SUPERSEDED withdraw新增evidence。Tenant inactive或沒有ACTIVE document不阻擋既有stream withdraw。
- Incident/config只可關閉grant；state read與withdraw endpoint在migration部署後永遠保持可用。

## Notes flow

Create/update application service先驗tenant role，產生note ID、DEK與nonce，以固定AAD加密並呼叫KMS wrap DEK；最後在短transaction內重新驗權限、鎖customer、檢查100 notes上限並寫cipher envelope及safe audit，避免在database lock期間呼叫外部KMS。任一步失敗都不寫row。Update要求`expectedUpdatedAt` CAS並使用全新DEK/nonce；衝突回409。Read先驗權限，固定`createdAt DESC,id DESC`最多且恰可回100筆，再unwrap/decrypt；invalid metadata或tag回安全503，不回部分內容。

Update使用新的DEK/nonce/ciphertext並保留同note ID；不重用nonce。Delete移除envelope並寫safe audit。Task、outbox與audit永遠不承載plaintext。

## Export lifecycle

1. OWNER/MANAGER完成近5分鐘內的identity reauthentication後，以`POST`空body與idempotency key建立PENDING job，回202；舊token回`reauthentication_required`。
2. Private worker只收jobId，以row lock將PENDING／expired PROCESSING claim為PROCESSING，產生UUID token、3分鐘lease並增加attempt（最多3次）；重驗tenant及requester仍有資格。
3. Worker開一個read-only REPEATABLE READ transaction，以database timestamp為`asOf`並capture tenant consent watermark/global document generation。它在120秒內逐批讀current truth、authorized decrypt notes，產生固定四個CSV。超過10,000 customers、50,000 notes、100,000 tag links、200 MiB uncompressed或512 MiB temp disk立即fail。
4. ZIP不得超過50 MiB。每attempt以`ifGenerationMatch=0`寫獨立claim-token object；upload後驗sha256。Final transaction以job ID+claim token CAS並重讀兩個privacy versions；任一已變就REVOKED，完全相等才READY且`expiresAt=database now+15m`。舊worker不能完成新claim。
5. Browser poll status；download endpoint再次要求近5分鐘`auth_time`並重新驗tenant role、watermark/generation、READY、TTL與object generation後，才產生<=60s URL。畫面不保存URL，觸發下載後立即清除state。
6. Expiry/revoke先讓DB拒絕新authorization，再以generation-match bounded delete object。已簽URL仍可能存活最多60秒。Retry看到READY/FAILED/REVOKED/EXPIRED不重建；attempt #1/#2 retryable回PENDING，#3失敗轉FAILED，stale attempt object由cleanup刪除。

## Fail-closed surfaces

- 未核准legal文案：consent document無ACTIVE，grant回`consent_not_active`。
- KMS/provider未啟用：notes與包含notes的export回`feature_disabled`，不建立明文替代。
- Tag taxonomy未核准：tag endpoints回`feature_disabled`。
- Export storage/cleanup未核准：request回`feature_disabled`。
- 以上都不影響既有booking、appointment list或consumer withdrawal。
