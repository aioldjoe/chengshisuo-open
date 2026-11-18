import { pushText } from "@/lib/line";
import { PLANS, planFromSubscription } from "@/lib/plans";
import { getSubscriptionsRepo } from "@/lib/store/subscriptions";
import { priceMap, subscriptionFromEvent, verifyStripeSignature } from "@/lib/stripe";

/**
 * Stripe webhook：訂閱狀態的唯一真相來源在 Stripe，這支只負責同步到我們這邊。
 * 訂閱事件帶著 metadata.line_user_id，所以「誰付了錢」直接對得回 LINE 帳號，
 * 不必做帳號綁定的步驟（零摩擦）。
 *
 * 認不出主人／認不出方案的事件一律當作沒發生（回 200 讓 Stripe 別重送，
 * 但不寫任何東西）——寧可有人沒拿到權益來問，也不要把權益發給錯的人。
 *
 * Stripe 後台要訂閱的事件：customer.subscription.created / updated / deleted。
 */

export const runtime = "nodejs";

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyStripeSignature(raw, req.headers.get("stripe-signature"), process.env.STRIPE_WEBHOOK_SECRET, Date.now())) {
    return new Response("bad signature", { status: 400 });
  }

  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  const update = subscriptionFromEvent(event, priceMap());
  if (!update) return Response.json({ ok: true, ignored: true });

  const repo = getSubscriptionsRepo();
  const before = await repo.get(update.userId);
  const wasPlan = planFromSubscription(before, Date.now());
  const nowPlan = planFromSubscription(update, Date.now());
  await repo.save(update);

  // 只在「開通」與「換檔」這兩個時刻說話：續訂每個月都發事件，
  // 每次都恭喜一次會變成月經文，而扣款失敗的催收是 Stripe 的事。
  if (nowPlan !== "free" && nowPlan !== wasPlan) {
    const p = PLANS[nowPlan];
    await pushText(update.userId, [
      `訂閱成功 ✦ 你現在是${p.name}檔：每月 ${p.monthlyHours} 小時、單場不限長、記錄頁永久保留，PDF 匯出與分享也開好了。\n\n直接把錄音傳進來就行。想看用量隨時傳「額度」，要換檔或取消傳「訂閱」。`,
    ]).catch((e) => console.error("[stripe] 開通通知送不出去", { userId: update.userId }, e));
  }

  return Response.json({ ok: true });
}
