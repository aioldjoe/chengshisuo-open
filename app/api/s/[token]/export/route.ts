import { exportResponse, isExpired, parseFormat } from "@/lib/export-file";
import { PLANS } from "@/lib/plans";
import { getRepo } from "@/lib/store/meetings";
import { entitledPlanForUser } from "@/lib/billing";

/**
 * 分享頁的匯出（Word／PDF）。不用簽章——token 本身就是憑證（跟 app/api/s/[token]
 * 同一條線），所以一步就到：前端直接把瀏覽器導過來。
 *
 * PDF 交給 headless Chromium 讀的也是這條公開的分享頁，不必另外簽網址。
 *
 * PDF 看的是**主人**的方案，不是訪客的（訪客根本沒有身分）：主人還在付費就給，
 * 這頁是病毒迴路的門面，在訪客面前上鎖只會擋到潛在客戶。但主人降回免費檔之後
 * 這條路要跟著關——否則他用自己的舊分享連結就繞過了 PDF 付費牆。
 * 頁面本身照樣打得開：已經傳出去的連結不該因為主人退訂就變成死連結。
 */

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const url = new URL(req.url);
  const format = parseFormat(url.searchParams.get("format"));

  const m = await getRepo().getByShareToken(token);
  if (!m || isExpired(m, Date.now())) return new Response("not found", { status: 404 });

  if (format === "pdf" && !PLANS[await entitledPlanForUser(m.userId)].paidPerks) {
    return Response.json({ error: "paid-only" }, { status: 402 });
  }

  return exportResponse(m, format, `${process.env.APP_BASE_URL || url.origin}/s/${token}`);
}
