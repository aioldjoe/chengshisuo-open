# 成事所 品牌資產

定案手冊：[ref/成事所-完整視覺識別手冊-v15.html](./ref/成事所-完整視覺識別手冊-v15.html)（2026-08-16，v1.0）。這個資料夾放的是**可以直接拿去用的檔**；設計方向與程式裡怎麼用見 [.impeccable.md](../.impeccable.md)，色票 token 在 [app/globals.css](../app/globals.css)。

## 色票

| 職務 | 名稱 | HEX | 程式 token |
|---|---|---|---|
| 唯一品牌色：方章、CTA、承諾印記 | 成事磚紅 | `#B65A4A` | `--seal` |
| 品牌色當文字（連結） | 深磚紅 | `#8D4339` | `--seal-strong` |
| 頁面底 | 暖紙白 | `#F8F6F4` | `--bg` |
| 方章裡的字、按鈕字 | 乳白 | `#FFFDFC` | `--seal-ink` |
| 內文 | 墨灰 | `#383432` | `--text` |
| 輔助文字 | 灰棕 | `#81756D`（程式裡壓深到 4.5:1） | `--text-2` |
| 分隔線 | 線 | `#E2D9D3` | `--border` |
| 柔和輔色（只作點綴，不與磚紅搶主位） | 乾燥玫瑰 | `#D5A69A` | — |

比例：暖紙白 70％、墨灰 20％、磚紅 10％。

## 方章（logo）

圓角方塊，圓角＝邊長 26％；字 PingFang TC／Noto Sans TC 600，**不用黑體**。不旋轉、不加影、不拉伸、不套漸層、不換色。

| 檔 | 用途 |
|---|---|
| [mark-chengshi.svg](./mark-chengshi.svg) / [mark-chengshi.png](./mark-chengshi.png)（512） | A／成事章：主品牌章，首頁、封面、第一次介紹品牌 |
| [mark-cheng.svg](./mark-cheng.svg) | B／成章：**48px 以下**用單字，favicon、App icon、頭像 |
| [lockup.svg](./lockup.svg) | 成事章＋「成事所」字標＋「用程式助你成事」，透明底 |
| [line-avatar.png](./line-avatar.png)（640） | LINE 官方帳號頭像，磚紅滿版＋成（LINE 會自己裁圓） |
| [richmenu.png](./richmenu.png)（2500×1686） | LINE 圖文選單（issue #18），`pnpm setup:richmenu` 上傳；四格文案跟 [lib/onboarding.ts](../lib/onboarding.ts) 一致 |

網站上實際掛的：`app/icon.png`（favicon 192）、`app/apple-icon.png`（180，iOS 自己套圓角）、`app/opengraph-image.png`＋`twitter-image.png`（1200×630 分享卡）。

## 重產 PNG

```bash
bash brand/render.sh
```

用本機 Chrome 無頭截 `src/*.html`——不用 next/og 是因為 satori 要自備中文字型檔。改文案或方章時改 `src/`，重跑，產物一起進版控。

## 只有人能做的兩件事

1. **LINE 官方帳號頭像**：LINE Official Account Manager → 設定 → 帳號設定 → 基本資料圖片，上傳 `line-avatar.png`。
2. **LINE 顯示名稱**（待定案）：手冊第 06 節「不同載體，同一個成事所」——建議 LINE 也叫「成事所」，功能說明放「狀態訊息」與加好友歡迎訊息；若要在名字裡帶功能，用「成事所｜會議記錄」而不是另取一個名字。
