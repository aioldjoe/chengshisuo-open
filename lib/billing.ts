import {
  PLANS,
  checkQuota,
  entitledPlan,
  planFromSubscription,
  quotaWindowStart,
  usageOf,
  type PlanId,
  type QuotaUsage,
  type QuotaVerdict,
} from "./plans";
import { getRepo } from "./store/meetings";
import { getSubscriptionsRepo, planForUser, type Subscription } from "./store/subscriptions";
import { createCheckoutUrl, createPortalUrl, hasStripe } from "./stripe";
import type { UpsellLinks } from "./upsell";

/**
 * 額度閘門的伺服器端組裝：方案 × 當期用量 × 付款連結。
 * server-only（碰 repo 與 Stripe），別從 client 元件 import——純判定在 lib/plans.ts。
 */

export type Standing = {
  plan: PlanId;
  usage: QuotaUsage;
  /** 訂閱列；沒訂閱過為 null。帶著走是為了讓付款連結與管理入口不必再查一次同一列。 */
  subscription: Subscription | null;
  /** 解鎖碼開的後門：完全不受額度限制（ops 用，不是方案）。 */
  unlimited: boolean;
};

export async function standingFor(userId: string, when = new Date()): Promise<Standing> {
  const [subscription, unlimited] = await Promise.all([
    getSubscriptionsRepo().get(userId),
    getRepo().isUnlimited(userId),
  ]);
  const plan = planFromSubscription(subscription, when.getTime());
  // 起算點：免費檔是月初，付費檔是 Stripe 的帳期起點（20 號刷卡就 20 號重置）
  const since = quotaWindowStart(plan, subscription?.currentPeriodStart ?? null, when);
  return { plan, usage: usageOf(await getRepo().listSince(userId, since)), subscription, unlimited };
}

/** 這場收不收。解鎖碼一律放行。 */
export function verdictFor(s: Standing, incomingSeconds: number | null): QuotaVerdict {
  if (s.unlimited) return { ok: true };
  return checkQuota(PLANS[s.plan], s.usage, incomingSeconds);
}

/**
 * 開兩條付款連結給撞牆訊息用。Stripe 沒接好或開連結失敗一律回空物件——
 * 額度訊息本身不能因為金流出事就發不出去（撞牆的人已經夠不爽了）。
 */
export async function upsellLinks(s: Standing, userId: string): Promise<UpsellLinks> {
  if (!hasStripe() || s.plan === "standard") return {};
  const customerId = s.subscription?.stripeCustomerId ?? null;
  const want: ("lite" | "standard")[] = s.plan === "free" ? ["lite", "standard"] : ["standard"];
  const out: UpsellLinks = {};
  await Promise.all(
    want.map(async (p) => {
      try {
        out[p] = await createCheckoutUrl({ userId, plan: p, customerId });
      } catch (e) {
        console.error("[billing] 開付款連結失敗", { userId, plan: p }, e);
      }
    }),
  );
  return out;
}

/** 訂閱管理連結；沒有 Stripe customer（沒付過錢）就沒有這個入口。 */
export async function portalUrlFor(s: Standing): Promise<string | null> {
  const customerId = s.subscription?.stripeCustomerId;
  if (!customerId) return null;
  try {
    return await createPortalUrl(customerId);
  } catch (e) {
    console.error("[billing] 開訂閱管理連結失敗", { customerId }, e);
    return null;
  }
}

/**
 * 這個人現在該吃哪一檔的權益：訂閱 × 解鎖碼（見 entitledPlan）。
 *
 * 加值閘門與 cron 保留期都問這支，不要直接問 planForUser——那支只回答訂閱表怎麼說，
 * 漏掉解鎖碼的話，被開通的人會遇到「額度無限但 PDF 按不動、記錄頁 30 天蒸發」。
 */
export async function entitledPlanForUser(userId: string): Promise<PlanId> {
  const [plan, unlimited] = await Promise.all([planForUser(userId), getRepo().isUnlimited(userId)]);
  return entitledPlan(plan, unlimited);
}

/**
 * 付費加值（PDF 匯出、分享）的閘門。給 API route 用：擋下就回 402——
 * 402 而不是 403，前端才分得出「不是你的」與「升級就有」，後者要導向付款不是道歉。
 */
export async function paidPerksResponse(userId: string): Promise<Response | null> {
  const plan = await entitledPlanForUser(userId);
  return PLANS[plan].paidPerks ? null : Response.json({ error: "paid-only" }, { status: 402 });
}
