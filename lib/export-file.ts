import { exportBaseName, meetingToDocx } from "./docx";
import { display, displayTurns } from "./transcript";
import type { Meeting } from "./types";

/**
 * 把一場會議做成可下載的回應。
 *
 * 為什麼由伺服器出檔而不是前端組完直接下載：LINE 的 iOS 內建瀏覽器沒有 <a download>，
 * blob 按了靜默失敗。給瀏覽器一條真網址才有救——iOS 用 QuickLook 預覽、
 * Android 的 LINE 直接下載、桌機正常存檔。
 *
 * Word 就地組（lib/docx.ts 前後端通用）；PDF 交給 headless Chromium 跑同一份
 * 列印樣式（lib/pdf.ts），所以這裡只有 PDF 這條需要一個「頁面網址」。
 */

const MIME = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
} as const;

export type ExportFormat = keyof typeof MIME;

/** 看不懂的格式一律當 docx——網址上的東西不能信，但也不值得為它回 400。 */
export function parseFormat(raw: string | null): ExportFormat {
  return raw === "pdf" ? "pdf" : "docx";
}

/**
 * Content-Disposition 的檔名。中文檔名一定要走 RFC 5987 的 filename*，
 * 但老瀏覽器只看 filename——所以兩個都給，ASCII 那份濾掉非 ASCII 當退路。
 */
function disposition(base: string, ext: ExportFormat): string {
  const ascii = base.replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "").trim() || "meeting";
  return `attachment; filename="${ascii}.${ext}"; filename*=UTF-8''${encodeURIComponent(base)}.${ext}`;
}

function docxBytes(m: Meeting): Uint8Array {
  // 錯詞替換與說話人修正是「顯示時才套用」（turns 永不落改，見 lib/types.ts），
  // 所以匯出也要走同一支 displayTurns——不然下載到的會是修正前的舊字。
  return meetingToDocx({ ...m, turns: displayTurns(m) }, (label) => display(m, label));
}

/**
 * pageUrl 只有 PDF 用得到：那是 headless Chromium 要去讀的記錄頁網址，
 * 必須是「打得開就看得到內容」的（簽章網址或公開的分享頁）。
 */
export async function exportResponse(
  m: Meeting,
  format: ExportFormat,
  pageUrl: string,
): Promise<Response> {
  let bytes: Uint8Array;
  if (format === "pdf") {
    // 動態 import：Chromium 那包很大，Word 的路徑不該為它付冷啟動的錢
    const { renderPdf } = await import("./pdf");
    bytes = await renderPdf(pageUrl);
  } else {
    bytes = docxBytes(m);
  }

  return new Response(bytes as BodyInit, {
    headers: {
      "content-type": MIME[format],
      "content-disposition": disposition(exportBaseName(m.summary.title), format),
      "content-length": String(bytes.length),
      // 網址帶短效簽章，中間層不該留下任何一份
      "cache-control": "private, no-store",
    },
  });
}

/** 記錄頁保留期到了就當作不存在（跟 app/api/m/[id] 同一條規則）。 */
export function isExpired(m: Meeting, now: number): boolean {
  return !!m.expiresAt && Date.parse(m.expiresAt) < now;
}
