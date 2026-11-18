// 瀏覽器環境的判斷。client / server 共用，勿放 server-only import。

/**
 * 是不是 LINE 的內建瀏覽器（LIFF 頁與從聊天室點開的分享頁都算）。
 *
 * 這件事要判斷，是因為 LINE 的 WebView 有兩個做不到的事，而它是我們的主要通路：
 * 叫不動 `window.print()`（沒有列印對話框），而 blob 下載在 iOS 上會靜默失敗
 * （按了什麼都沒發生）。兩者都不會丟錯，所以只能事先看 UA 分流，
 * 把人導去外部瀏覽器——否則匯出鈕對大多數使用者等於不存在。
 *
 * LINE 的 UA 尾巴長這樣：`... Safari/604.1 Line/14.11.0/IAB`。
 * 認 `Line/` 加版本號，不認裸字串——Outline、Skyline 之類的產品名會誤中。
 */
export function isLineInAppBrowser(ua: string): boolean {
  return /(?:^|\s)Line\/\d/.test(ua);
}

/**
 * 逼 LINE 內建瀏覽器改開外部瀏覽器。Stripe Checkout 在 WKWebView 通常開得起來，
 * 但銀行的 3DS 驗證頁很容易卡死——跟 <a download> 失效是同一家族的坑。
 * Stripe 的 URL 常帶長 fragment，參數要插在 # 之前才有效。
 */
export function withExternalBrowser(url: string): string {
  const hashAt = url.indexOf("#");
  const [base, hash] = hashAt === -1 ? [url, ""] : [url.slice(0, hashAt), url.slice(hashAt)];
  return `${base}${base.includes("?") ? "&" : "?"}openExternalBrowser=1${hash}`;
}

/**
 * 是不是 iOS。只配著 isLineInAppBrowser 用：LINE 的 WebView 一律回報行動版 UA，
 * 所以認 iPhone/iPad 就夠——iPad Safari 桌面模式會謊報 Macintosh，這裡不管它，
 * 因為那個情境走的是正常下載，不需要 iOS 專屬的提示。
 */
export function isIos(ua: string): boolean {
  return /iPhone|iPad|iPod/.test(ua);
}
