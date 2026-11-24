# 成事所

把會議錄音丟進 LINE，回一條 LIFF 連結，裡面是一份讓你驚喜的會議記錄頁。零註冊、身分即 LINE userId。

**先讀** [GLOSSARY.md](./GLOSSARY.md)（詞彙與不可退讓的規則）。

## 架構一頁版

- 流程：LINE webhook（[route.ts](app/api/line/webhook/route.ts)）驗簽 → [routing.ts](lib/routing.ts) 分流（音檔＝開工、文字＝說明、其他＝拒收、群組＝ignore）→ reply 收件 → `after()` 跑 [pipeline](lib/pipeline/index.ts)：下載 → R2 存音檔 → Scribe 轉寫 → **LLM 校正（替換表，不重寫全文）** → 重點抽取 → 落庫 → push 記錄頁連結
- LINE 訊息：付款卡、記錄頁完成卡、額度卡都是 Flex（[flex.ts](lib/flex.ts) 純函式組裝，[line.ts](lib/line.ts) 只負責送 JSON；發失敗退回 [upsell.ts](lib/upsell.ts) 的純文字版，別刪）。兩條 uri 規則相反且都不能錯：**Stripe 連結（Checkout／Portal）要加 `openExternalBrowser=1`**——3DS 驗證頁在 WKWebView 會卡死；**記錄頁按鈕不加**——LIFF 深連結要留在 LINE 內才拿得到身分。`altText` 是通知列看到的字，必須是一句完整的話
- 第一次見面（issue #18）：follow 事件回歡迎訊息＋四顆 Quick Reply，聊天室下方常駐 2×2 圖文選單（怎麼傳錄音／看範例／額度／方案）。定義全在 [onboarding.ts](lib/onboarding.ts)——四格送出的是文字訊息，走跟打字一模一樣的分流，選單不長邏輯；圖在 `brand/richmenu.png`（源檔 `brand/src/richmenu.html`，改完跑 `bash brand/render.sh`），上傳靠 `pnpm setup:richmenu`（可重複跑，會收掉自己建的舊版）。LINE 後台預設的加入好友訊息要關掉，不然新朋友收到兩份——setup-deploy.sh 有 stage
- 記錄頁：`app/m/[id]`（骨架版、只讀）。**上線前必加 LIFF 身分閘門**——現在誰有連結誰能看
- 匯出：記錄頁與分享頁頁尾各一組。Word **由伺服器出檔**——手寫 OOXML（[docx.ts](lib/docx.ts) ＋ [zip.ts](lib/zip.ts)，零依賴），前端只負責導頁到一條兩分鐘有效的簽章網址（[export-url.ts](lib/export-url.ts)，金鑰由 `LINE_CHANNEL_SECRET` 推導，不另開 env）。**不能用 blob 下載**：LINE 的 iOS 內建瀏覽器是 WKWebView，沒有實作 `<a download>`，按了不報錯也不下載；導到真網址才走得完（iOS QuickLook 預覽／Android 直接下載／桌機正常存檔）。匯出走 `displayTurns()`，錯詞替換與說話人修正才不會掉。
- PDF **由伺服器上的 headless Chromium 跑同一份列印樣式產出**（[pdf.ts](lib/pdf.ts)，`@media print` 在 [globals.css](app/globals.css) 與 [meeting.module.css](app/m/[id]/meeting.module.css)，深色 token 列印時強制回淺色）。不用 PDF 函式庫是因為版面已經在 CSS 裡，寫第二份就會走鐘；Chromium 讀的是**真的記錄頁**，所以 PDF 就是使用者看到的樣子。它靠 `page` 用途的簽章網址進頁面（沒有 LINE 身分、也不該被轉去登入）。
- 兩個踩過的坑，改動列印相關的東西前先讀：**進場動畫**（`fadeUp` 用 `animation-fill-mode: both`，起始是 `opacity: 0`）在列印渲染裡不會跑完，不在 `@media print` 關掉的話整份 PDF 是白紙；**中文字型**在 Lambda 上一個都沒有，所以 `@media print` 裡自備 `@font-face`（`public/fonts` 兩個 woff2，各約 1MB）——字型名就叫 `Noto Sans TC`，現有堆疊裡它排在 PingFang 後面，所以真人的 Mac／Windows 不會下載它
- 儲存：音檔 R2（[r2.ts](lib/store/r2.ts)，手寫 SigV4）＋ 會議 JSON（[meetings.ts](lib/store/meetings.ts)，暫為檔案系統，DB 選型後換實作、介面不動）
- 生命週期：音檔 72h 真刪、免費記錄頁 30 天——[cron/cleanup](app/api/cron/cleanup/route.ts) 每日執行（決策是純函式 [cleanup.ts](lib/cleanup.ts)；付費用戶的到期頁不是「跳過」而是追認成永久）。**時長只有 `AUDIO_TTL_MS` 一份**，畫面與 LINE 文案讀同一支導出的 `AUDIO_TTL_HOURS`——曾經 cleanup 與三個 API route 各寫死一份 48h，調時長漏掉任何一個，使用者就會在期限內看到「錄音已刪除」。cron 是唯一會刪音檔的東西，所以 R2 後台另掛一條 7 天的 lifecycle 當保險絲（明顯寬於最慢 96h 的 cron，平時輪不到它；設定步驟在 `scripts/setup-deploy.sh`）
- 額度與付費：方案表與判定全在 [plans.ts](lib/plans.ts)（純函式、client 也能 import），伺服器端組裝在 [billing.ts](lib/billing.ts)。**免費按場、付費按小時**——成本按時長線性走，收錢那端得按小時；免費檔是獲客成本，按場次好懂。閘門跑兩遍：webhook 用原生語音自帶的時長先擋（省下載），pipeline 下載後用真時長再驗一次（省轉寫費）——時長解析在 [duration.ts](lib/audio/duration.ts)，m4a／wav／mp3 三種容器都只讀檔頭；認不出的格式放行，月額度是最後一道底。**額度重置的依據兩檔不同**（`quotaWindowStart`）：免費檔看日曆月（每月 1 號），付費檔看 **Stripe 的帳單週期**（20 號刷卡就 20 號重置，起點存在 `currentPeriodStart`）。曾經兩檔都用日曆月，但那樣扣款與額度會錯開——8/31 訂閱的人 8/31 拿一份、9/1 又拿一份，一次付款兩倍額度，成本吃掉整筆收入（2026-08-27 拍板改）。窗口再長不超過 31 天：webhook 漏一次的話帳期起點會停在上一期，照實算等於免費送一個月。付費檔單場超出剩餘額度**照收**，扣到見底、下一場才擋（2026-08-27 決定）。撞牆的文案在 [upsell.ts](lib/upsell.ts)，唯一規則是**不做靜默拒收**：一定給付款連結或恢復時間。另有一道 ops 後門：`QUOTA_UNLOCK_CODE` 設了值之後，誰在 LINE 傳出那串文字（需完全一致），那個 LINE 帳號就落進 `unlimited_users`——**額度全開，權益也比照付費檔**（PDF、分享、記錄頁永久保留）。四道閘門都問 [`entitledPlanForUser()`](lib/billing.ts)，別直接問 `planForUser`：那支只回答訂閱表怎麼說，漏掉解鎖碼的話會變成「額度無限但 PDF 按不動、記錄頁 30 天蒸發」
- Stripe：手寫 fetch（[stripe.ts](lib/stripe.ts)），兩檔訂閱掛 海外公司。訂閱的主人靠 `subscription.metadata.line_user_id` 認——身分即 LINE userId，不做帳號綁定；認不出主人或認不出 price 的事件一律不寫（寧可有人來問，也不要把權益發給錯的人）。狀態落 [subscriptions.ts](lib/store/subscriptions.ts) 一人一列，webhook 只吃 `customer.subscription.created/updated/deleted` 三個事件。加值上鎖在 PDF 匯出與分享（伺服器回 402、前端把鈕留著並給升級路徑）；**Word 匯出所有人都有**。分享頁的 PDF 看的是**主人**的方案——訪客沒身分、也不該被上鎖（那是病毒迴路的門面），但主人退訂後那條路要關，否則自己的舊分享連結就繞過了付費牆。退訂還有一個對稱動作：cron 會把付費期間存的永久頁重新上到期日（從發現當下起算 30 天，不是從建立起算——後者等於用刪資料懲罰退訂）
- 量測：會議是真刪的，所以留存另存一張事件表（[events.ts](lib/store/events.ts)，只有 sha256(userId)／時間／型別／對象 id，無內容）；`pnpm metrics` 印每月活躍用戶、人均場次、次月回訪率，以及分享頁開啟數（全站與每場；本人開自己的記錄頁不記事件，混不進來）
- 首頁試用（issue #19）：hero 一塊拖放上傳區 → POST [/api/trial](app/api/trial/route.ts) 同步跑轉寫三段 → 落庫成 `trial:<HMAC(ip)>` 名下、`expiresAt`＋24h → 回 [/t/[id]](app/t/[id]/page.tsx) 簽章網址（export-url 的 `trial` 用途、效期 24h）。純邏輯（5 分鐘／4MB／同 IP 一天一場、拒收文案）在 [trial.ts](lib/trial.ts)；「一天一場」就是 `listSince(trialUserId, 24h)`，不加欄位不掃全表。試用頁唯讀、無匯出無分享，CTA 兩步：加好友（`/join?ref=trial`）→ 認領（LIFF 帶簽章進 [/t/[id]/claim](app/t/[id]/claim/page.tsx)，POST claim 換 userId、保留期改按方案從認領起算、聊天室補完成卡）。24h 到期由既有 cron 的 delete-page 路徑收走，cleanup 不用改（拒訪在 24h 就生效——簽章與 API 的 expiresAt 都關門；真刪等 cron，最晚 72h）。事件 `trial_completed`（無主）與 `trial_claimed`＋`meeting_created`（認領人），漏斗看 `pnpm metrics`。已知取捨：認領會解開該 IP 的當日限制（每場都吃掉本人免費額度，不值得加鎖）；同 IP 併發搶打可同時過閘（最壞幾場 5 分鐘轉寫費）
- 網頁直接訂閱（issue #20）：定價卡付費按鈕指 [/subscribe?plan=…](app/subscribe/page.tsx)（LIFF＋Stripe 都就緒才指，否則退回 #16 的預填訊息連結）→ client 用 LIFF 拿 id token（外部瀏覽器走 `liff.login()`）→ POST [/api/subscribe](app/api/subscribe/route.ts) 沿用 `verifyRequestUser` 換 userId → Checkout／Portal 二選一（**已有有效訂閱導 Portal**，含已取消但本期未滿——再開一筆就是雙重扣款；判定是純函式 [subscribe.ts](lib/subscribe.ts)）→ 導頁前在 LINE 內建瀏覽器要過 `withExternalBrowser`（已搬到 [browser.ts](lib/browser.ts)）。Checkout 回跳帶 `via=web`，[/billing/done](app/billing/done/page.tsx) 看到它改談「加好友」而不是「回到聊天室」——**先收錢，再加好友**，這條路的人可能還不是好友
- 病毒迴路：分享頁底部一顆加好友 CTA → [`/join?ref=share`](app/join/route.ts) 記一筆再 302 到 LINE（[join.ts](lib/join.ts)）。量到的是**點擊**；真的加好友要 LINE OA 後台開「加入好友管道」，網址填進 `LINE_ADD_FRIEND_URL_SHARE`，同一顆按鈕兩邊都有數字

