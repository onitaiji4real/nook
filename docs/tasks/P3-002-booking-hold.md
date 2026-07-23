# P3-002 Booking hold and occupancy constraint

狀態：`done`

## Outcome

讓已登入顧客把一個仍可用的候選時段原子性鎖定10分鐘。Hold會選定具體staff、保存服務／價格快照並占用含buffer的完整區間；相同staff的重疊hold在任何併發下只能成功一筆。它仍不是appointment，不能發送預約成立通知或計入方案的每月完成預約。

## Product decisions

- Hold建立要求有效Firebase／LINE consumer identity。店家會員與顧客共用`User` identity system，但consumer flow不要求tenant membership；API只使用server principal的`userId`，body不得傳consumer ID。這降低匿名囤位與後續認領爭議。
- TTL固定10分鐘，由PostgreSQL transaction clock取得的單一`dbNow`計算，client與application host不得指定或延長。倒數只供UX顯示，真正有效性以database `expiresAt > dbNow`為準。
- 同一consumer在同一tenant同時最多一個ACTIVE未過期hold；選新時段會在同一transaction釋放舊hold。跨tenant建立由identity rate limit限制每10分鐘最多10次，不以IP或PII作bucket key。
- Any-staff請求可省略`staffId`；server重新計算candidate並從當下仍eligible的人員依`sortOrder, id`穩定選一位。選定後若insert發生occupancy conflict，整筆transaction rollback並回409，不得靜默改選下一位。Client提供staff時必須仍在eligible IDs內且不得被替換。最終選定staff固定寫入hold response。
- Hold建立時保存service name、實際duration、公開price及currency快照。10分鐘內店家修改服務不改變既有hold顯示；P3-003確認時使用快照，不信任browser回傳價格或duration。
- Hold不是booking success。Response使用`bookingState=HELD`、`appointmentCreated=false`；公開頁顯示「暫時保留」及server expiry倒數，不顯示預約編號、完整地址或完成通知。

## Scope

- 新增`BookingHoldStatus = ACTIVE | RELEASED | EXPIRED | CONSUMED`、tenant-owned `booking_holds`與唯一防撞來源`booking_occupancies`。P3-002 occupancy只可由hold持有；schema預留P3-003在同一row原子把ownership轉給appointment，禁止holds／appointments各自建立constraint。
- 欄位包含tenant/location/service/staff/consumer、服務起訖、含buffer占用起訖、price/duration快照、`expiresAt`、status、idempotency hash/fingerprint及timestamps。所有foreign key使用tenant composite scope；consumer user為global identity relation。
- PostgreSQL啟用`btree_gist`，在`booking_occupancies`以partial GiST exclusion constraint禁止同一staff之ACTIVE occupancy的`tstzrange(occupied_start_at, occupied_end_at, '[)')`重疊。所有time checks由database再次固定；application query不是唯一防線。
- `POST /v1/marketplace/merchants/{slug}/booking-holds`要求Bearer auth與`Idempotency-Key`。Body只收`serviceId`、選填`staffId`及UTC `startAt`；server重新讀published projection、policy、非過期hold occupancy並重新跑P3-001 calculator。
- Idempotency key為UUID，由server以SHA-256保存；scope固定`(consumerUserId, endpoint, keyHash)`，fingerprint涵蓋slug、serviceId、staffId-or-any及normalized startAt。Unique constraint仲裁concurrent first requests。相同key＋相同fingerprint回同一`holdId`、原始`expiresAt`與目前狀態，不重跑換位、不釋放其他hold且不延長TTL；若持久化狀態仍為ACTIVE但`expiresAt <= dbNow`，replay會先把hold與occupancy轉為EXPIRED再回傳current status。不同fingerprint回409。即使原hold已RELEASED／EXPIRED／CONSUMED也不得用同key建立新hold。
- Authentication與UUID格式的`Idempotency-Key`先在rate attempt之前驗證，未登入／inactive consumer及缺少或格式錯誤的key不計數。通過後，rate limit在booking transaction之前以獨立transaction記錄`(consumerUserId, windowStart, keyHash)` distinct attempt；同key replay不重複計數，不同有效key即使後續slug、strict body、catalog、slot或conflict失敗（400／404／409）仍計數。429不進入hold transaction且不得釋放舊hold；raw key不落庫。此contract使用專用attempt rows，不用會把retry重複加總的既有counter adapter。
- Create transaction開始時先從PostgreSQL取得單一`dbNow`，並以`pg_advisory_xact_lock(hashtextextended(tenantId || ':' || consumerUserId, 0))`序列化同consumer／tenant。所有expiry cleanup、有效性、calculator earliest time與`expiresAt = dbNow + 10 minutes`都使用該值，不使用app host或client clock。
- Transaction先處理idempotency，再把所有可能被本次constraint比對的候選staff之`ACTIVE AND expiresAt <= dbNow` holds／occupancies轉EXPIRED，釋放本consumer在同tenant的其他有效hold，最後insert hold及occupancy。釋放舊hold與insert新hold必須同transaction；任何validation、candidate disappearance、exclusion conflict或其他錯誤都rollback，舊hold維持ACTIVE且expiry不變。
- Exclusion violation或candidate已消失固定回409 `slot_no_longer_available`，不可回傳其他顧客或hold資料。兩個獨立connection還須證明同consumer／tenant併發create最終最多一個有效hold。
- Availability repository將`ACTIVE AND expiresAt > now` holds接入P3-001 occupancy，讓已鎖時段立即從候選結果消失。P3-003再加入有效appointments occupancy。
- `DELETE /v1/booking-holds/{holdId}`要求相同consumer auth並以transaction `dbNow`判斷。先把own `ACTIVE AND expiresAt <= dbNow`轉EXPIRED；只有未過期ACTIVE可轉RELEASED。Own RELEASED／EXPIRED重試回204，CONSUMED回409，其他consumer固定404；任何狀態都不得延長或復活。
- Worker提供可安全重試的internal expiry operation，把`expiresAt <= now` ACTIVE rows批次轉EXPIRED；lazy cleanup仍在create transaction執行，因此scheduler延遲不影響正確性。Cloud Scheduler／Tasks資源沿用既有架構，正式排程設定若需外部GCP project可先留runbook gate。
- Web consumer session沿用P2-006 LIFF／Firebase token exchange但不要求tenant membership。Configured模式必須登入才可hold；LOCAL PREVIEW只做明示模擬倒數，不呼叫正式hold API。
- Shared contracts、OpenAPI、ADR、data dictionary、security/design contract、tests與worklog。

