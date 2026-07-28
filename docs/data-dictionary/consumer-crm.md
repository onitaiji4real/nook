# Consumer CRM data dictionary

P4-001以tenant-scoped read model保存營運顧客關係，以immutable evidence保存行銷同意，以envelope metadata保存加密筆記。所有timestamp存UTC，所有tenant-owned foreign key包含`tenant_id`，所有idempotency key只存SHA-256。

## `customers`

- `id`：UUID primary key。
- `tenant_id`、`consumer_user_id`：composite unique；`consumer_user_id`指向authenticated local User。
- `relationship_started_at`：建立customer時從該tenant+consumer所有既有appointment取最早`confirmed_at`；同一次recompute看見全部歷史，建立後不可改。取消／改期不清除。
- `first_visit_at`、`last_visit_at`：nullable，取COMPLETED effective leaf的`start_at` min/max。
- `completed_visit_count`、`no_show_count`：non-negative integer；由appointment current truth重算。
- `projection_version`：positive integer，P4-001固定1；演算法變更需升版及backfill。
- `projected_through_event_id`、`projected_at`：最後成功觸發重算的appointment outbox trace與database time，不當作全域cursor。
- `created_at`、`updated_at`。

不建立`total_spent`、phone、email、LINE subject/profile snapshot或自由文字contact欄。沒有final settlement時API回`totalSpent: null`及`spendStatus: UNKNOWN`。

主要index：unique tenant+consumer、tenant+createdAt+relationshipStarted+id。List固定`relationship_started_at DESC, id DESC`，後續頁另要求`customer.created_at <= cursor.asOf`；Customer ID單獨不是authorization key。

## `crm_projection_deliveries`

- `projector`：固定`consumer_crm_v1`；與`outbox_event_id`形成primary key。
- `outbox_event_id`：指向shared appointment outbox。CRM不讀或修改outbox的`status/attempt_count`，因此不與notification projector競爭。
- `tenant_id`、`consumer_user_id`、`appointment_id`、`customer_id`：安全trace IDs；前三者必填，customer在NO_RELATIONSHIP可null。
- `status`：`PENDING | PROCESSING | PROJECTED | TERMINAL`。
- `claim_token`、`lease_expires_at`：PROCESSING必填；worker只可用exact token CAS完成或退回。
- `attempt_count`、`next_attempt_at`：最多10次retryable infrastructure attempts，exponential backoff上限1小時。第10次仍失敗或lease過期後保持`PENDING`、`safe_code=retry_exhausted`且不再自動claim；它不是資料invariant corruption、不得block stream，也不是可清理checkpoint。監控告警並完成root-cause修復後，只能用exact tenant+consumer+delivery confirmation將attempt歸零重試。
- `outcome`：terminal result為`PROJECTED | NO_RELATIONSHIP | INVARIANT_CORRUPTION`。
- `projected_at`、`safe_code`、timestamps。

Dispatcher掃描所有outbox status的六種exact event type：`appointment.confirmed.v1`、`appointment.cancelled.v1`、`appointment.rescheduled.v1`、`appointment.checked_in.v1`、`appointment.completed.v1`、`appointment.no_show.v1`。它以`INSERT ... ON CONFLICT DO NOTHING`建立delivery，再claim due PENDING/expired PROCESSING；不消費shared status。

每筆delivery transaction依delivery的tenant+consumer upsert並鎖`crm_projection_streams`；BLOCKED時不claim後續delivery。ACTIVE才驗證root chain並從appointments current truth重算該customer全部aggregates。Database/timeout等retryable failure退回PENDING；chain cycle、cross-tenant link或multiple effective leaves會在同transaction將delivery標TERMINAL/INVARIANT_CORRUPTION並把stream標BLOCKED。只有修復資料及具名runbook操作可重置。PROJECTED/TERMINAL都是replay checkpoint。