## 風格（沿襲 littleboss-line-bot）

零重依賴：LINE／R2／Gemini 都是手寫 fetch；AI 走 `lib/ai/provider.ts` 抽象層。**唯一的例外是 PDF 匯出的 `puppeteer-core` ＋ `@sparticuz/chromium`（約 70MB，只在伺服器端、動態 import）**——自己產中文 PDF 要嘛內嵌字型自己排版（等於把 `@media print` 再寫一份），要嘛就是這個；選了後者，代價寫在 [next.config.ts](next.config.ts) 的 `serverExternalPackages`。繁中註解，註解只寫「程式碼看不出來的約束」。測試 vitest，純邏輯抽純函式測。

```bash
pnpm dev / pnpm test / pnpm typecheck / pnpm build / pnpm metrics
```

## 憑證與下一步

所有 key 見 [.env.example](./.env.example)，複製成 `.env.local` 後填值（`.env.local` 不進版控）。

本機看記錄頁：`pnpm seed` 造一場示範會議並印出網址。設了 `DEV_LINE_USER_ID` 就跳過 LIFF，一般瀏覽器直接開得起來（前後端都卡 `NODE_ENV`，正式環境不會開後門）。

> 給自己架的人：下面三段（已部署、上線回填、未做）記的是**線上版 chengshisuo.com 當時的狀態**，不是你這份 clone 的狀態。你的站還沒部署、env 也還沒推；照 [SETUP.md](./SETUP.md) 做。

