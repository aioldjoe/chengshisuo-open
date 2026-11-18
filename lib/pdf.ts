import chromium from "@sparticuz/chromium";
import puppeteer, { type Browser } from "puppeteer-core";

/**
 * 用 headless Chromium 把記錄頁印成 PDF。**server-only**。
 *
 * 為什麼是瀏覽器而不是 PDF 函式庫：版面已經寫在 `@media print` 裡了
 * （app/globals.css 與 app/m/[id]/meeting.module.css）。用函式庫等於把同一份版面
 * 再寫第二次，然後兩份慢慢走鐘；讓 Chromium 跑同一份 CSS，改 CSS 兩邊自動同步，
 * 印出來的 PDF 就是使用者在頁面上看到的東西。
 *
 * 中文字型：Lambda 環境一個 CJK 字型都沒有，不處理會整份變方框。字型是
 * public/fonts 那兩個 woff2，用 `@media print { @font-face }` 掛在
 * 「Noto Sans TC」這個名字上——現有字型堆疊本來就有它，而且排在 PingFang 後面，
 * 所以真人用的 Mac／Windows 照樣吃系統字型，只有沒字型的這裡會下載它。
 */

/** 冷啟動要解壓 Chromium，暖的時候整個重用。 */
let browserPromise: Promise<Browser> | null = null;

function onServerless(): boolean {
  return !!(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.VERCEL);
}

async function executablePath(): Promise<string> {
  if (onServerless()) return chromium.executablePath();
  // 本機開發沒有 Lambda 版的二進位檔，借系統上的 Chrome
  return (
    process.env.CHROME_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  );
}

async function getBrowser(): Promise<Browser> {
  const existing = await browserPromise?.catch(() => null);
  if (existing?.connected) return existing;

  // 不需要 WebGL，關掉省記憶體與冷啟動時間
  chromium.setGraphicsMode = false;
  browserPromise = puppeteer.launch({
    args: onServerless() ? chromium.args : [],
    defaultViewport: { width: 1240, height: 1754 },
    executablePath: await executablePath(),
    headless: true,
  });
  return browserPromise;
}

/** 渲染逾時。冷啟動解壓 Chromium 就要好幾秒，抓寬一點但不能沒有上限。 */
const NAV_TIMEOUT_MS = 25_000;

/**
 * 打開 url、等內容與字型都就緒，回傳 PDF 位元組。
 *
 * url 必須是「打得開就看得到內容」的網址——這支不會登入。記錄頁走
 * 兩分鐘有效的簽章（lib/export-url.ts 的 page 用途），分享頁本來就公開。
 */
export async function renderPdf(url: string): Promise<Uint8Array> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
    // 音檔是 R2 的限時連結，動輒幾十 MB——列印時本來就看不到播放器，別讓它拖慢
    await page.setRequestInterception(true);
    page.on("request", (r) => {
      if (r.resourceType() === "media") r.abort().catch(() => {});
      else r.continue().catch(() => {});
    });

    // 一定要在 goto 之前：@font-face 宣告在 @media print 裡，
    // 不先切成列印媒體，中文字型根本不會被載入
    await page.emulateMediaType("print");
    await page.goto(url, { waitUntil: "domcontentloaded" });
    // 記錄頁是 client 端取資料再畫的，等實際內容出現，別在骨架畫面上按快門
    await page.waitForSelector("#transcript", { timeout: NAV_TIMEOUT_MS });
    await page.evaluate(() => document.fonts.ready);

    return await page.pdf({
      printBackground: true,
      // 紙張大小與邊界都吃 CSS 的 @page（見 app/globals.css）——只有一個地方定義
      preferCSSPageSize: true,
    });
  } finally {
    await page.close().catch(() => {});
  }
}
