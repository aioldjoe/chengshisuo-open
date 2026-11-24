# 自己架一套：接上真的 LINE 官方帳號

這份是給想把整套跑起來的人：自己的 LINE 官方帳號收錄音、自己的站出記錄頁。只想在本機看記錄頁長什麼樣，看 [README](./README.md) 的第一層就好。

先講清楚哪些是驗過的：

- **實測過**：本機安裝、`pnpm seed`、`pnpm dev`、`pnpm test`、`pnpm typecheck`、`pnpm build:check`（Node 24.22、pnpm 11.5、macOS，2026-11-24）。
- **從程式讀出來、沒有從零重架一次驗過**：下面第 2 步之後的整條部署流程。線上版 <https://chengshisuo.com> 就是這份程式跑出來的，但寫這份文件時沒有另開一組全新帳號照著走一遍。卡住的話以程式和各家後台當下的畫面為準。
- 各家的價格和免費額度是 2026-11-24 從官方頁面查的，會變，連結附在表裡。

## 你會需要的帳號

| 服務 | 拿來做什麼 | 沒有它會怎樣 | 免費額度（2026-11-24 官方頁面） |
| --- | --- | --- | --- |
| [LINE 官方帳號](https://manager.line.biz/)＋[LINE Developers](https://developers.line.biz/console/) | 收錄音、回訊息、LIFF 登入 | 整套不會動 | 台灣輕用量方案月費 0 元、每月 200 則。[Reply 不算則數，Push 才算](https://developers.line.biz/en/docs/messaging-api/pricing/)（[方案頁](https://tw.linebiz.com/column/LINEOA-2026-Price-Plan/)） |
| [Vercel](https://vercel.com/) | 跑 Next.js、每日清理的 cron | 沒地方部署 | Hobby 方案函式最長 300 秒、cron 最密一天一次（[函式限制](https://vercel.com/docs/functions/limitations)、[cron](https://vercel.com/docs/cron-jobs/usage-and-pricing)）。Hobby 能不能拿來收費營運，請自己看 Vercel 的條款，這裡沒查到明文 |
| [Turso](https://turso.tech/) | 存會議、訂閱、事件 | 見下面「Turso 不能省」 | 5GB、每月 5 億列讀取、1,000 萬列寫入（[價目](https://turso.tech/pricing)） |
| [Cloudflare R2](https://developers.cloudflare.com/r2/) | 存音檔 72 小時 | 流程照跑，但記錄頁沒有原音回放 | 每月 10GB、Class A 100 萬次、Class B 1,000 萬次、流出免費（[價目](https://developers.cloudflare.com/r2/pricing/)） |
| [ElevenLabs](https://elevenlabs.io/) | 語音轉文字（Scribe） | 轉寫不了，等於沒功能 | API 價目頁列的是 Scribe v2／v3 每小時音檔 0.20 美元（[價目](https://elevenlabs.io/pricing/api)）。程式預設用 `scribe_v1`，v1 的價格和免費方案含不含轉寫，這次沒查到 |
| [Google AI Studio](https://aistudio.google.com/apikey) | Gemini 做校正和抽重點 | 轉寫成功但記錄頁的重點、決議、待辦是空的 | Flash 級有免費層；付費價見[價目頁](https://ai.google.dev/gemini-api/docs/pricing) |
| [Stripe](https://stripe.com/)（選配） | 訂閱收費 | 撞到額度的人只會收到「方案開通中」，收不到付款連結；其他功能不受影響 | 沒有月費，美國帳戶國內卡每筆 2.9%＋0.30 美元（[價目](https://stripe.com/pricing)）。台灣不能直接開 Stripe 帳戶，線上版是掛海外公司 |

每場會議都會用一則 Push 把記錄頁連結推回去（收件那句是 Reply，不算）。免費的 200 則大約就是每月 200 場，再扣掉付款通知這類訊息。這是從程式的訊息流程推出來的，沒有實際對過 LINE 後台的計數。

**Turso 不能省**：沒設 `TURSO_DATABASE_URL` 時，會議會寫到本機的 `.data/` 資料夾。本機開發這樣剛好；Vercel 的函式沒有可以長久寫入的磁碟，所以部署上去一定要設 Turso（這句是從 Vercel 的執行環境推論的，沒有故意不設去試）。資料表不用自己建，第一次連線時程式會 `CREATE TABLE IF NOT EXISTS`。

## 動手之前：這幾個地方寫死了線上版的東西

MIT 授權不包含「成事所」這個名字和 `brand/` 裡的標誌，自己架請換掉。程式裡要改的地方：

| 要改什麼 | 在哪 |
| --- | --- |
| 產品名「成事所」 | `app/`、`lib/`、`scripts/` 共 27 個檔有這三個字。使用者看得到的主要在 `lib/onboarding.ts`（歡迎訊息、圖文選單）、`lib/flex.ts` 和 `lib/upsell.ts`（LINE 卡片與文案）、`app/page.tsx`（首頁）、`app/layout.tsx`（網頁標題） |
| 聯絡信箱 `hello@chengshisuo.com` | `app/page.tsx`、`app/m/[id]/meeting-view.tsx`、`app/m/[id]/read-only-body.tsx`、`app/m/[id]/meeting.module.css`（列印時印出來的那行）。不改的話，你的使用者按「找我們聊聊」會寄信給線上版的作者 |
| 網域後備值 `https://chengshisuo.com` | `app/robots.ts`、`app/sitemap.ts`。有設 `APP_BASE_URL` 就不會用到，設了就不用改 |
| 標誌、LINE 頭像、圖文選單圖、分享預覽圖 | `brand/`（源檔在 `brand/src/*.html`，改完跑 `bash brand/render.sh`，它用 macOS 上的 Chrome 截圖）、`app/icon.png`、`app/apple-icon.png`、`app/opengraph-image.png`、`app/twitter-image.png` |
| 兩篇部落格文章 | `content/blog/`，內文講的是成事所，連結指向 chengshisuo.com。不要就刪掉 |
| 方案與價格（免費 3 場、NT$99、NT$399） | `lib/plans.ts`。Stripe 後台建的 price 金額要跟這裡一致 |
| LINE 官方帳號 ID | 沒有寫死，走 `NEXT_PUBLIC_LINE_OA_ID`。`lib/qr.test.ts` 裡那個 `@` 開頭的 ID 只是測試資料 |

兩支精靈的畫面文字也都寫「成事所」（例如「建立 provider『成事所』」），照做時換成你自己的名字。

## 設定順序

順序有講究：LINE 的 webhook 和 LIFF 要填你的站的網址，所以站要先部署；站要部署，環境變數要先有。

### 1. 本機先跑起來

照 [README](./README.md) 第一層做到 `pnpm dev` 開得起來。

### 2. 建 LINE 這邊的東西

```bash
bash scripts/setup-line.sh
```

它會帶你建 provider、Messaging API channel（官方帳號）、LINE Login channel 和 LIFF，把五個值寫進 `.env.local`：`NEXT_PUBLIC_LINE_OA_ID`、`LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`、`LINE_LOGIN_CHANNEL_ID`、`NEXT_PUBLIC_LIFF_ID`。

幾件事先知道：

- 第一關要你在 LINE 裡搜「成事所」確認沒撞名。你一定搜得到，那是線上版的官方帳號。請搜你自己要用的名字；精靈問「沒有撞名？」時，以你自己的名字為準回答。
- 兩個 channel 一定要建在**同一個 provider** 底下。不同 provider 拿到的 userId 不一樣，LIFF 會認不出 bot 的使用者，而且 provider 選定後不能改。
- LIFF 的 Endpoint URL 先填佔位網址，第 5 步再改。
- 精靈只開網頁、問值、寫檔，不會替你按任何東西。重跑會保留已經填過的值。

### 3. 建儲存和 AI 的帳號，把值填進 `.env.local`

這一段沒有精靈，手動做：

1. **Turso**：建一個資料庫，拿 URL（`libsql://` 開頭）和 token，填 `TURSO_DATABASE_URL`、`TURSO_AUTH_TOKEN`。
2. **Cloudflare R2**：建一個 bucket，再建一組 R2 API token（要能讀寫這個 bucket），填 `R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_BUCKET`。四個要一起填，缺一個就整個跳過存音檔。
3. **ElevenLabs**：建 API key，填 `ELEVENLABS_API_KEY`。
4. **Gemini**：這把可以等第 5 步的精靈帶你填。
5. 自己產一串亂數填 `CRON_SECRET`（Vercel 的 cron 會用它當 Bearer token 打清理 API；沒設的話那支 API 誰都能打）。

### 4. 部署到 Vercel

1. 把 repo 推到你自己的 GitHub，在 Vercel 匯入成專案（或用 `vercel` CLI）。
2. 把 `.env.local` 裡的值設成 Vercel 專案的環境變數。**`DEV_LINE_USER_ID` 不要推**——它在正式環境本來就無效，留在本機就好。
3. 部署完拿到網址（`https://你的專案.vercel.app`，或綁自己的網域）。
4. 把這個網址填進 `.env.local` 和 Vercel 的 `APP_BASE_URL`（結尾不要斜線），重新部署一次。LINE 卡片上的記錄頁連結、sitemap、PDF 匯出都靠它。

`NEXT_PUBLIC_` 開頭的兩個值是 build 的時候寫進前端的，改了要重新部署才會生效。

`vercel.json` 已經排好每天台北時間 03:00 跑一次 `/api/cron/cleanup`（刪到期的音檔和記錄頁），不用另外設。

### 5. 回填只有人能做的設定

```bash
bash scripts/setup-deploy.sh
```

它會先讀 `APP_BASE_URL`（環境變數或 `.env.local`），沒有就停下來。接著九關：

1. `GEMINI_API_KEY`（和選填的 `XAI_API_KEY`）
2. LINE 的 Webhook URL 填 `你的網址/api/line/webhook`，按 Verify 要過
3. LIFF 的 Endpoint URL 改成你的網址（**網域根，後面不要帶 `/m`**，不然記錄頁會 404）
4. 圖文選單（`pnpm setup:richmenu`，會把 `brand/richmenu.png` 上傳成四格選單）和關掉 LINE 後台預設的歡迎訊息
5. 分享頁的加好友管道網址（選填）
6. 示範頁的加好友管道網址（選填）
7. Stripe：兩個 price、secret key、webhook（事件只勾 `customer.subscription.created`／`updated`／`deleted`）、開 Customer portal。不收費的話四個值都留空按 Enter 跳過
8. R2 bucket 加一條 7 天自動刪除的 lifecycle 當保險
9. 端對端試一場

要知道的：

- 精靈每填一個值，如果你裝了 `vercel` CLI 而且這個資料夾已經 `vercel link` 過，會順手 `vercel env add … production`。沒裝或沒連結也沒關係，它會在最後列出哪些要你手動補到 Vercel。**補完要重新部署**，新的值才會生效。
- 第 8 關開的 R2 後台連結，bucket 名稱取自環境變數 `R2_BUCKET`；精靈不會自己去讀 `.env.local` 裡的這個值，連結開錯 bucket 的話自己點到對的那個。
- 記錄頁的「轉傳到 LINE」要在 LIFF 的 Scopes 多勾 `chat_message.write`，沒勾的話按鈕會叫你改用複製連結。

### 6. 驗收

手機加你的官方帳號好友，傳一段一兩分鐘的錄音。應該先收到一句收件回覆，幾分鐘後收到記錄頁卡片。卡在哪一步，就是哪一環沒接上：

| 現象 | 多半是 |
| --- | --- |
| 傳了沒任何回應 | Webhook URL 沒設、沒開 Use webhook，或 `LINE_CHANNEL_SECRET` 不對（驗簽失敗） |
| 有收件回覆，但一直等不到記錄頁 | `ELEVENLABS_API_KEY`、Turso，或函式逾時（Vercel 的函式記錄看得到） |
| 有記錄頁連結但打不開 | LIFF Endpoint URL，或兩個 channel 不在同一個 provider |
| 記錄頁有逐字稿，但重點是空的 | `GEMINI_API_KEY` |
| 付了款沒開通 | Stripe webhook 的三個事件沒勾齊，或 `STRIPE_WEBHOOK_SECRET` 不對 |

## 環境變數一覽

「必要」指的是第二層（真的要收錄音）。第一層只需要 `DEV_LINE_USER_ID`。

### LINE

| 變數 | 必要 | 是什麼 |
| --- | --- | --- |
| `NEXT_PUBLIC_LINE_OA_ID` | 是 | 官方帳號的 basic ID（`@` 開頭）。加好友連結和首頁 QR 用 |
| `LINE_CHANNEL_SECRET` | 是 | Messaging API channel 的 secret。驗 webhook 簽章；匯出網址的簽章金鑰也從它推出來 |
| `LINE_CHANNEL_ACCESS_TOKEN` | 是 | Messaging API 的 long-lived token。回訊息、推卡片、設圖文選單 |
| `LINE_LOGIN_CHANNEL_ID` | 是 | LINE Login channel 的 ID（純數字）。驗 LIFF 的 ID token |
| `NEXT_PUBLIC_LIFF_ID` | 是 | LIFF app 的 ID。記錄頁靠它拿到使用者身分 |
| `LINE_ADD_FRIEND_URL_SHARE`／`_DEMO`／`_TRIAL`／`_BLOG` | 否 | LINE 後台「加入好友管道」給的專屬網址，四個入口分開數真的加好友的人數。沒設就跳一般加好友連結，只數得到點擊 |

### AI

| 變數 | 必要 | 是什麼 |
| --- | --- | --- |
| `ELEVENLABS_API_KEY` | 是 | 語音轉文字 |
| `ELEVENLABS_STT_MODEL` | 否 | 預設 `scribe_v1` |
| `AI_PROVIDER` | 否 | `google`（預設）、`grok`、`anthropic` |
| `AI_MODEL` | 否 | 不填就用各家的預設模型，見 `lib/ai/provider.ts` |
| `GEMINI_API_KEY` | `AI_PROVIDER=google` 時是 | 校正和抽重點 |
| `XAI_API_KEY` | `AI_PROVIDER=grok` 時是 | 同上，第二家 |
| `ANTHROPIC_API_KEY` | `AI_PROVIDER=anthropic` 時是 | 同上，備援 |
| `CF_AI_GATEWAY_ID`、`CF_ACCOUNT_ID`、`CF_AI_GATEWAY_TOKEN` | 否 | 想讓 AI 呼叫走 Cloudflare AI Gateway 才填 |

### 儲存

| 變數 | 必要 | 是什麼 |
| --- | --- | --- |
| `TURSO_DATABASE_URL`、`TURSO_AUTH_TOKEN` | 部署時是 | 會議、訂閱、事件都存這裡。本機留空會退回 `.data/` |
| `R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_BUCKET` | 要原音回放才是 | 音檔存 72 小時。四個要齊 |
| `MEETINGS_DIR` | 否 | 本機檔案系統模式的落點，預設 `.data/meetings` |
| `EVENTS_FILE` | 否 | 本機事件檔的落點，預設 `.data/events.jsonl`（`.env.example` 沒列） |

### 付費

| 變數 | 必要 | 是什麼 |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | 要收費才是 | `sk_test_` 或 `sk_live_` 開頭 |
| `STRIPE_WEBHOOK_SECRET` | 要收費才是 | `whsec_` 開頭。沒設的話收得到錢但權益不會開通 |
| `STRIPE_PRICE_LITE`、`STRIPE_PRICE_STANDARD` | 要收費才是 | 兩檔訂閱的 price id（`price_` 開頭） |

### 部署與本機

| 變數 | 必要 | 是什麼 |
| --- | --- | --- |
| `APP_BASE_URL` | 部署時是 | 你的站的網址，結尾不要斜線 |
| `CRON_SECRET` | 建議 | 每日清理 API 的 Bearer token。設了才會驗 |
| `QUOTA_UNLOCK_CODE` | 否 | 設了之後，誰在 LINE 傳出一模一樣的這串字，那個帳號就不受額度限制、權益比照付費檔。留空就是關閉。等於一把萬用鑰匙，不要用猜得到的字 |
| `DEV_LINE_USER_ID` | 只在本機 | 隨便一個字串。設了就跳過 LIFF 登入；正式環境無效，不要推到 Vercel |
| `CHROME_PATH` | 否 | 本機出 PDF 用的 Chrome 路徑，預設是 macOS 的 Google Chrome 位置（`.env.example` 沒列） |

`.env.local` 裡不要在等號後面接註解。Next.js 讀得懂，但 `scripts/` 的精靈會把註解當成值。

## 評測工具用的（跟架站無關）

`pnpm bakeoff:stt` 要自己準備錄音和人工逐字稿，做法在 [bakeoff/cases/README.md](./bakeoff/cases/README.md)；對照組另外吃 `OPENAI_API_KEY`。`pnpm bakeoff:llm` 要 `GEMINI_API_KEY` 和 `XAI_API_KEY`，缺哪家就跳過哪家。兩支都會真的打 API、會花錢，這次沒有實跑。
