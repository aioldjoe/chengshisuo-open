import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * 匯出檔案的短效簽章網址。**server-only**（node:crypto），別從 client 元件 import。
 *
 * 為什麼要有這東西：匯出不能走 blob 下載——LINE 的 iOS 內建瀏覽器是 WKWebView，
 * 沒有實作 <a download>，按了不會有事也不會報錯。改成讓瀏覽器就地導到一條真網址，
 * iOS 會用 QuickLook 預覽、Android 的 LINE 直接下載、桌機正常下載，一條路走完。
 * 但「導頁」帶不了 Authorization header，所以憑證只能放在網址上——就是這條簽章。
 *
 * 有效期短到只夠按一下：網址會留在瀏覽器歷史、可能被截圖或轉貼，
 * 它等於一把能讀整份會議的鑰匙。
 */

/** 兩分鐘。夠慢的網路按一下，不夠拿去分享。 */
export const EXPORT_TTL_MS = 2 * 60_000;

/**
 * 這條網址是拿來做什麼的。簽進雜湊裡，一條網址就只能做一件事——
 * 「下載 Word」的網址換不到「PDF」，更換不到 page（那是整頁內容，
 * 給 headless Chromium 讀的，見 lib/pdf.ts）。
 * trial 是首頁試用頁的入場憑證（issue #19）：試用不綁 LINE 身分，
 * 這條簽章就是身分，效期跟著試用頁的 24 小時走、換不到任何匯出。
 */
export type ExportPurpose = "docx" | "pdf" | "page" | "trial";

/**
 * 簽章金鑰。刻意不另開一個 env——多一個變數就多一個「上線回填」的步驟，
 * 而漏填會變成靜默的安全洞。從 channel secret 推導並加上用途字串隔離，
 * 這條金鑰算出來的簽章跟 webhook 驗簽互不通用。
 */
function key(): Buffer {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) throw new Error("缺 LINE_CHANNEL_SECRET，無法簽匯出網址");
  return createHmac("sha256", secret).update("chengshisuo:export-url").digest();
}

function sign(id: string, purpose: ExportPurpose, expiresAt: number): string {
  // 欄位之間用不會出現在 id／用途裡的分隔字元，避免不同組合湊出同一份訊息
  return createHmac("sha256", key()).update(`${id}\n${purpose}\n${expiresAt}`).digest("hex");
}

/**
 * 產查詢字串（不含 ?）：`e=<到期毫秒>&s=<簽章>`。
 * ttlMs 預設兩分鐘（匯出用）；trial 用途傳 TRIAL_PAGE_TTL_MS——效期簽在 e 裡，
 * 驗章端不必知道這條當初簽了多久。
 */
export function signedExportQuery(
  id: string,
  purpose: ExportPurpose,
  now: number,
  ttlMs: number = EXPORT_TTL_MS,
): string {
  const expiresAt = now + ttlMs;
  return new URLSearchParams({ e: String(expiresAt), s: sign(id, purpose, expiresAt) }).toString();
}

/** 驗簽章與效期。缺參數、格式不對、過期、簽不符——一律 false，不丟例外。 */
export function verifyExportQuery(
  id: string,
  purpose: ExportPurpose,
  params: URLSearchParams,
  now: number,
): boolean {
  const expiresAt = Number(params.get("e"));
  const got = params.get("s");
  if (!Number.isSafeInteger(expiresAt) || !got) return false;
  if (now > expiresAt) return false;

  const want = Buffer.from(sign(id, purpose, expiresAt), "hex");
  const mine = Buffer.from(got, "hex");
  // 長度不同 timingSafeEqual 會丟例外，先擋掉
  return mine.length === want.length && timingSafeEqual(mine, want);
}
