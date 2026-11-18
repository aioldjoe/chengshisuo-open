import { createHmac, timingSafeEqual } from "node:crypto";

import type { PlanId } from "./plans";

/**
 * Stripe 水管層（手寫 fetch，零依賴——同 lib/line.ts、lib/store/r2.ts 的作風）。
 * 收款主體 海外公司；台灣公司成立後再接 LINE Pay，屆時換的是這一層。
 *
 * 身分即 LINE userId：訂閱的主人靠 subscription.metadata.line_user_id 認，
 * 不靠 email、不靠 Stripe customer——那兩個都可能對不回 LINE 帳號。
 * 認不出主人的訂閱一律不給權益（見 subscriptionFromEvent）。
 */

const STRIPE_API = "https://api.stripe.com/v1";

/** 兩檔的 Stripe price id。 */
export type PriceMap = { lite: string; standard: string };

export function hasStripe(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_LITE && process.env.STRIPE_PRICE_STANDARD);
}

export function priceMap(env: NodeJS.ProcessEnv = process.env): PriceMap {
  return { lite: env.STRIPE_PRICE_LITE ?? "", standard: env.STRIPE_PRICE_STANDARD ?? "" };
}

/** price id → 方案。空字串不算數（env 沒填時別讓所有未知 price 都變輕量檔）。 */
export function planForPrice(priceId: string | null | undefined, prices: PriceMap): PlanId | null {
  if (!priceId) return null;
  if (prices.lite && priceId === prices.lite) return "lite";
  if (prices.standard && priceId === prices.standard) return "standard";
  return null;
}

/* ------------------------------ webhook 驗簽 ------------------------------ */

/** 時間戳容忍值。Stripe 官方預設 5 分鐘——重放窗口就這麼寬。 */
const TOLERANCE_S = 300;

/**
 * 驗 Stripe-Signature：`t=<秒>,v1=<hex>`，簽的是 `${t}.${rawBody}`。
 * 換金鑰期間 Stripe 會一次送多組 v1，任一組對就算過。
 * 壞頭、過期、沒設 secret 一律 false，不丟例外——webhook 端只想知道能不能信。
 */
export function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string | undefined,
  now: number,
): boolean {
  if (!header || !secret) return false;

  let t: number | null = null;
  const sigs: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.trim().split("=", 2);
    if (k === "t" && /^\d+$/.test(v ?? "")) t = Number(v);
    else if (k === "v1" && v) sigs.push(v);
  }
  if (t === null || sigs.length === 0) return false;
  if (Math.abs(now / 1000 - t) > TOLERANCE_S) return false;

  const want = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"));
  return sigs.some((s) => {
    const got = Buffer.from(s);
    return got.length === want.length && timingSafeEqual(got, want);
  });
}

/* --------------------------- 事件 → 訂閱狀態 --------------------------- */

/** 落庫前的訂閱狀態（不含 updatedAt，那是儲存層蓋的）。 */
export type SubscriptionUpdate = {
  userId: string;
  plan: PlanId;
  /** Stripe 的原始 status；解讀成權益是 planFromSubscription 的事。 */
  status: string;
  /** 本期帳單的起點——付費額度就從這一刻起算（見 quotaWindowStart）。 */
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
};

const SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

/** 秒級 epoch → ISO；不是數字就 null。 */
function isoFromEpoch(v: unknown): string | null {
  return typeof v === "number" && Number.isFinite(v) ? new Date(v * 1000).toISOString() : null;
}

/**
 * Stripe 事件 → 該寫進訂閱表的狀態。認不出主人或認不出方案就回 null——
 * 寧可讓這筆訂閱沒有權益（人來問就查得到），也不要猜錯把權益發給別人。
 *
 * 只吃 customer.subscription.*：續訂、升降級、取消都會發這組，
 * 一種事件就把訂閱的整個生命週期涵蓋完，不必再追 invoice。
 */
