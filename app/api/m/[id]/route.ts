import { verifyRequestUser } from "@/lib/auth";
import { AUDIO_TTL_MS } from "@/lib/cleanup";
import { verifyExportQuery } from "@/lib/export-url";
import { applyMeetingEdits } from "@/lib/meeting-edit";
import { getRepo } from "@/lib/store/meetings";
import { entitledPlanForUser } from "@/lib/billing";
import { purgeMeeting } from "@/lib/store/purge";
import { hasR2, presignGetUrl } from "@/lib/store/r2";

/**
 * 記錄頁的資料 API。編輯（重點區＋說話人命名）走 PATCH，
 * 刪除鍵（真刪）走 DELETE；二次確認由前端動線負責。
 * 「不存在」與「不是你的」一律 404——不對外洩漏會議存在性。
 */

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await verifyRequestUser(req);
  // 第二條入口：兩分鐘有效的簽章。只給 GET，而且只有 PDF 那條路會用——
  // headless Chromium 要用真的記錄頁排版（見 lib/pdf.ts），它帶不了 LIFF token。
  // PATCH／DELETE 一律不接受簽章：讀得到不等於改得動。
  const signed = verifyExportQuery(id, "page", new URL(req.url).searchParams, Date.now());
  if (!user && !signed) return new Response("unauthorized", { status: 401 });

  const m = await getRepo().get(id);
  if (!m || (!signed && m.userId !== user)) return new Response("not found", { status: 404 });
  if (m.expiresAt && Date.parse(m.expiresAt) < Date.now()) {
    return new Response("not found", { status: 404 });
  }

  // 原音回放：音檔還在（AUDIO_TTL_MS 內）才給限時連結，時效不超過銷毀時刻
  let audioUrl: string | null = null;
  if (m.audioKey && hasR2()) {
    const remainMs = Date.parse(m.createdAt) + AUDIO_TTL_MS - Date.now();
    if (remainMs > 0) audioUrl = presignGetUrl(m.audioKey, Math.min(3600, Math.ceil(remainMs / 1000)));
  }

  // 方案一起給：記錄頁要知道 PDF／分享該不該上鎖。簽章進來的（PDF 渲染）沒有身分，
  // 給 owner 的方案就好——那份 PDF 本來就是付費用戶要的。
  const plan = await entitledPlanForUser(m.userId);
  return Response.json({ meeting: m, audioUrl, plan });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await verifyRequestUser(req);
  if (!user) return new Response("unauthorized", { status: 401 });

  const m = await getRepo().get(id);
  if (!m || m.userId !== user) return new Response("not found", { status: 404 });

  let patch: unknown;
  try {
    patch = await req.json();
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const edited = applyMeetingEdits(m, patch);
  if (!edited) return new Response("bad patch", { status: 400 });

  await getRepo().save(edited);
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await verifyRequestUser(_req);
  if (!user) return new Response("unauthorized", { status: 401 });

  const m = await getRepo().get(id);
  if (!m || m.userId !== user) return new Response("not found", { status: 404 });

  await purgeMeeting(m);
  return Response.json({ ok: true });
}
