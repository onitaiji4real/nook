# Controlled media upload security contract

1. Browser先向tenant-scoped API請求upload intent；authorization在application service執行，VIEWER拒絕。
2. API transaction驗證tenant、staff/service ownership、UUID idempotency與`MAX_PORTFOLIO_IMAGES`，再保存DRAFT/PENDING metadata。
3. API signer只能對該row的exact key建立15分鐘signed POST policy，conditions固定MIME與1–15 MiB；response不得含service-account credential。
4. Browser直接POST至private GCS，圖片位元不通過API。Client成功回報不等於資產READY。
5. Complete endpoint只接受tenant內portfolio/media IDs，建立固定name Cloud Task。Task payload只有safe UUID，OIDC audience為worker base URL。
6. Private Cloud Run worker先由IAM驗證Cloud Tasks service account；handler另比對queue header，所有repository讀寫仍要求payload tenantId。
7. Worker以database保存的bucket/key讀檔，不採信task傳入key。metadata與decoder雙層驗證後才輸出stripped WebP；任何不符合都以安全code拒絕並清除物件。
8. Logs只包含requestId/task safe identifiers、operation與outcome；不得記錄圖片buffer、signed form fields、signed URL、token、EXIF、customer notes或decoder detail。

## Threat boundaries

- Signed policy不是內容掃毒器；它只縮小upload request範圍，實際格式由worker解碼決定。
- `x-cloudtasks-queuename`可偽造，不能取代Cloud Run IAM／OIDC。
- Private object key不視為secret；authorization仍由database tenant ownership與signed read delivery負責。
- P2-004不對外提供public URL。P2-005加入delivery時必須重新檢查cache、revocation、address/identity privacy與publish status。
