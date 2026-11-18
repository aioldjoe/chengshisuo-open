import { parseClock } from "./format";
import type { Meeting } from "./types";

/**
 * 方案表與額度判定（GLOSSARY.md 的方案與價格，2026-08-27 定案）。
 * client / server 共用，勿放 server-only import。
 *
 * 兩種計量單位刻意並存：免費檔按「場」、付費檔按「小時」。
 * 變動成本按時長線性走（Scribe 約 NT$8/hr），所以收錢那端一定得按小時，
 * 否則長會議會把單價吃掉；但免費檔是獲客成本，用場次計——習慣靠次數養、
 * 對新用戶好懂，而單場 1 小時的上限已經把最壞成本鎖死（NT$24/人/月）。
 */

export type PlanId = "free" | "lite" | "standard";

/** 付費檔。指名升級（定價卡按鈕、分流的 want）只會指到這兩檔。 */
export type PaidPlanId = Exclude<PlanId, "free">;

export type Plan = {
  id: PlanId;
  name: string;
  priceTwd: number;
  /** 每月場次上限；null＝不以場次計量。 */
  monthlyMeetings: number | null;
  /** 每月時數上限；null＝不以時數計量。 */
  monthlyHours: number | null;
  /** 單場時長上限（秒）；null＝不設上限。 */
  maxMeetingSeconds: number | null;
  /** 記錄頁保留天數；null＝永久。 */
  pageDays: number | null;
  /** PDF 匯出與分享連結（Word 匯出所有人都有）。 */
  paidPerks: boolean;
};

/** 記錄頁免費保留天數（GLOSSARY.md「記錄頁保留」）。 */
const FREE_PAGE_DAYS = 30;

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "免費",
    priceTwd: 0,
    monthlyMeetings: 3,
    monthlyHours: null,
    // 1 小時斷點同時是升級扳機——開長會的人正是最付得起的人
    maxMeetingSeconds: 3600,
    pageDays: FREE_PAGE_DAYS,
    paidPerks: false,
  },
  lite: {
    id: "lite",
    name: "輕量",
    priceTwd: 99,
    monthlyMeetings: null,
    monthlyHours: 10,
    maxMeetingSeconds: null,
    pageDays: null,
    paidPerks: true,
  },
  standard: {
    id: "standard",
    name: "標準",
    priceTwd: 399,
    monthlyMeetings: null,
    monthlyHours: 40,
    maxMeetingSeconds: null,
    pageDays: null,
    paidPerks: true,
  },
};

/** 給人看的方案名，帶價格。免費檔沒有價格可講。 */
export function planLabel(id: PlanId): string {
  const p = PLANS[id];
  return p.priceTwd === 0 ? p.name : `${p.name} NT$${p.priceTwd}/月`;
}

/** 一場會議實際計量的秒數。落庫的 durationSeconds 優先；付費牆之前的舊資料只有顯示字串。 */
export function meetingSeconds(m: Meeting): number {
  return m.durationSeconds ?? parseClock(m.durationLabel) ?? 0;
}

export type QuotaUsage = { meetings: number; seconds: number };

/** 某人當月已用掉的量。兩個單位一起算，換檔時不必重算。 */
export function usageOf(meetings: Meeting[]): QuotaUsage {
  return {
    meetings: meetings.length,
    seconds: meetings.reduce((sum, m) => sum + meetingSeconds(m), 0),
  };
}

export type QuotaReason = "monthly-meetings" | "monthly-hours" | "too-long";
export type QuotaVerdict = { ok: true } | { ok: false; reason: QuotaReason };

/**
 * 這場能不能收。
 *
 * `incomingSeconds` 為 null＝時長還不知道（分享進來的檔案得先下載才量得到），
 * 這時只驗得了累計量；真正的單場檢查在 pipeline 拿到音檔後補跑一次。
 *
 * 付費檔刻意只看「已經用掉多少」，不看這場會不會超出剩餘額度（2026-08-27 決定）：
 * 有剩就整場收下、扣到見底，下一場才擋。最壞情況是月底那場長會多花幾十塊，
 * 換掉的是「付了錢卻傳不了 3 小時的會議」——那會讓付費本身失去意義。
 */
