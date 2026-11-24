# 成事所

加 LINE 好友，把會議錄音丟進來，幾分鐘後收到一條連結，裡面是一份會議記錄頁：摘要、決議、待辦、承諾追蹤、逐字稿、原音回放。不用註冊、不用裝 app，身分就是 LINE 帳號。

- 線上版：<https://chengshisuo.com>
- 示範記錄頁：<https://chengshisuo.com/demo>

這個 repo 是線上版的完整程式碼，公開出來給想自己做一套的人參考。**參考用，不保證維護**，issue 和 PR 不一定會回。

## 它做了什麼

1. LINE webhook 收到音檔，先回「收到了」。
2. 音檔存進 R2，交給 ElevenLabs Scribe 轉寫並分出講者。
3. LLM 做一次校正（只出替換表，不重寫全文），再抽出摘要、決議、待辦、承諾。
4. 落庫，推一張卡片回 LINE，點開就是記錄頁。
5. 音檔 72 小時後真的刪掉；免費的記錄頁保留 30 天。

架構、每個設計決定的理由、踩過的坑，都寫在 [CLAUDE.md](./CLAUDE.md)。詞彙和不可退讓的規則在 [GLOSSARY.md](./GLOSSARY.md)。

## 技術盤

- Next.js 15（App Router）部署在 Vercel：webhook、LIFF 記錄頁、匯出 API、每日清理的 cron
- Cloudflare R2 存音檔，Turso（libSQL）存會議資料；沒設 Turso 時退回本機檔案系統
- 語音轉文字：ElevenLabs Scribe
- LLM：Gemini 為主、Grok 第二家、Anthropic 備援，都走 `lib/ai/provider.ts` 這層抽象
- 付費：Stripe 訂閱
- LINE、R2、Stripe、Gemini 都是手寫 `fetch`，沒有用 SDK。唯一的重依賴是伺服器端出 PDF 用的 headless Chromium

## 自己跑起來

分兩層。只想看記錄頁長什麼樣，做第一層就好，幾分鐘、不用申請任何帳號。

### 第一層：在本機看記錄頁（不用任何帳號）

需要：

- Node 22.17 以上，或 24（PDF 匯出用的 `@sparticuz/chromium` 要求 `^22.17.0 || >=24`；實際測過的是 Node 24.22）
- pnpm（測過的是 11.5）

```bash
pnpm install
```

```bash
cp .env.example .env.local
```

打開 `.env.local`，找到 `DEV_LINE_USER_ID=` 這行，填一個隨便的字串（其他全部留空）：

```
DEV_LINE_USER_ID=U-dev-local
```

它讓你跳過 LINE 登入，一般瀏覽器直接開得起來，只在非正式環境有效。接著造一場合成的示範會議，會印出記錄頁網址：

```bash
pnpm seed
```

```bash
pnpm dev
```

打開 `pnpm seed` 印出來的那條 `http://localhost:3000/m/…`，就是一份可以編輯的記錄頁。首頁 <http://localhost:3000> 和示範頁 <http://localhost:3000/demo> 也開得起來。

這一層看得到、改得到記錄頁；**不能**收 LINE 訊息、不能轉寫錄音、不能付費。會議資料落在本機的 `.data/`，刪掉資料夾就清乾淨。

想順便試 Word 匯出，`.env.local` 再多填一行隨便的字串（匯出網址的簽章金鑰是從它推出來的，沒填按匯出會回 500）：

```
LINE_CHANNEL_SECRET=local-dev-only
```

PDF 匯出在本機要借系統的 Chrome，而且是付費檔功能，第一層先不用管。

### 第二層：接上真的 LINE 官方帳號，自己架一套

要申請 LINE、Vercel、Turso、Cloudflare R2、ElevenLabs、Gemini 六個帳號（要收費再加 Stripe）。需要哪些帳號、各家免費額度、照什麼順序設、每個環境變數是什麼，都寫在 **[SETUP.md](./SETUP.md)**。

裡面會用到兩支互動精靈，它們只會開網頁、問你值、寫進 `.env.local`，不會替你建帳號：

```bash
bash scripts/setup-line.sh
```

```bash
bash scripts/setup-deploy.sh
```

第一支帶你建 LINE provider、兩個 channel 和 LIFF；第二支要等站部署好、`.env.local` 填了 `APP_BASE_URL` 才能跑，帶你填 webhook 網址、Stripe、R2 這些只有人能做的設定。

## 其他指令

| 指令 | 做什麼 |
| --- | --- |
| `pnpm test` | 跑 vitest |
| `pnpm typecheck` | 型別檢查 |
| `pnpm build:check` | 驗 build，不會蓋掉 dev 的 `.next` |
| `pnpm metrics` | 印每月活躍、人均場次、回訪率、分享頁開啟數 |
| `pnpm bakeoff:stt` | 語音轉文字評測（字錯率、專有名詞、講者），做法見 [bakeoff/cases/README.md](./bakeoff/cases/README.md) |
| `pnpm bakeoff:llm` | 拿真的 prompt 比各家 LLM |

## 授權

[MIT](./LICENSE)。「成事所」的名稱和 `brand/` 裡的標誌不在授權範圍內，自己架請換名字和 logo。