export function subscriptionFromEvent(event: unknown, prices: PriceMap): SubscriptionUpdate | null {
  const e = event as { type?: string; data?: { object?: Record<string, unknown> } } | null;
  if (!e?.type || !SUBSCRIPTION_EVENTS.has(e.type)) return null;
  const o = e.data?.object;
  if (!o) return null;

  const userId = str((o.metadata as Record<string, unknown> | undefined)?.line_user_id);
  if (!userId) return null;

  const item = ((o.items as { data?: Record<string, unknown>[] } | undefined)?.data ?? [])[0];
  // price 是 2020-08-27 之後的形狀；更舊的 API 版本（帳號預設版本可能停在很久以前）
  // 送來的是 plan，連 items 都可能沒有。webhook 端點該選最新版本，但這裡多讀兩處——
  // 設定選錯的下場是「錢收得到、權益不開通」，而那是沒有人會發現的靜默失敗。
  const priceId =
    str((item?.price as { id?: unknown } | undefined)?.id) ??
    str((item?.plan as { id?: unknown } | undefined)?.id) ??
    str((o.plan as { id?: unknown } | undefined)?.id);
  const plan = planForPrice(priceId, prices);
  if (!plan) return null;

  return {
    userId,
    // 刪除事件的 object 有時仍帶著舊 status，以事件本身為準
    status: e.type === "customer.subscription.deleted" ? "canceled" : (str(o.status) ?? "unknown"),
    plan,
    // 2025 年起帳期欄位從訂閱挪到 item 上，新舊兩處都讀
    currentPeriodStart:
      isoFromEpoch(o.current_period_start) ?? isoFromEpoch(item?.current_period_start),
    currentPeriodEnd: isoFromEpoch(o.current_period_end) ?? isoFromEpoch(item?.current_period_end),
    stripeCustomerId: str(o.customer),
    stripeSubscriptionId: str(o.id),
  };
}

/* ------------------------------ API 呼叫 ------------------------------ */

async function stripeFetch(path: string, form: Record<string, string>): Promise<unknown> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY 未設定");
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form).toString(),
  });
  if (!res.ok) {
    throw new Error(`Stripe ${res.status} ${path}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

function baseUrl(): string {
  return process.env.APP_BASE_URL || "http://localhost:3000";
}

/**
 * 開一條付款連結（Checkout Session）。LINE 裡發給使用者，他在外部瀏覽器付完，
 * 由 webhook 把訂閱狀態同步回來——不做回跳認證，那會逼出登入步驟（零摩擦第一條）。
 */
export async function createCheckoutUrl(input: {
  userId: string;
  plan: "lite" | "standard";
  /** 已知的 Stripe customer（換檔時帶上，免得同一人生出兩個 customer）。 */
  customerId?: string | null;
  /**
   * 從網頁訂閱頁來的（issue #20）標記在回跳網址上：那條路的人可能還不是好友，
   * /billing/done 看到它才知道要引導加好友，而不是「回到聊天室」。
   */
  via?: "web";
}): Promise<string> {
  const price = priceMap()[input.plan];
  if (!price) throw new Error(`方案 ${input.plan} 沒有設定 Stripe price id`);

  const viaQuery = input.via ? `&via=${input.via}` : "";
  const form: Record<string, string> = {
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    success_url: `${baseUrl()}/billing/done?ok=1${viaQuery}`,
    cancel_url: `${baseUrl()}/billing/done?ok=0${viaQuery}`,
    client_reference_id: input.userId,
    // 權益認的是這個欄位——訂閱事件上讀得到它，才對得回 LINE 帳號
    "subscription_data[metadata][line_user_id]": input.userId,
    "metadata[line_user_id]": input.userId,
  };
  if (input.customerId) form.customer = input.customerId;

  const session = (await stripeFetch("/checkout/sessions", form)) as { url?: string };
  if (!session.url) throw new Error("Stripe 沒有回傳 checkout url");
  return session.url;
}

/** 訂閱管理頁（換檔、取消、換卡、看收據）。沒有 customer 就開不了。via 同 createCheckoutUrl。 */
export async function createPortalUrl(customerId: string, opts: { via?: "web" } = {}): Promise<string> {
  const session = (await stripeFetch("/billing_portal/sessions", {
    customer: customerId,
    return_url: `${baseUrl()}/billing/done?ok=1${opts.via ? `&via=${opts.via}` : ""}`,
  })) as { url?: string };
  if (!session.url) throw new Error("Stripe 沒有回傳 portal url");
  return session.url;
}