## Acceptance criteria

- [x] Database integration以兩個獨立connection同時插入重疊range，證明僅一筆ACTIVE occupancy成功；相鄰`[start,end)`可同時成功，不靠單執行緒test假裝防撞。
- [x] Expired／RELEASED／CONSUMED rows不阻擋新hold；transaction會在insert前處理相關expired rows。Worker expiry同一批次重試安全且不改變非ACTIVE rows。
- [x] API重新驗證published tenant、ACTIVE location/service/staff、booking flags、assignment、policy、weekly/exception、lead/advance、duration/buffer及現有occupancy。未知、跨tenant、inactive或未assignment固定privacy-safe 404；slot消失為409。
- [x] Consumer ID只能來自verified principal；body額外欄位被拒絕。無token 401、inactive user 403。其他consumer release固定404，不洩漏存在性；P3-002不提供hold read endpoint。
- [x] `Idempotency-Key`缺少／格式錯誤回400；同key同payload回同hold、原expiry及current status，不新增row、不換位、不延長TTL且不重複計rate attempt；同key不同payload回409。Raw key、Bearer token及consumer profile不得寫log或database。
- [x] 同consumer／tenant的新hold會在advisory lock下原子釋放舊ACTIVE hold；新hold失敗須rollback並保留舊hold。每10分鐘超過10個distinct keys回429且有Retry-After；attempt只使用consumer UUID與不可逆key hash，不使用email、phone或LINE subject。
- [x] Any-staff由server依`sortOrder, id`穩定選定一位當下eligible staff，insert conflict時不改選；指定staff時不得被替換。Response只回公開service/staff摘要、UTC服務時間、timezone、status、expiry與`appointmentCreated=false`，不回buffer、occupancy、tenant ID或私人地址。
- [x] Price/duration snapshot涵蓋FIXED/FROM/RANGE/QUOTE及staff override；店家在hold後修改catalog不改變hold response。P3-003只可消費ACTIVE且未過期hold一次。
- [x] Availability在hold建立後立即移除重疊slot，release／expiry後恢復；資料讀取有tenant scope且controller不碰Prisma。
- [x] Web在configured consumer session完成登入提示、hold loading/conflict/held/expired/released狀態與server-based countdown；手機可操作且不顯示假預約成功。LOCAL PREVIEW明示模擬、不寫正式database。
- [x] OpenAPI、ADR、data dictionary、安全與設計文件、unit/integration/concurrency/browser tests、lint、typecheck、build、architecture及live smoke通過。

## External activation gates（不阻擋repository completion）

- [ ] 以真實LINE／LIFF與Firebase設定完成configured consumer session staging驗證；LOCAL PREVIEW不能替代此證據。
- [ ] Private Cloud Run worker由Cloud Scheduler使用Google-signed OIDC呼叫，並驗證錯audience、錯identity、無token及僅偽造header皆拒絕。
- [ ] Owner檢視staging的expiry、409、rate-limit與worker 5xx後，核准production Scheduler啟用。

## 非目標

- 建立／確認appointment、付款、定金、通知、完整地址揭露、取消改期或顧客CRM。
- 延長hold、同一hold更換staff/service/time、管理員代訂或多人／房間資源。
- 依方案名稱分支或在hold建立時計入`MAX_MONTHLY_BOOKINGS`；配額在P3-003 appointment confirmation transaction檢查。
- 以Redis、memory mutex、Cloud Tasks或前端disabled button作唯一防撞機制。

## 商業與營運風險

- 未登入匿名hold會讓競品或bot廉價囤位，因此MVP要求LINE/Firebase identity並加user bucket rate limit；仍需在staging觀察409、expiry及rate-limit比例再調整數值。
- 固定10分鐘平衡付款／填表時間與店家空檔流失。未來若依付款方式或服務調整TTL，必須是policy＋entitlement資料，不可硬寫方案名稱。
- Hold不應計費或觸發媒合費；只有P3-003 confirmed appointment記錄acquisition attribution，服務完成後才產生媒合費義務。
- `booking_occupancies`是hold與appointment共享的唯一invariant。P3-003必須在同一transaction原子把ownership從hold轉為appointment，並以hold-insert／appointment-confirm併發測試證明最多一方成功；不得另建appointments-only constraint。
