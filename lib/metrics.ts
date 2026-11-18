import { DEMO_REF, SHARE_REF } from "./join";
import type { UsageEvent } from "./types";

/**
 * 從量測事件算出 VC 驗證鏈第一關的三個數字：每月活躍用戶、人均場次、次月回訪率。
 * 純函式（事件從哪來不管），資料來源見 lib/store/events.ts。
 */

export type MonthlyUsage = {
  /** YYYY-MM（UTC；用戶都在台灣，跨月邊界差 8 小時，對月粒度趨勢不影響）。 */
  month: string;
  /** 當月丟過錄音的不重複人數。 */
  activeUsers: number;
  meetings: number;
  /** 人均場次；當月沒人時為 0。 */
  meetingsPerUser: number;
  /** 當月活躍者裡下個月還活躍的人數；還沒有下個月的資料時 null。 */
  retainedNextMonth: number | null;
  /** retainedNextMonth / activeUsers；分母為 0 或沒有下個月時 null。 */
  retentionRate: number | null;
};

/** "2026-12" → "2027-01" */
function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function monthlyUsage(events: UsageEvent[]): MonthlyUsage[] {
  // 只有開會事件進留存分母——分享頁開啟之類的無主事件不代表「這個人還在用」
  const created = events.filter((e) => e.type === "meeting_created" && e.userHash);

  const byMonth = new Map<string, { users: Set<string>; meetings: number }>();
  for (const e of created) {
    const month = e.at.slice(0, 7);
    let bucket = byMonth.get(month);
    if (!bucket) byMonth.set(month, (bucket = { users: new Set(), meetings: 0 }));
    bucket.users.add(e.userHash as string);
    bucket.meetings++;
  }
  if (byMonth.size === 0) return [];

  // 中間空月要補出來——月份跳過去看起來像沒發生，補零才看得出斷層
  const sorted = [...byMonth.keys()].sort();
  const months: string[] = [];
  for (let m = sorted[0]; m <= sorted[sorted.length - 1]; m = nextMonth(m)) months.push(m);

  const last = months[months.length - 1];
  return months.map((month) => {
    const users = byMonth.get(month)?.users ?? new Set<string>();
    const meetings = byMonth.get(month)?.meetings ?? 0;
    const next = byMonth.get(nextMonth(month))?.users;

    // 最後一個月的下個月還沒到，0 會被誤讀成「全流失」
    const retained =
      month === last ? null : [...users].filter((u) => next?.has(u)).length;

    return {
      month,
      activeUsers: users.size,
      meetings,
      meetingsPerUser: users.size === 0 ? 0 : meetings / users.size,
      retainedNextMonth: retained,
      retentionRate: retained === null || users.size === 0 ? null : retained / users.size,
    };
  });
}

/** 分享頁被打開的次數：全站總數與每場一列。 */
export type ShareOpens = {
  total: number;
  /** 由多到少；同票數用 id 排序，讓輸出穩定。 */
  byMeeting: Array<{ meetingId: string; opens: number }>;
};

/**
 * 病毒迴路的分子。只認 share_opened——本人在 app/m/[id] 開自己的記錄頁
 * 走另一條路徑、不記事件，兩邊本來就不會混在一起（issue #7 的第 2 點）。
 */
export function shareOpens(events: UsageEvent[]): ShareOpens {
  const opens = events.filter((e) => e.type === "share_opened");
  const byMeeting = new Map<string, number>();
  for (const e of opens) {
    if (e.subject) byMeeting.set(e.subject, (byMeeting.get(e.subject) ?? 0) + 1);
  }
  return {
    total: opens.length,
    byMeeting: [...byMeeting]
      .map(([meetingId, count]) => ({ meetingId, opens: count }))
      .sort((a, b) => b.opens - a.opens || a.meetingId.localeCompare(b.meetingId)),
  };
}

/** 加好友 CTA 的點擊數：全站總數與每個來源一列。 */
export type JoinClicks = {
  total: number;
  /** ref 為 null＝沒帶來源；顯示成什麼字是印表端的事，這裡只給資料。由多到少，同票數用來源名排序。 */
  byRef: Array<{ ref: string | null; clicks: number }>;
};

/**
 * 病毒迴路的轉化口（issue #8）。分子是分享頁開啟數（shareOpens），
 * 這裡是從那些人裡走到加好友那一步的人——注意量到的是點擊不是實際加好友，
 * 實際加好友只有 LINE OA 後台的「加入好友管道」數得到（見 lib/join.ts）。
 */
export function joinClicks(events: UsageEvent[]): JoinClicks {
  const clicks = events.filter((e) => e.type === "join_clicked");
  const byRef = new Map<string | null, number>();
  for (const e of clicks) {
    // 沒帶 ref 的點擊也要留著——沒有來源不代表沒發生
    byRef.set(e.subject, (byRef.get(e.subject) ?? 0) + 1);
  }
  return {
    total: clicks.length,
    byRef: [...byRef]
      .map(([ref, count]) => ({ ref, clicks: count }))
      .sort((a, b) => b.clicks - a.clicks || (a.ref ?? "").localeCompare(b.ref ?? "")),
  };
}

/**
 * 迴路轉化：分享頁被打開幾次，其中幾次走到加好友那一步。
 * 這是 issue #8 要的那個數字（「新用戶幾成來自轉傳」的上游），
 * 所以它是有測的純函式，不是印表時順手除一除。
 */
export type ShareConversion = {
  opens: number;
  clicks: number;
  /** clicks / opens；還沒有人開過分享頁時 null（分母 0 不是 0%）。 */
  rate: number | null;
};

export function shareConversion(events: UsageEvent[]): ShareConversion {
  const opens = shareOpens(events).total;
  const clicks = joinClicks(events).byRef.find((r) => r.ref === SHARE_REF)?.clicks ?? 0;
  return { opens, clicks, rate: opens === 0 ? null : clicks / opens };
}

/**
 * 示範記錄頁的迴路（issue #14）：首頁「看一份真的記錄頁」被打開幾次，
 * 其中幾次走到加好友那一步。跟 shareConversion 同形狀但兩邊互不相通——
 * 示範頁量的是首頁的說服力，分享頁量的是轉傳，混在一起兩個都讀不準。
 */
export function demoConversion(events: UsageEvent[]): ShareConversion {
  const opens = events.filter((e) => e.type === "demo_opened").length;
  const clicks = joinClicks(events).byRef.find((r) => r.ref === DEMO_REF)?.clicks ?? 0;
  return { opens, clicks, rate: opens === 0 ? null : clicks / opens };
}

/**
 * 首頁試用的漏斗（issue #19）：試用完成幾場、其中幾場被認領進 LINE 身分。
 * 這張票的驗收就這兩個數字——rate 低代表試用頁的 CTA 沒把人留下來，
 * rate 高但 completed 少代表上傳區沒人用，兩種病要分得開。
 */
export type TrialFunnel = {
  completed: number;
  claimed: number;
  /** claimed / completed；還沒有人試用完成時 null（分母 0 不是 0%）。 */
  rate: number | null;
};

export function trialFunnel(events: UsageEvent[]): TrialFunnel {
  const completed = events.filter((e) => e.type === "trial_completed").length;
  const claimed = events.filter((e) => e.type === "trial_claimed").length;
  return { completed, claimed, rate: completed === 0 ? null : claimed / completed };
}
