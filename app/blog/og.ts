/**
 * 文章與索引頁共用的 Open Graph 底料。
 *
 * 為什麼要明寫 images：頁面只要自己定義了 `openGraph`，整個物件就會蓋掉上層的，
 * 連 app/opengraph-image.png 那張檔案式的 OG 圖也一起不見（2026-09-10 實測：
 * 首頁有 og:image，文章頁沒有）。分享到 LINE 沒有預覽圖，等於少掉一半的點閱理由。
 * 路徑是相對的，layout 的 metadataBase 會補成絕對網址——LINE 的預覽只吃絕對網址。
 */
export const OG_BASE = {
  siteName: "成事所",
  locale: "zh_TW",
  images: ["/opengraph-image.png"],
};
