import { AUDIO_TTL_MS } from "@/lib/cleanup";
import { verifyExportQuery } from "@/lib/export-url";
import { getRepo } from "@/lib/store/meetings";
import { hasR2, presignGetUrl } from "@/lib/store/r2";
import { isTrialMeeting } from "@/lib/trial";
import { meetingPageUrl } from "@/lib/urls";

/**
 * 試用記錄頁的資料 API（issue #19）。沒有 LINE 身分——上傳完成時發的
 * trial 簽章就是憑證（24 小時，跟頁面同壽命）。唯讀：這裡只有 GET，
 * 編輯、匯出、分享都不存在，那些是加好友之後的事。
 */

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!verifyExportQuery(id, "trial", new URL(req.url).searchParams, Date.now())) {
    return new Response("unauthorized", { status: 401 });
  }

  const m = await getRepo().get(id);
  if (!m) return new Response("not found", { status: 404 });

  // 已被認領：這場現在是某個 LINE 帳號的了，試用連結不再給內容——
  // 給一個「去 LINE 開」的出口就好（多半就是本人回頭開舊分頁）
  if (!isTrialMeeting(m.userId)) {
    return Response.json({ claimed: true, lineUrl: meetingPageUrl(id) });
  }
  if (m.expiresAt && Date.parse(m.expiresAt) < Date.now()) {
    return new Response("not found", { status: 404 });
  }

  let audioUrl: string | null = null;
  if (m.audioKey && hasR2()) {
    const remainMs = Date.parse(m.createdAt) + AUDIO_TTL_MS - Date.now();
    if (remainMs > 0) audioUrl = presignGetUrl(m.audioKey, Math.min(3600, Math.ceil(remainMs / 1000)));
  }

  // userId 帶著 IP 雜湊、shareToken 是別條路的憑證——都不出門
  const { userId: _u, shareToken: _s, ...pub } = m;
  return Response.json({ claimed: false, meeting: pub, audioUrl });
}