export function checkQuota(
  plan: Plan,
  usage: QuotaUsage,
  incomingSeconds: number | null,
): QuotaVerdict {
  // 單場上限先判：兩道牆同時撞到時，「這場太長」比「這個月用完了」更貼近使用者剛做的事，
  // 而且它帶的升級點更硬（升級後單場不限長）——那是票上指名的扳機，不能被場次訊息蓋掉。
  if (
    plan.maxMeetingSeconds !== null &&
    incomingSeconds !== null &&
    incomingSeconds > plan.maxMeetingSeconds
  ) {
    return { ok: false, reason: "too-long" };
  }
  if (plan.monthlyMeetings !== null && usage.meetings >= plan.monthlyMeetings) {
    return { ok: false, reason: "monthly-meetings" };
  }
  if (plan.monthlyHours !== null && usage.seconds >= plan.monthlyHours * 3600) {
    return { ok: false, reason: "monthly-hours" };
  }
  return { ok: true };
}

/** 帳單週期漏更新時，額度窗口最多往回看這麼久（見 quotaWindowStart）。 */
const MAX_WINDOW_MS = 31 * 86400_000;

/**
 * 額度從哪一刻起算。
 *
 * 免費檔用日曆月（每月 1 號重置）——沒有帳單日可依，而且「下個月 1 號」最好懂。
 * 付費檔跟著 **Stripe 的帳單週期**走：20 號刷卡就 20 號重置。
 * 曾經用日曆月，但那樣兩個週期會錯開——8/31 訂閱的人 8/31 拿一份、9/1 又拿一份，
 * 一次付款拿到兩倍額度，成本直接吃掉整筆收入（2026-08-27 決定改）。
 *
 * 窗口再長也不超過 31 天：webhook 漏一次的話 currentPeriodStart 會停在上一期，
 * 那時候「照實算」等於免費送一個月，寧可少算也不要靜默漏收。
 */
export function quotaWindowStart(
  plan: PlanId,
  currentPeriodStart: string | null,
  when: Date,
): Date {
  const monthStart = new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), 1));
  if (plan === "free" || !currentPeriodStart) return monthStart;
  const start = Date.parse(currentPeriodStart);
  if (!Number.isFinite(start)) return monthStart;
  return new Date(Math.max(start, when.getTime() - MAX_WINDOW_MS));
}

/**
 * 解鎖碼比照哪一檔的權益。lite 與 standard 的權益完全一樣（差別只在時數，
 * 而解鎖碼本來就不看額度），取最高檔是為了將來加檔時不必回頭改這裡。
 */
const UNLOCK_PLAN: PlanId = "standard";

/**
 * 訂閱 × 解鎖碼 → 現在該給哪一檔的權益。
 *
 * 解鎖碼是 ops 後門不是方案：它不出現在定價頁、不進 Stripe、也不會讓人被當成付費客。
 * 但權益比照付費檔——只免額度的話，被開通的人記錄頁照樣 30 天被 cron 真刪、
 * PDF 照樣按不動，那不叫「開給你用」（2026-08-27 決定）。
 *
 * 只會往上不會往下：已經付錢的人解了鎖也不該掉檔。
 */
export function entitledPlan(plan: PlanId, unlimited: boolean): PlanId {
  return unlimited ? UNLOCK_PLAN : plan;
}

/**
 * 訂閱狀態 → 現在該給哪一檔的權益。
 * 已取消／扣款失敗仍留到本期結束——錢已經付到那一天，當場斷水斷電只會換來客訴；
 * 催款是 Stripe 的事。反過來，還沒付款成功的（incomplete）一毛權益都不給。
 */
export function planFromSubscription(
  sub: { plan: PlanId; status: string; currentPeriodEnd: string | null } | null,
  now: number,
): PlanId {
  if (!sub) return "free";
  if (sub.status === "active" || sub.status === "trialing") return sub.plan;
  if (sub.status === "past_due" || sub.status === "canceled") {
    const end = sub.currentPeriodEnd ? Date.parse(sub.currentPeriodEnd) : NaN;
    return Number.isFinite(end) && end > now ? sub.plan : "free";
  }
  return "free";
}
