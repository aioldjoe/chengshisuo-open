import { after } from "next/server";

import { AUDIO_TTL_MS } from "@/lib/cleanup";
import { recordEvent } from "@/lib/store/events";
import { getRepo } from "@/lib/store/meetings";
import { hasR2, presignGetUrl } from "@/lib/store/r2";

/**
 * 唯讀分享連結的公開讀取——不吃 LINE 身分，token 本身就是憑證。
 * 只回 GET，沒有 PATCH/DELETE：分享出去的人看得到但改不了、刪不掉。
 * userId／shareToken 不外流——拿到連結的人不需要知道建立者是誰。
 *
 * 開啟數在這裡記（issue #7）：這是分享頁唯一的取資料入口，本人那條
 * app/m/[id] 不經過這裡，兩邊天生分開。粗略計數就好——不去重同一個人重整，
 * dev 的 StrictMode 還會讓每次開啟記兩筆，正式環境才是一次。
 */

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const m = await getRepo().getByShareToken(token);
  if (!m) return new Response("not found", { status: 404 });
  if (m.expiresAt && Date.parse(m.expiresAt) < Date.now()) {
    return new Response("not found", { status: 404 });
  }

  let audioUrl: string | null = null;
  if (m.audioKey && hasR2()) {
    const remainMs = Date.parse(m.createdAt) + AUDIO_TTL_MS - Date.now();
    if (remainMs > 0) audioUrl = presignGetUrl(m.audioKey, Math.min(3600, Math.ceil(remainMs / 1000)));
  }

  // 回應送出後才記，量測不佔使用者等待的時間；recordEvent 自己吞錯誤
  after(() => recordEvent("share_opened", null, m.id));

  const { userId: _userId, shareToken: _shareToken, ...meeting } = m;
  return Response.json({ meeting, audioUrl });
}
