import { describe, expect, it } from "vitest";

import {
  PLANS,
  checkQuota,
  entitledPlan,
  planFromSubscription,
  quotaWindowStart,
  usageOf,
} from "./plans";
import type { Meeting } from "./types";

const meeting = (over: Partial<Meeting>): Meeting =>
  ({
    id: "m",
    userId: "U1",
    createdAt: "2026-08-01T00:00:00.000Z",
    filename: "a.m4a",
    language: "zho",
    durationLabel: null,
    turns: [],
    summary: {
      title: "t",
      highlights: [],
      decisions: [],
      todos: [],
      commitments: [],
      sections: [],
    },
    speakerNames: {},
    audioKey: null,
    expiresAt: null,
    shareToken: null,
    ...over,
  }) as Meeting;

describe("usageOf", () => {
  it("場數＋秒數一起算，秒數優先讀 durationSeconds", () => {
    expect(
      usageOf([meeting({ durationSeconds: 1800 }), meeting({ durationSeconds: 600 })]),
    ).toEqual({ meetings: 2, seconds: 2400 });
  });

  it("舊資料沒有 durationSeconds，退回讀 durationLabel", () => {
    // 付費牆之前落庫的場次只有顯示用的時長字串——不能因此當成 0 小時
    expect(usageOf([meeting({ durationLabel: "1:05:00" })])).toEqual({
      meetings: 1,
      seconds: 3900,
    });
  });

  it("兩者都沒有就當 0 秒，但場數照算", () => {
    expect(usageOf([meeting({})])).toEqual({ meetings: 1, seconds: 0 });
  });
});

describe("checkQuota - 免費檔", () => {
  const free = PLANS.free;

  it("月內未滿 3 場、單場 1 小時內 → 放行", () => {
    expect(checkQuota(free, { meetings: 2, seconds: 7200 }, 3600)).toEqual({ ok: true });
  });

  it("滿 3 場 → 擋在月額度", () => {
    expect(checkQuota(free, { meetings: 3, seconds: 0 }, 60)).toEqual({
      ok: false,
      reason: "monthly-meetings",
    });
  });

  it("免費檔不看累計小時——場數才是它的計量單位", () => {
    expect(checkQuota(free, { meetings: 1, seconds: 99 * 3600 }, 60)).toEqual({ ok: true });
  });

  it("單場超過 1 小時 → 擋在單場上限（升級扳機）", () => {
    expect(checkQuota(free, { meetings: 0, seconds: 0 }, 3601)).toEqual({
      ok: false,
      reason: "too-long",
    });
  });

  it("剛好 1 小時照收", () => {
    expect(checkQuota(free, { meetings: 0, seconds: 0 }, 3600)).toEqual({ ok: true });
  });

  it("時長未知（分享進來的檔案還沒下載）→ 只驗得了場數", () => {
    expect(checkQuota(free, { meetings: 0, seconds: 0 }, null)).toEqual({ ok: true });
  });

  it("場數與時長同時超標時先報時長——那句話帶的升級點更硬（升級後單場不限長）", () => {
    expect(checkQuota(free, { meetings: 5, seconds: 0 }, 7200)).toEqual({
      ok: false,
      reason: "too-long",
    });
  });
});

describe("checkQuota - 付費檔", () => {
  it("累計未滿額度 → 放行，且不看單場長度（付費檔無單場上限）", () => {
    expect(checkQuota(PLANS.lite, { meetings: 99, seconds: 9 * 3600 }, 5 * 3600)).toEqual({
      ok: true,
    });
  });

  it("剩一秒也放行，扣到見底——付了錢卻傳不了長會議，付費就失去意義", () => {
    expect(checkQuota(PLANS.lite, { meetings: 1, seconds: 10 * 3600 - 1 }, 3 * 3600)).toEqual({
      ok: true,
    });
  });

  it("額度見底（含超收出去的部分）→ 下一場才擋", () => {
    expect(checkQuota(PLANS.lite, { meetings: 1, seconds: 10 * 3600 }, 60)).toEqual({
      ok: false,
      reason: "monthly-hours",
    });
    expect(checkQuota(PLANS.standard, { meetings: 1, seconds: 41 * 3600 }, 60)).toEqual({
      ok: false,
      reason: "monthly-hours",
    });
  });

  it("標準檔的額度是 40 小時，輕量檔是 10", () => {
    expect(checkQuota(PLANS.standard, { meetings: 1, seconds: 39 * 3600 }, 60)).toEqual({
      ok: true,
    });
    expect(checkQuota(PLANS.lite, { meetings: 1, seconds: 39 * 3600 }, 60)).toEqual({
      ok: false,
      reason: "monthly-hours",
    });
  });
});