Backfill以`appointments.created_at,id`固定cursor找曾CONFIRMED的tenant+consumer，寫入獨立`crm_backfill_checkpoints(projector,cursor_created_at,cursor_id,status,updated_at)`並呼叫相同recompute；不得直接寫counter。Outbox資料清理前必須確認所有registered projector皆為PROJECTED/TERMINAL；P4 migration要先為既有六種event補delivery再允許cleanup。

Backfill遇到blocked stream或chain invariant時把checkpoint標`FAILED`並停止，不越過失敗relationship。修復資料／stream後，operator必須帶checkpoint目前的exact cursor（尚未前進時為`none`）及明確confirmation才能resume；`COMPLETED` checkpoint不因之後的新appointment重開，之後的即時變更由outbox delivery負責。

## `crm_projection_streams`

- `projector`、`tenant_id`、`consumer_user_id`：composite primary key。
- `status`：`ACTIVE | BLOCKED`。
- `blocked_delivery_id`、`safe_code`：BLOCKED必填，指向第一個未修復的TERMINAL delivery。
- `updated_at`。

每次recompute先鎖stream；BLOCKED時後續delivery保持PENDING且不改customer，避免越過corrupt event形成假current truth。只有具名repair runbook驗證appointment invariant並把原delivery重置PENDING後，才能原子清BLOCKED。Monitoring以blocked stream aggregate count告警，不使用tenant/consumer metric label。

## `consent_documents`

- `id`：UUID primary key。
- `purpose`：P4-001只允許`MARKETING_MESSAGES`。
- `version`：bounded semantic label，purpose+version unique。
- `locale`：第一版`zh-TW`。
- `content_sha256`：canonical文案hash。
- `content_text`：核准後的immutable文案；含PII處理目的、channel、撤回方式。
- `status`：`DRAFT | ACTIVE | RETIRED`；每purpose最多一個ACTIVE。
- `document_generation`：platform-wide monotonic bigint；每次ACTIVE document切換增加，供export invalidation。
- `active_from`、`retired_at`、`created_at`。

未經legal/product owner核准不得把DRAFT切ACTIVE。修改文字必須新version，不能update既有row。

## `consumer_consent_streams`

- `tenant_id`、`consumer_user_id`、`purpose`：composite primary key。
- `current_revision`：non-negative integer；0代表尚無event。
- `current_event_id`：nullable unique。
- `updated_at`。

每次transition以row lock配置`current_revision + 1`。Stream是linearization point，不以client time排序。

## `consumer_consent_events`

- `id`：UUID primary key。
- `tenant_id`、`consumer_user_id`、`purpose`、`revision`：stream identity；composite unique。
- `event_type`：`GRANTED | WITHDRAWN`。
- `consent_document_id`：grant必填且必須是command時ACTIVE版本；withdraw指向被撤回的current grant document。
- `source`：grant第一版只允許`CONSUMER_WEB`；withdraw允許`CONSUMER_WEB | SUPPORT_VERIFIED_REQUEST`，後者需另有核准runbook才啟用。
- `actor_user_id`：consumer self route必須等於consumer；不可由tenant member代grant。
- `tenant_display_name_snapshot`：GRANTED必填，server將grant當下tenant current name先NFC、trim後取得1..120字元；WITHDRAWN固定null。不信任request body。
- `rendered_evidence_schema`：GRANTED固定`nook-consent-evidence-v1`；WITHDRAWN固定null。
- `rendered_evidence_sha256`：GRANTED必填；WITHDRAWN固定null。Canonical bytes是下列八個UTF-8 string組成的JSON array，順序固定為`[schema,purpose,tenantId,tenantDisplayName,documentId,documentVersion,locale,contentSha256]`，使用compact RFC 8259 JSON、無BOM/whitespace、`/`不escape、非ASCII直接UTF-8、control/quote/backslash使用小寫`\u00xx`或標準`\" \\ \b \f \n \r \t`；最後計SHA-256 lowercase hex。
- `occurred_at`：database timestamp。
- `command_id`：指向建立此event的consent command，unique；no-op withdraw沒有event。
- `request_id`、`created_at`。

