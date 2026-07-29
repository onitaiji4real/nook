# Nook marketing site design contract

狀態：v1
最後更新：2026-07-21

## 目的與轉換

首頁服務的第一受眾是台灣一人美甲、美睫與小型工作室。主要工作不是直接收單，而是讓訪客在短時間內理解：

1. Nook先解決店家反覆確認預約的營運成本。
2. 顧客從LINE或一般瀏覽器開始，不必下載App。
3. 店家自行帶來的顧客不抽成。
4. 方案與平台媒合收入分開，不能以模糊的「全包」承諾掩蓋訊息或金流成本。

正式conversion在early-access intake上線後才啟用。目前CTA只導向站內產品流程、價格與創始店家說明，不收集資料。

## 資訊架構

| 區塊             | 必須回答的問題                   | 狀態語意                          |
| ---------------- | -------------------------------- | --------------------------------- |
| Hero             | 這是誰的產品、解決什麼問題？     | 清楚標示仍在產品開發階段          |
| Flow             | 店家與顧客如何開始？             | 使用「設計目標」，不宣稱已上線    |
| Product map      | 預約前後涵蓋哪些能力？           | 明稱MVP產品藍圖                   |
| Pricing          | 為什麼付費、各級差異？           | 明稱產品規劃價                    |
| Attribution      | 什麼情況抽成？                   | 自帶0%；平台首次媒合8%、上限250元 |
| Founding studios | 早期合作交換什麼？               | 申請未開放、不先收個資            |
| FAQ              | LINE、抽成、訊息成本與launch狀態 | 不迴避限制或外部費用              |

## 視覺系統

方向是「預約簿×台灣街角工作室」的editorial interface，不使用典型粉紫漸層美容模板。

| Token          | 值                                          | 用途                           |
| -------------- | ------------------------------------------- | ------------------------------ |
| `--paper`      | `#f2eee5`                                   | 暖紙色主背景                   |
| `--ink`        | `#171713`                                   | 主文字、框線、深色區塊         |
| `--signal`     | `#f04f30`                                   | 重要訊號、CTA與價格區          |
| `--line-green` | `#06c755`                                   | LINE流程狀態，不作大面積品牌色 |
| `--acid`       | `#dbea6f`                                   | 媒合規則與確認訊息強調         |
| Display stack  | Iowan Old Style／Baskerville／Noto Serif TC | 編輯式標題與數字               |
| Body stack     | Avenir Next／Noto Sans TC／PingFang TC      | 內文與操作文字                 |

Logo是CSS三段垂直節奏與`nook`文字組合，避免在品牌尚未定稿時加入難以替換的bitmap資產。

## Responsive與accessibility

- Desktop以左右不對稱hero與後台示意建立產品感；820px以下改單欄。
- 560px以下方案卡改單欄、導覽保留品牌與Beta狀態，section CTA仍可抵達全部主要內容。
- 390px viewport不得產生document horizontal overflow；橫向商業原則strip可觸控捲動但隱藏視覺scrollbar。
- 所有互動使用原生link／details；保留skip link與`:focus-visible`，不以hover作唯一資訊來源。
- `prefers-reduced-motion`關閉非必要動畫與smooth scroll。
- 色彩不可是唯一狀態訊號；Beta與確認狀態同時使用文字。

## Copy與商業誠信規範

- 未上線功能只能稱「產品藍圖」、「設計目標」或「規劃」。
- 未正式核准價格必須相鄰顯示規劃價狀態。
- 不建立無後端、會丟失資料或假裝成功的表單。
- 不使用虛構店家數、預約量、轉換率、媒體logo或testimonial。
- LINE商標只描述入口與整合策略，不暗示Nook由LINE官方背書。
- 正式收集early-access資料前，必須先有privacy notice、retention、同意證據、owner與刪除流程。

## 未決外部資產

- 正式domain與canonical URL。
- Open Graph image與品牌logo最終稿。
- LINE MINI App／OA channel與登入入口。
- Privacy、terms與early-access資料處理owner。
- 經ADR核准的analytics與consent策略。
