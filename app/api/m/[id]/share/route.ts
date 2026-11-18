import { verifyRequestUser } from "@/lib/auth";
import { paidPerksResponse } from "@/lib/billing";
import { generateShareToken } from "@/lib/share-token";
import { getRepo } from "@/lib/store/meetings";

/**
 * 唯讀分享連結的開關。POST 產生（或換發）一組 token，DELETE 撤銷。
 * 只有 owner 能動——身分閘門跟 app/api/m/[id]/route.ts 同一套。
 * 公開讀取走另一支 app/api/s/[token]/route.ts，不吃這裡的 LINE 驗證。
 *
 * 開分享是付費加值（同 PDF 匯出），免費用戶在 POST 這關收 402。撤銷不擋——
 * 降回免費檔的人要收回舊連結，永遠該做得到。
 */

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await verifyRequestUser(req);
  if (!user) return new Response("unauthorized", { status: 401 });

  const m = await getRepo().get(id);
  if (!m || m.userId !== user) return new Response("not found", { status: 404 });

  const blocked = await paidPerksResponse(user);
  if (blocked) return blocked;

  const shareToken = generateShareToken();
  await getRepo().save({ ...m, shareToken });
  return Response.json({ shareToken });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await verifyRequestUser(req);
  if (!user) return new Response("unauthorized", { status: 401 });

  const m = await getRepo().get(id);
  if (!m || m.userId !== user) return new Response("not found", { status: 404 });

  await getRepo().save({ ...m, shareToken: null });
  return Response.json({ ok: true });
}
