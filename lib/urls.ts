/**
 * 記錄頁連結。有 LIFF ID 一律發 liff.line.me 深連結——在 LINE 內點開直接帶身分，
 * 這條連結就是「LIFF 綁 LINE 身分、只有本人打得開」的入口。
 * 前提：LIFF app 的 Endpoint URL 設在網域根（部署時把精靈填的佔位 /liff 改掉），
 * liff.line.me 後面的路徑才會原樣接到 /m/{id}。
 */
export function meetingPageUrl(meetingId: string): string {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (liffId) return `https://liff.line.me/${liffId}/m/${meetingId}`;
  const base = process.env.APP_BASE_URL || "http://localhost:3000";
  return `${base}/m/${meetingId}`;
}

/** 示範記錄頁（issue #15 在 LINE 裡回「範例」用）。公開頁、沒有身分閘門，不走 LIFF。 */
export function demoPageUrl(): string {
  const base = process.env.APP_BASE_URL || "http://localhost:3000";
  return `${base}/demo`;
}