describe("planFromSubscription", () => {
  const now = Date.parse("2026-08-27T00:00:00.000Z");

  it("沒有訂閱 → 免費", () => {
    expect(planFromSubscription(null, now)).toBe("free");
  });

  it("active → 該檔", () => {
    expect(
      planFromSubscription(
        { plan: "standard", status: "active", currentPeriodEnd: null } as never,
        now,
      ),
    ).toBe("standard");
  });

  it("已取消但本期還沒結束 → 權益留到期末（錢已經付到那天）", () => {
    expect(
      planFromSubscription(
        {
          plan: "lite",
          status: "canceled",
          currentPeriodEnd: "2026-09-10T00:00:00.000Z",
        } as never,
        now,
      ),
    ).toBe("lite");
  });

  it("已取消且過了期末 → 回免費", () => {
    expect(
      planFromSubscription(
        {
          plan: "lite",
          status: "canceled",
          currentPeriodEnd: "2026-08-10T00:00:00.000Z",
        } as never,
        now,
      ),
    ).toBe("free");
  });

  it("扣款失敗（past_due）本期內仍有權益——催款是 Stripe 的事，不是當場斷水斷電", () => {
    expect(
      planFromSubscription(
        {
          plan: "lite",
          status: "past_due",
          currentPeriodEnd: "2026-09-10T00:00:00.000Z",
        } as never,
        now,
      ),
    ).toBe("lite");
  });

  it("未付款的新訂閱（incomplete）不給權益", () => {
    expect(
      planFromSubscription(
        { plan: "standard", status: "incomplete", currentPeriodEnd: null } as never,
        now,
      ),
    ).toBe("free");
  });
});

describe("方案表", () => {
  it("免費才有記錄頁到期日，付費永久保留", () => {
    expect(PLANS.free.pageDays).toBe(30);
    expect(PLANS.lite.pageDays).toBeNull();
    expect(PLANS.standard.pageDays).toBeNull();
  });

  it("PDF 匯出與分享是付費加值，Word 匯出所有人都有", () => {
    expect(PLANS.free.paidPerks).toBe(false);
    expect(PLANS.lite.paidPerks).toBe(true);
    expect(PLANS.standard.paidPerks).toBe(true);
  });
});

describe("quotaWindowStart", () => {
  const when = new Date("2026-09-21T12:00:00.000Z");

  it("免費檔一律從月初起算（沒有帳單日可依，而且「下個月 1 號」最好懂）", () => {
    expect(quotaWindowStart("free", null, when).toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(quotaWindowStart("free", "2026-09-20T00:00:00.000Z", when).toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
  });

  it("付費檔跟著扣款日走：9/20 開始的帳期就從 9/20 起算", () => {
    expect(quotaWindowStart("lite", "2026-09-20T03:00:00.000Z", when).toISOString()).toBe(
      "2026-09-20T03:00:00.000Z",
    );
  });

  it("跨月的帳期不會被月初截斷——8/20 到 9/20 是同一期", () => {
    // 9/2 來看時，帳期起點還在 8/20，額度就該從 8/20 起算（不是 9/1 重發一份）
    expect(
      quotaWindowStart("lite", "2026-08-20T00:00:00.000Z", new Date("2026-09-02T00:00:00.000Z"))
        .toISOString(),
    ).toBe("2026-08-20T00:00:00.000Z");
  });

  it("月底訂閱不再拿到兩份額度（舊的日曆月演算法會在隔天重置）", () => {
    const start = "2026-08-31T12:00:00.000Z";
    const next = quotaWindowStart("lite", start, new Date("2026-09-01T00:30:00.000Z"));
    expect(next.toISOString()).toBe(start);
  });

  it("帳期起點過舊（webhook 漏收）→ 最多往回看 31 天，不靜默漏收", () => {
    const stale = "2026-01-01T00:00:00.000Z";
    const got = quotaWindowStart("lite", stale, when);
    expect(got.getTime()).toBe(when.getTime() - 31 * 86400_000);
  });

  it("沒有帳期起點（舊資料）或格式壞掉 → 退回月初", () => {
    expect(quotaWindowStart("lite", null, when).toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(quotaWindowStart("lite", "不是時間", when).toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
  });
});

describe("entitledPlan（解鎖碼的權益）", () => {
  it("解鎖碼＝比照付費檔：PDF／分享打得開、記錄頁不到期", () => {
    const p = PLANS[entitledPlan("free", true)];
    expect(p.paidPerks).toBe(true);
    expect(p.pageDays).toBeNull();
  });

  it("沒解鎖就是他原本的檔——後門不會反過來變成人人有獎", () => {
    expect(entitledPlan("free", false)).toBe("free");
    expect(entitledPlan("lite", false)).toBe("lite");
  });

  it("已經付錢的人解了鎖也不降級（權益只會往上，不會被後門蓋掉）", () => {
    const p = PLANS[entitledPlan("standard", true)];
    expect(p.paidPerks).toBe(true);
    expect(p.pageDays).toBeNull();
  });
});
