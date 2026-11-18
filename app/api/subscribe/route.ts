import { verifyRequestUser } from "@/lib/auth";
import { getSubscriptionsRepo } from "@/lib/store/subscriptions";
import { createCheckoutUrl, createPortalUrl, hasStripe } from "@/lib/stripe";
import { checkoutOrPortal, parsePlanParam } from "@/lib/subscribe";

/**
 * 網頁直接訂閱（issue #20）：/subscribe 頁用 LIFF 拿到 id token 後打這裡，
 * 換一條 Stripe 網址回去導頁。已有有效訂閱導 Portal 而不是重複開一筆
 * （判定在 lib/subscribe.ts）。身分沿用 verifyRequestUser——跟記錄頁同一道閘門，
 * 驗出來的 userId 就是 webhook 認得的那一個。
 */

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await verifyRequestUser(req);
  if (!user) return new Response("unauthorized", { status: 401 });

  const plan = parsePlanParam((await req.json().catch(() => ({}))).plan);
  if (!plan) return new Response("bad plan", { status: 400 });

  // 頁面端就緒才會給按鈕，但直接打 API 的人還是要一句實話
  if (!hasStripe()) return new Response("stripe not configured", { status: 503 });

  const action = checkoutOrPortal(await getSubscriptionsRepo().get(user), Date.now());
  try {
    const url =
      action.kind === "portal"
        ? await createPortalUrl(action.customerId, { via: "web" })
        : await createCheckoutUrl({ userId: user, plan, customerId: action.customerId, via: "web" });
    return Response.json({ url });
  } catch (e) {
    console.error("[subscribe] 開 Stripe 連結失敗", { user, plan, kind: action.kind }, e);
    return new Response("stripe error", { status: 502 });
  }
}