已部署：**https://chengshisuo.com**（網域 2026-08-16 於 Cloudflare 購入、DNS 也在 Cloudflare；Vercel 專案 `chengshisuo`，接 GitHub `main` 自動部署，`chengshisuo.vercel.app` 仍是備用網址；production env 已從 `.env.local` 推上去，`DEV_LINE_USER_ID` 刻意沒推）。網域相關的 URL 只有三處：Vercel `APP_BASE_URL`、LINE webhook URL、LIFF endpoint URL——換網域就是改這三個。本機驗 build 用 `pnpm build:check`（不會蓋掉 dev 的 `.next`）。

上線回填（只有人能做，跑 `bash scripts/setup-deploy.sh` 一步步來）：**Stripe 四個值**（兩個 price、secret key、webhook secret；缺任何一個付費牆發不出付款連結，webhook 事件沒勾齊則是收得到錢但權益不開通）、**LIFF 的 `chat_message.write` 權限**（LINE Developers → LIFF → Scopes；沒開的話記錄頁的「轉傳到 LINE」按下去只會叫你改用複製，`liff.isApiAvailable('shareTargetPicker')` 回 false 而不是丟錯）、GEMINI_API_KEY（本機與正式都還空著——沒它會轉寫成功但抽不出重點）、XAI_API_KEY（可選，比較用）、LINE webhook URL、LIFF endpoint URL、端對端試一場。

