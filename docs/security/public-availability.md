# Public availability security contract

## Trust boundary

公開 endpoint 不需登入，但 slug、service ID、staff ID、日期與天數都視為不可信輸入。Tenant 與 timezone 只能由 server-side published merchant projection 決定，client 不能傳入或覆寫。

## Enumeration and privacy

- 未發布／不存在 slug、inactive 或跨 tenant service、無效或未 assignment staff 一律回相同 404 Problem Details。
- 合法查詢但沒有空檔回 200 與空 slots，這是必要的公開業務資訊。
- Repository select 與 response mapper使用明確 allowlist；排除 phone、完整私人地址、exception reason、object key、buffer、occupancy 與 tenant ID。
- Missing booking policy 是 server invariant failure：回通用 503並只記 structured safe identifiers，不在 log 放客戶或排班內容。

## Integrity boundary

Availability 是無副作用、可安全重試的 point-in-time calculation。`reservation` 永遠為 `false`；Web 選取只存在 React memory，不寫 cookie/storage、不建立 hold，也不能作為預約所有權證明。真正防撞必須由後續 PostgreSQL transaction 與 constraint 完成。

## Web proxy

Browser 使用同源 `/api/marketplace/{slug}/availability`；Web server重新驗證 strict query後才轉送內部 API origin。此路由不轉送 cookie、Authorization 或任意 request header，且 response 不快取，避免把 Studio credential帶入公開請求。
