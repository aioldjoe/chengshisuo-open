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

需要 Node 和 pnpm。

```bash
pnpm install
```

```bash
cp .env.example .env.local
```

只想在本機看記錄頁長什麼樣，`.env.local` 填一個 `DEV_LINE_USER_ID` 就夠：它讓你跳過 LIFF 登入，一般瀏覽器直接開得起來（只在非正式環境有效）。接著造一場合成的示範會議，會印出記錄頁網址：

```bash
pnpm seed
```

```bash
pnpm dev
```

要接上真的 LINE 官方帳號、真的轉寫錄音，照兩支互動精靈走：

```bash
bash scripts/setup-line.sh
```

```bash
bash scripts/setup-deploy.sh
```

第一支帶你建 LINE provider、兩個 channel 和 LIFF；第二支帶你填 Stripe、R2、webhook 網址這些只有人能做的設定。每個 key 的用途寫在 [.env.example](./.env.example)。

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