STT 選型：2026-08-12 定的 Scribe 只驗過**一場**安靜會議室的理想錄音，判準是「讀起來對不對」、沒有任何數字——`pnpm bakeoff:stt` 就是來補這個洞的（issue #28）。吃「音檔＋人工 reference」，出 CER、專有名詞召回（含**同一個詞被聽成幾種寫法**，那直接決定校正表要幾條）、講者數／邊界／歸屬、空檔補字、重複迴圈，順便量校正 pass 的增益。**測試集與人工 reference 的做法見 [bakeoff/cases/README.md](bakeoff/cases/README.md)**；跑完的結論要回寫進這裡，尤其「哪種錄音方式我們其實撐不住」——那會決定要不要在產品裡教使用者怎麼錄。對戰名單在 [stt-engines.ts](bakeoff/stt-engines.ts)，Scribe 那幾組跑的是產品自己那支 [scribe.ts](lib/stt/scribe.ts)（量到的必須是使用者真的拿到的東西）。**2026-09-10 對真 API 打過確認**：`scribe_v2` 已存在（產品仍釘 v1）、`num_speakers`／`diarization_threshold`／`keyterms` 都收，但 **keyterms 要重複欄位，送 JSON 字串會 400**。

LLM 選型：2026-08-16 起以 **Gemini 為主體、Grok 為第二家**（作者決定，成本考量），Anthropic 保留備援。**Grok 已無 flash 級**（grok-4-fast／4.1-fast 於 2026-05-15 退役、靜默轉 grok-4.3 計費）；Gemini flash-lite 便宜一個數量級。效果用 `pnpm bakeoff:llm` 跑真 prompt 比，結果落 `bakeoff/results/llm-summary.md`，看完再定 `AI_MODEL`。牌價表在 [bakeoff/llm.ts](bakeoff/llm.ts) 的 `PRICE`。

未做（依序）：LLM bake-off 跑完定 AI_MODEL、**吵雜場景的 STT 補測——工具已就緒，缺的是錄音與人工 reference**（六類場景各一場，先做 2–3 類把流程跑通；照 [bakeoff/cases/README.md](bakeoff/cases/README.md) 做）、超長音檔（3hr+）的處理極限實測（付費檔無單場上限，Vercel 逾時／LINE 下載大小／Scribe 單檔上限撞到要用明確錯誤訊息處理，不是偷偷加回產品上限）、年繳。

設計：方向與不可退讓的原則見 [.impeccable.md](./.impeccable.md)（Vercel Geist 骨架＋成事磚紅的成事所口音；品牌手冊與 logo 資產在 [brand/](./brand/)，淺色為主／跟隨系統深色）。token 在 [globals.css](app/globals.css)，改配色從那裡改，元件不必知道主題。