Current state衍生規則：

- 沒有grant：`NOT_GRANTED`。
- 最新event是withdraw：`WITHDRAWN`。
- 最新event是grant，但document不是目前ACTIVE版本：`SUPERSEDED`。
- 最新event是grant且document是目前ACTIVE版本：`GRANTED`，marketing eligible true。

新document啟用不需改寫歷史event；eligibility join立即讓舊grant變`SUPERSEDED`。

Canonical test vector：

```text
["nook-consent-evidence-v1","MARKETING_MESSAGES","00000000-0000-4000-8000-000000000001","範例美甲店","00000000-0000-4000-8000-000000000002","2026-07-28.v1","zh-TW","0000000000000000000000000000000000000000000000000000000000000000"]
SHA-256 = 39ba7498efff4f6ce8968608705a28131151cc9956c9ce6b1d23305f72438e2a
```

Transition exact behavior：

- 無stream的get/grant先查tenant+consumer是否存在曾CONFIRMED appointment；不存在固定404。Projection lag不能阻擋已確認關係。
- Grant要求tenant ACTIVE、ACTIVE document及`expectedRevision=currentRevision`；latest WITHDRAWN/SUPERSEDED可由consumer明確re-grant。
- 無streamwithdraw固定404、不建立stream。Latest GRANTED或SUPERSEDED寫新WITHDRAWN event；latest WITHDRAWN回原state且不增加revision。沒有ACTIVE document或tenant非ACTIVE都不能阻擋既有stream withdrawal。
- Consent incident gate只停grant；get與withdraw在schema部署後保持可用。

## `consumer_consent_commands`

- `id`：UUID primary key。
- `tenant_id`、`consumer_user_id`、`purpose`、`idempotency_key_hash`：composite unique。
- `command_type`：`GRANT | WITHDRAW`。
- `request_fingerprint_sha256`：涵蓋command type、document ID nullable及client expected revision。
- `result_event_id`：nullable；latest已WITHDRAWN的no-op withdraw為null，其餘指向event。
- `result_revision`、`outcome=APPLIED | NOOP_ALREADY_WITHDRAWN`：第一次command的immutable execution evidence；不保存或重播可能過期的eligibility/current state。
- `request_id`、`created_at`。

所有command先完成current authentication/authorization，再查command ledger。Same key+same fingerprint不重新執行command，即使之後re-grant也不會再次withdraw；same key+different fingerprint固定409。HTTP response每次都在command/replay判定後，由latest event stream與目前ACTIVE document重新計算`MarketingConsentState`，eligibility永遠是current truth，不重播舊GRANTED。新key repeated withdrawal在同一transaction寫一筆no-op command evidence但不增加stream revision。

## `tenant_crm_privacy_versions`

- `tenant_id`：primary key。
- `consent_watermark`：non-negative bigint；每筆GRANTED/WITHDRAWN event在同transaction加1。
- `updated_at`。

`consent_documents`另有platform-wide monotonic `document_generation`，ACTIVE document切換時增加。Export capturetenant watermark與global generation；完成與download必須重讀相等。

## `customer_notes`

- `id`、`tenant_id`、`customer_id`。
- `ciphertext`、`nonce`、`auth_tag`：AES-256-GCM bytes；不允許text型plaintext欄位。
- `wrapped_dek`：Cloud KMS wrap後bytes。
- `kek_resource_version`：approved allowlist中的exact KMS CryptoKeyVersion resource。
- `encryption_schema_version`：P4-001固定1。
- `created_by_membership_id`、`created_at`、`updated_at`。

AAD不另存自由文字，依固定欄位重建。Note plaintext 1..2000 Unicode code points，僅在authorized request記憶體存在；不得進audit、exception、task或metrics。每customer最多100 notes；create使用customer row lock計數，超限回409。Detail固定`created_at DESC,id DESC`回全部notes，不截斷。

