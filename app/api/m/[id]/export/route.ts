import { verifyRequestUser } from "@/lib/auth";
import { exportResponse, isExpired, parseFormat } from "@/lib/export-file";
import { signedExportQuery, verifyExportQuery } from "@/lib/export-url";
import { paidPerksResponse } from "@/lib/billing";
import { getRepo } from "@/lib/store/meetings";

/**
 * 記錄頁的匯出（Word／PDF），兩步：
 *
 *   POST（帶 LIFF id token）→ 換一條兩分鐘有效的簽章網址
 *   GET（帶簽章）→ 真的把檔案吐出來
 *
 * 之所以要兩步，是因為前端不是「下載」而是「導頁」——導頁帶不了 Authorization
 * header，憑證只能放網址上。而 blob 下載在 LINE 的 iOS 內建瀏覽器按了沒反應
 * （WKWebView 沒實作 <a download>），導頁是唯一在 LINE 裡走得完的路。
 *
 * 「不存在」與「不是你的」一律 404，跟 app/api/m/[id] 同一條線——不洩漏會議存在性。
 *
 * PDF 是付費加值（GLOSSARY.md 的方案與價格），免費用戶擋在 POST 這關並回 402：
 * 402 而不是 403，是為了讓前端分得出「不是你的」與「升級就有」——後者要導向付款，
 * 不是道歉。Word 匯出所有人都有，體驗核心不上鎖（GLOSSARY.md「免費版」）。
 */

export const runtime = "nodejs";
/** PDF 要開 Chromium，冷啟動就要好幾秒；Word 幾十毫秒，共用上限沒差。 */
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const format = parseFormat(new URL(req.url).searchParams.get("format"));
  const user = await verifyRequestUser(req);
  if (!user) return new Response("unauthorized", { status: 401 });

  const m = await getRepo().get(id);
  if (!m || m.userId !== user || isExpired(m, Date.now())) {
    return new Response("not found", { status: 404 });
  }

  if (format === "pdf") {
    const blocked = await paidPerksResponse(user);
    if (blocked) return blocked;
  }

  const q = signedExportQuery(id, format, Date.now());
  return Response.json({ url: `/api/m/${id}/export?format=${format}&${q}` });
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const format = parseFormat(url.searchParams.get("format"));
  if (!verifyExportQuery(id, format, url.searchParams, Date.now())) {
    return new Response("not found", { status: 404 });
  }

  const m = await getRepo().get(id);
  if (!m || isExpired(m, Date.now())) return new Response("not found", { status: 404 });

  // PDF 要 headless Chromium 去讀「真的記錄頁」，所以再簽一條 page 用途的網址
  // 給它——同一份 @media print，印出來就是使用者看到的樣子（見 lib/pdf.ts）。
  const pageUrl = `${process.env.APP_BASE_URL || url.origin}/m/${id}?${signedExportQuery(id, "page", Date.now())}`;
  return exportResponse(m, format, pageUrl);
}
