import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";

import "./globals.css";
import { ThemeMetaSync } from "./theme-toggle";

const DESCRIPTION = "把會議錄音丟進 LINE，幾分鐘後收到一份讓你驚喜的會議記錄頁。";

/**
 * favicon／apple-icon／opengraph-image 是 app/ 底下的靜態 PNG，Next 會自動掛 <link>／og:image；
 * 來源與重產方式見 brand/render.sh。metadataBase 讓 og:image 變絕對網址——LINE 的分享預覽只吃絕對網址。
 */
export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_BASE_URL || "http://localhost:3000"),
  title: { default: "成事所", template: "%s｜成事所" },
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "成事所",
    title: "成事所",
    description: DESCRIPTION,
    locale: "zh_TW",
  },
  twitter: { card: "summary_large_image" },
};

/** 記錄頁的主場是 LINE 的 in-app 瀏覽器，深淺色跟著手機系統走。色值＝globals.css 的 --bg。 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F8F6F4" },
    { media: "(prefers-color-scheme: dark)", color: "#211c1a" },
  ],
};

/**
 * 主題開機腳本：進頁面第一時間套用使用者記住的深淺色選擇（切換鈕在 theme-toggle.tsx），
 * 必須是 body 開頭的同步 script 才不會先閃系統色再跳。theme-color 的色值＝globals.css 的 --bg，
 * 覆寫時兩支 meta 都蓋掉（media 誰中都一樣）。
 */
const THEME_BOOT = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t;var c=t==="dark"?"#211c1a":"#F8F6F4";document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){m.setAttribute("content",c)})}}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  // 字體自架（next/font），LIFF 裡不必等外部 CDN，也不會因為擋外連而掉字。
  // suppressHydrationWarning：開機腳本會在 hydration 前寫 html[data-theme]，屬性不吻合是預期的。
  return (
    <html
      lang="zh-Hant"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        <ThemeMetaSync />
        {children}
      </body>
    </html>
  );
}
