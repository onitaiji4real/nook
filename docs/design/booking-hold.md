# Booking hold design handoff

## Experience contract

候選時段仍是 point-in-time suggestion。顧客選取後，主要操作必須寫「保留 10 分鐘」而非「完成預約」；建立成功顯示一張 `HELD · 尚未建立預約` ticket，包含公開服務、人員、店家當地時間、價格 snapshot 與依 server expiry 計算的倒數。

Configured flow 必須先完成 consumer LINE/Firebase session。尚未登入時提供明確登入提示，不把 disabled button 當 authentication。LOCAL PREVIEW 只模擬 10 分鐘倒數並固定標示「不會寫入正式資料庫」。

Runtime config載入、LINE登入進行中、尚未設定及identity service degraded各有明確CTA文字；不能操作時按鈕disabled且相鄰`role=alert`解釋原因，不能保留一顆可點但沒有結果的按鈕。

## State model

- `idle`：尚未查詢，沒有 hold CTA。
- `available`：可選候選時段；選取仍顯示「尚未保留」。
- `creating`：鎖定重複 submit，顯示正在確認最新空檔。
- `held`：顯示原始 server expiry 倒數與 release；不顯示預約編號、完成通知或完整地址。
- `replacing`：既有 ticket 保持可見，新時段成功後才原子替換；409 時舊 hold 仍應保留。
- `conflict`：說明時段剛被保留並要求重新查詢，不揭露他人資訊。
- `rate-limited`：依 `Retry-After` 告知稍後重試，不自動狂重送。
- `expired`：倒數到零後停止宣稱有效，要求重新選時段。
- `released`：明示已釋放；候選可重新查詢。Release retry 仍維持同一 UI 結果。

Idempotency key 在一次尚未成功的 create intent 期間保持不變；成功後新選擇使用新 UUID。Network retry 不得產生第二個 hold或延長倒數。

## Accessibility and responsive QA

狀態容器使用 `aria-live=polite`，conflict／rate／auth錯誤使用 `role=alert`；時段 button 保留 `aria-pressed`。倒數同時提供文字，不只靠顏色。Held ticket、release 與 replace action 在 390×844 單欄可觸及；fixed action bar 不遮住內容且頁面無水平溢位。Desktop 1280×800 保持 availability 雙欄與清楚的主次操作。

## Commercial truthfulness

Hold 不計入 `MAX_MONTHLY_BOOKINGS`、不觸發通知、付款或媒合費。只有 P3-003 confirmed appointment 才能稱為預約成立並寫 acquisition attribution；服務完成後才形成媒合費義務。這避免把短暫保留灌成店家使用量或營收。
