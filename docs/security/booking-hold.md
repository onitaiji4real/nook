# Booking hold security contract

## Identity and authorization

- Create 與 release 都要求由既有 LINE → Firebase exchange 驗證的 bearer principal；application service 只接收 principal `userId`。Request body 採 strict schema，只允許 `serviceId`、選填 `staffId` 與 UTC `startAt`。
- 店家會員身份不授權讀取其他 consumer 的 hold。Release repository 同時比對 `holdId` 與 `consumerUserId`；未知 ID、跨 consumer ID 及格式不可接受的 ID 都使用 privacy-safe 404。
- Inactive global user 在進入 application write 前回 403。未登入回 401，不會先做 slug、slot 或 hold existence probe。

## Integrity and concurrency

- Server 重新讀取 published ACTIVE tenant、primary ACTIVE location、ACTIVE/booking-enabled service 與 staff、staff-service assignment、booking policy、weekly rules、exceptions 與未過期 occupancy，再跑同一 availability calculator。Client 不能指定 tenant、duration、buffer、price、expiry 或 consumer。
- 所有 create 判斷使用單一 PostgreSQL transaction timestamp。同 consumer／tenant 在第一個 snapshot 前取得 transaction advisory lock；換位的 release 與新 insert 同 transaction，任何失敗都 rollback 舊 hold。
- `booking_occupancies` 的 partial GiST exclusion constraint 是跨 Cloud Run instance 的最後一致性防線。Constraint conflict 對外只回 `slot_no_longer_available`，不回競爭者、hold 或 occupancy 資料。

## Idempotency and abuse controls

- `Idempotency-Key` 必須是 UUID。Server 只保存 SHA-256 hash；request fingerprint 同樣為不可逆 SHA-256。相同 key／payload 回原 ID、原 expiry 與 current status；若原row仍標為ACTIVE但已到期，先將hold與occupancy轉EXPIRED。不同 payload 回 409。
- Bearer authentication、user status及key UUID格式在attempt之前驗證，因此401／403與缺少或格式錯誤key的400不計數。有效key的rate attempt在booking transaction之前獨立提交，因此後續slug／body validation、catalog、slot或conflict的400／404／409不會免費繞過限制。每 consumer／10 分鐘最多 10 個 distinct keys；429 帶 `Retry-After`。不以 IP、email、電話或 LINE subject 作 bucket。
- Structured logs 只允許 `requestId`、operation、outcome、safe entity ID 與 aggregate count。Bearer、raw idempotency key、fingerprint input、customer profile、完整地址、價格 payload、例外原因與 notes 不得寫入 log。

## Response and browser boundary

- Response 是 strict public allowlist：hold ID/status、`bookingState=HELD`、`appointmentCreated=false`、UTC service range、timezone、原 expiry、service snapshot 與公開 staff 摘要。禁止 tenant ID、consumer ID、buffer、occupied range、private address、contact、identity 或 internal policy。
- Configured Web 只有 ready consumer session 可呼叫 API；not-configured／degraded／loading狀態會顯示原因並停用hold操作，不能形成可點但無反應的假CTA。Token只在request當下由Firebase取得，不寫URL或Web Storage。LOCAL PREVIEW使用本機memory模擬並明示不寫正式database。
- Countdown 是 server `expiresAt` 的顯示，不是授權來源。即使 client clock 或畫面停滯，database 仍以 transaction time 決定有效性。

## Worker boundary

`POST /internal/booking-holds/expire` 只能部署在 private Cloud Run worker。Cloud Run IAM 驗證 automation service account 的 Google-signed OIDC token才是身份邊界；`x-cloudscheduler: true` 只是 defense in depth，不能在 public ingress 上單獨視為 authentication。Operation 每批最多 100 筆、可安全重試，且不修改非 ACTIVE rows。
