import { verifyRequestUser } from "@/lib/auth";
import { AUDIO_TTL_HOURS } from "@/lib/cleanup";
import { entitledPlanForUser } from "@/lib/billing";
import { verifyExportQuery } from "@/lib/export-url";
import { meetingReadyFlex, taipeiDateLabel } from "@/lib/flex";
import { pushFlexOrText } from "@/lib/line";
import { PLANS } from "@/lib/plans";
import { recordEvent } from "@/lib/store/events";
import { getRepo } from "@/lib/store/meetings";
import { isTrialMeeting } from "@/lib/trial";
import { meetingPageUrl } from "@/lib/urls";

/**
 * 認領試用場次（issue #19 的第 5 點）：LIFF 頁帶著 trial 簽章＋LINE 身分進來，
 * 把 trial:<ipHash> 換成真的 userId，保留期改按方案規則——加好友的回報就是
 * 「這份從此是你的」。兩道憑證缺一不可：簽章證明你拿得到試用連結，
 * id token 證明你是誰。
 */

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const now = Date.now();
  if (!verifyExportQuery(id, "trial", new URL(req.url).searchParams, now)) {
    return new Response("unauthorized", { status: 401 });
  }
  const user = await verifyRequestUser(req);
  if (!user) return new Response("unauthorized", { status: 401 });

  const m = await getRepo().get(id);
  if (!m) return new Response("not found", { status: 404 });
  if (!isTrialMeeting(m.userId)) {
    // 重按、回上一頁再按——本人重複認領當成功；被別人搶先就當不存在
    return m.userId === user
      ? Response.json({ ok: true })
      : new Response("not found", { status: 404 });
  }

  // 保留期改按正式規則，從認領當下起算（同 cron 對退訂的 make-expiring：
  // 從建立起算等於偷走已經過掉的天數）
  const plan = await entitledPlanForUser(user);
  const pageDays = PLANS[plan].pageDays;
  await getRepo().save({
    ...m,
    userId: user,
    expiresAt: pageDays === null ? null : new Date(now + pageDays * 86400_000).toISOString(),
  });

  await recordEvent("trial_claimed", user, id);
  // 認領後這場就是他名下的一場會議——不補 meeting_created 的話，
  // 只試用過的人在留存報表裡是隱形的（lib/metrics.ts 只認 meeting_created）
  await recordEvent("meeting_created", user, id);

  // 把完成卡補進聊天室：LIFF 關掉之後，聊天室裡要有一條路回得到這份記錄。
  // 沒加好友的人 push 不進去——認領照樣成立，LIFF 頁上那顆「打開記錄頁」還在。
  await pushFlexOrText(
    user,
    [
      meetingReadyFlex({
        title: m.summary.title,
        dateLabel: taipeiDateLabel(m.createdAt),
        durationSeconds: m.durationSeconds ?? null,
        highlights: m.summary.highlights,
        url: meetingPageUrl(id),
        pageDays,
      }),
    ],
    `「${m.summary.title}」已存進你的帳號 ✦\n${meetingPageUrl(id)}\n\n${
      pageDays === null ? "記錄頁永久保留" : `記錄頁保留 ${pageDays} 天`
    }；錄音檔 ${AUDIO_TTL_HOURS} 小時後自動銷毀。`,
  ).catch((e) => console.error("[trial] 認領後補卡失敗（多半是還沒加好友）", e));

  return Response.json({ ok: true });
}
