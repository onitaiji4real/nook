# Portfolio workbench design contract

## Purpose and visual language

`/studio/portfolio`讓店家以攝影contact sheet的掃讀方式整理作品、看見驗證狀態、編輯metadata與排序。視覺採「darkroom contact sheet」：暖灰紙張、黑色沖印台、朱紅拒絕狀態、鈷藍選框與acid entitlement，把圖片處理狀態做成可辨識的營運語言，而不是一般卡片dashboard。

畫面只顯示通用`MAX_PORTFOLIO_IMAGES`與usage，不出現方案名稱。READY、PENDING、REJECTED、LOCAL明確區分；LOCAL永遠不得被文案描述為已上傳。

## Interaction contract

- 初始提供四張synthetic作品，含READY、PENDING與REJECTED，用來驗證狀態視覺，不依賴外部圖庫或GCS。
- File input只接受JPEG、PNG、WebP且client先檢查15 MiB；選取後用object URL顯示於本分頁，unmount時revoke，不送API、不寫localStorage。
- 選取作品後可修改名稱、說明、最多10個tag、往前／往後與移除；所有操作用React memory，重新整理還原。
- UI說明正式流程是15分鐘signed POST → private GCS → private worker驗證 → stripped WebP；client檔案檢查不是安全邊界。
- 不提供bearer token輸入、固定dev token、假的progress或「上傳成功」。Web必須等P2-006取得browser session再接現有tenant-scoped API。

## Responsive behavior

- Desktop：左側三欄contact sheet、右側固定語意inspector；配額卡與處理流程可同時掃讀。
- Tablet：contact sheet兩欄，inspector移到下方雙欄配置。
- Mobile：兩欄縮圖維持作品比較，inspector單欄；工作區topbar導覽可水平容納或以既有mobile bottom nav呈現。
- 390px viewport不得產生document水平溢位；操作不依賴hover，file input保留可鍵盤focus的label control。
- 使用者圖片以`object-fit: cover`呈現，但不更改檔案；正式display/thumbnail crop/resize只由worker執行。

## API handoff boundary

後端已有portfolio feature module、signed policy與task queue abstractions、tenant/RBAC/quota repository及worker processor。P2-006接線後，Web從Firebase session取得ID token，依序呼叫upload intent、直接POST policy fields至GCS、complete endpoint，再poll portfolio status；不得從client建立bucket/key或把signed fields送到logs/analytics。

P2-005公開頁另處理private READY asset delivery、cache與publish readiness。Admin contact sheet不得直接變成public view，也不得顯示PENDING/REJECTED圖片給consumer。
