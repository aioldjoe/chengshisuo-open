import { PLANS, planFromSubscription, type PaidPlanId, type PlanId } from "./plans";

/**
 * 網頁直接訂閱（issue #20）的純判定。頁面與 API route 只負責把這裡的決定翻成 HTTP。
 * 不碰 env、不碰 repo——env 的就緒判斷（LIFF、Stripe）在呼叫端算好傳進來。
 */

/** ?plan= 的白名單。free 不是可訂閱的檔，其餘一律當作沒帶。 */
export function parsePlanParam(raw: unknown): PaidPlanId | null {
  return raw === "lite" || raw === "standard" ? raw : null;
}

export function subscribePath(plan: PaidPlanId): string {
  return `/subscribe?plan=${plan}`;
}

export type SubscribeAction =
  | { kind: "portal"; customerId: string }
  | { kind: "checkout"; customerId: string | null };

/**
 * 這個人該去 Checkout 還是 Portal。
 *
 * 權益還活著（含已取消但本期未滿——planFromSubscription 的定義）就導 Portal：
 * 恢復訂閱、換檔都在那裡做，再開一筆 Checkout 會變成同一人兩份訂閱、雙重扣款。
 * 權益已失效的舊客回 Checkout，但帶上舊 customerId——不帶的話 Stripe 會生出
 * 第二個 customer，之後 Portal 與對帳都會找錯人。
 *
 * 刻意問訂閱表而不是 entitledPlanForUser（CLAUDE.md 那條規則管的是權益閘門）：
 * 這裡判的是「Stripe 有沒有這筆訂閱可管」——解鎖碼給的權益沒有 customer，
 * 導 Portal 只會爆錯；而解鎖碼用戶真想付錢訂閱，也不該被擋在 Checkout 外。
 */
export function checkoutOrPortal(
  sub: {
    plan: PlanId;
    status: string;
    currentPeriodEnd: string | null;
    stripeCustomerId: string | null;
  } | null,
  now: number,
): SubscribeAction {
  const entitled = planFromSubscription(sub, now);
  if (sub && PLANS[entitled].paidPerks && sub.stripeCustomerId) {
    return { kind: "portal", customerId: sub.stripeCustomerId };
  }
  return { kind: "checkout", customerId: sub?.stripeCustomerId ?? null };
}

/**
 * 定價卡付費按鈕該指哪裡：web 訂閱就緒（LIFF 拿得到身分且 Stripe 已接）走 /subscribe，
 * 否則退回 #16 的預填訊息深連結；連那條都組不出來就 null，呼叫端給退路文字。
 */
export function upgradeHref(
  plan: PaidPlanId,
  opts: { webReady: boolean; prefillUrl: string | null },
): string | null {
  return opts.webReady ? subscribePath(plan) : opts.prefillUrl;
}
