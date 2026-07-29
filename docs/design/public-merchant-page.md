# Public merchant page design handoff

## Intent

公開頁不是後台 dashboard，而是店家的微型 editorial storefront。視覺採暖米紙、深墨與少量朱紅，作品用不對稱 contact-sheet 節奏，讓一人工作室看起來有作者感，但仍保留清楚的價格、時間、地點與政策。

## Routes and truthfulness

- `/m/{slug}`：server-side 讀 marketplace API；找不到、未發布或 API 不可用時回 not found，不渲染過期假資料。
- `/preview/merchant`：明示 `LOCAL PREVIEW`、使用 synthetic data、`noindex,nofollow`，用來在 browser identity 尚未完成前驗收 layout。
- 預約固定顯示「線上預約即將開放／Phase 3 將接上即時空檔」，不可呈現可送出的假 booking form。

## Responsive behavior

- Desktop：hero 左文右作品、service 雙欄、三張不同節奏作品。
- Tablet：hero 單欄、作品雙欄、visit 單欄。
- Mobile：單欄、縮短 hero、service facts 換行、fixed booking status bar；不得造成 horizontal overflow。

## Accessibility and privacy

保留語意 section／heading／list、可見 focus 行為與高對比 CTA。住家工作室顯示「完整地址將於預約成立後提供」；Web 不自行推算或顯示被 API 遮罩的地址。