## `customer_tag_definitions`與`customer_tag_links`

- Definition：`id`、`tenant_id`、`normalized_name`、`display_name`、`status=ACTIVE | INACTIVE`、timestamps；tenant+normalized name unique。每tenant最多100 definitions；name immutable，停用後保留歷史link但不可新增link。
- Link：`tenant_id`、`customer_id`、`tag_id` composite primary key、`created_by_membership_id`、`created_at`。
- Name先NFKC、trim，1..32字元，禁止Unicode control/format字元。Approved taxonomy及敏感分類deny policy未核准前，runtime完全disabled。
- 每customer最多50 links；以customer row lock計數。Composite foreign keys阻止cross-tenant link。Audit只記tag ID，不記名稱。

## `customer_export_jobs`

- `id`、`tenant_id`、`requested_by_membership_id`。
- `status`：`PENDING | PROCESSING | READY | FAILED | EXPIRED | REVOKED`。
- `idempotency_key_hash`、`request_fingerprint_sha256`：tenant+actor範圍unique；exact retry回同job。
- `format_version`：P4-001固定`crm-export-v1`。
- `as_of`：worker read-only REPEATABLE READ transaction的database timestamp。
- `consent_watermark`、`document_generation`：claim時snapshot；完成/download不相等即REVOKED。
- `attempt_count`：non-negative，最多3次。
- `claim_token`、`lease_expires_at`：PROCESSING必填；claim lease 3分鐘，application hard timeout 120秒。只有exact token可heartbeat/finalize。
- `customer_count`、`note_count`、`tag_link_count`、`uncompressed_bytes`、`compressed_bytes`：nullable，READY時有值且分別<=10,000／50,000／100,000／200 MiB／50 MiB。
- `object_key`：nullable、不可回client或寫log；server固定為tenant/job/claim-token derived，不能接受browser值。
- `object_generation`：nullable GCS generation；delete必須用generation-match。
- `artifact_sha256`：nullable integrity evidence。
- `expires_at`：READY時`ready_at + 15 minutes`。
- `ready_at`、`revoked_at`、`failed_at`、`safe_code`、timestamps。

PENDING以row lock claim PROCESSING並產生新UUID token；attempt寫獨立`tenant/job/claim-token.zip`且create用`ifGenerationMatch=0`。Expired lease可由新token建立新object；舊worker無法通過job token/watermark CAS成READY。Attempt #1/#2 retryable回PENDING；#3、bound、schema或KMS terminal failure轉FAILED。READY/FAILED/EXPIRED/REVOKED不自動重開；相同client idempotency key只回原job。

ZIP只含以下UTF-8 with BOM、RFC 4180 CSV，timestamp為canonical UTC毫秒`YYYY-MM-DDTHH:mm:ss.SSSZ`，null為空欄，UUID小寫canonical：

- `customers.csv`：`customer_id,display_name,relationship_started_at,first_visit_at,last_visit_at,completed_visit_count,no_show_count,spend_status`
- `consents.csv`：`customer_id,purpose,state,eligible,active_document_version,last_changed_at`；NOT_GRANTED為空，GRANTED/WITHDRAWN取latest event `occurred_at`，SUPERSEDED取current ACTIVE document `active_from`。
- `notes.csv`：`note_id,customer_id,content,created_at,updated_at`
- `tags.csv`：`tag_id,customer_id,tag_name,status,linked_at`

Customers/notes依各自主ID ASC；consents依customer ID ASC；tags依`customer_id ASC,tag_id ASC`。Consents只輸出export snapshot的current coarse state，不輸出immutable event、actor、source、tenant identity snapshot或evidence hash。CSV injection-sensitive值若以`= + - @`開頭，輸出時前置單引號；下載者仍應視為不可信資料。Artifact不含LINE subject、raw event、KMS metadata、internal object key、signed URL或audit actor PII。
