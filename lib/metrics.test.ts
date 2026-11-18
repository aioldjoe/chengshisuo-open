import { describe, expect, it } from "vitest";

import { demoConversion, joinClicks, monthlyUsage, shareConversion, shareOpens, trialFunnel } from "./metrics";
import type { UsageEvent } from "./types";

const created = (userHash: string, at: string): UsageEvent => ({
  userHash,
  type: "meeting_created",
  subject: null,
  at,
});

const opened = (meetingId: string, at: string): UsageEvent => ({
  userHash: null,
  type: "share_opened",
  subject: meetingId,
  at,
});

describe("monthlyUsage", () => {
  it("沒事件就沒有月份", () => {
    expect(monthlyUsage([])).toEqual([]);
  });

  it("活躍用戶數是當月不重複的人", () => {
    const rows = monthlyUsage([
      created("a", "2026-08-01T00:00:00.000Z"),
      created("a", "2026-08-20T00:00:00.000Z"),
      created("b", "2026-08-31T23:59:59.000Z"),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].month).toBe("2026-08");
    expect(rows[0].activeUsers).toBe(2);
    expect(rows[0].meetings).toBe(3);
    expect(rows[0].meetingsPerUser).toBeCloseTo(1.5);
  });

  it("次月回訪率＝當月活躍者裡下個月還在的比例", () => {
    const rows = monthlyUsage([
      created("a", "2026-07-05T00:00:00.000Z"),
      created("b", "2026-07-06T00:00:00.000Z"),
      created("a", "2026-08-05T00:00:00.000Z"),
      created("c", "2026-08-06T00:00:00.000Z"), // 新來的，不影響七月分母
    ]);
    expect(rows.map((r) => r.month)).toEqual(["2026-07", "2026-08"]);
    expect(rows[0].retainedNextMonth).toBe(1);
    expect(rows[0].retentionRate).toBeCloseTo(0.5);
  });

  it("最後一個月還沒有下個月可看，回訪率是 null 不是 0", () => {
    const rows = monthlyUsage([created("a", "2026-08-05T00:00:00.000Z")]);
    expect(rows[0].retainedNextMonth).toBeNull();
    expect(rows[0].retentionRate).toBeNull();
  });

  it("跨年也算得出下個月", () => {
    const rows = monthlyUsage([
      created("a", "2026-12-31T00:00:00.000Z"),
      created("a", "2027-01-01T00:00:00.000Z"),
    ]);
    expect(rows.map((r) => r.month)).toEqual(["2026-12", "2027-01"]);
    expect(rows[0].retentionRate).toBe(1);
  });

  it("中間沒人的月份補零，回訪率算 0 不是跳過", () => {
    const rows = monthlyUsage([
      created("a", "2026-06-01T00:00:00.000Z"),
      created("a", "2026-08-01T00:00:00.000Z"),
    ]);
    expect(rows.map((r) => r.month)).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(rows[0].retentionRate).toBe(0);
    expect(rows[1].activeUsers).toBe(0);
    expect(rows[1].meetingsPerUser).toBe(0);
    expect(rows[1].retentionRate).toBeNull(); // 分母是 0，沒有比例可言
  });

  it("只算開會事件，別的事件型別不進留存分母", () => {
    const rows = monthlyUsage([
      created("a", "2026-08-01T00:00:00.000Z"),
      opened("m1", "2026-08-02T00:00:00.000Z"),
    ]);
    expect(rows[0].activeUsers).toBe(1);
    expect(rows[0].meetings).toBe(1);
  });
});

describe("shareOpens", () => {
  it("沒事件就是零", () => {
    expect(shareOpens([])).toEqual({ total: 0, byMeeting: [] });
  });

  it("總數與每場分開算，場次由多到少", () => {
    const r = shareOpens([
      opened("m1", "2026-08-01T00:00:00.000Z"),
      opened("m2", "2026-08-02T00:00:00.000Z"),
      opened("m1", "2026-08-03T00:00:00.000Z"),
      opened("m1", "2026-08-04T00:00:00.000Z"),
    ]);
    expect(r.total).toBe(4);
    expect(r.byMeeting).toEqual([
      { meetingId: "m1", opens: 3 },
      { meetingId: "m2", opens: 1 },
    ]);
  });

  it("本人開自己的記錄頁不算——只有 share_opened 進來", () => {
    const r = shareOpens([
      created("a", "2026-08-01T00:00:00.000Z"),
      { userHash: "a", type: "meeting_opened", subject: "m1", at: "2026-08-01T00:00:00.000Z" },
      opened("m1", "2026-08-02T00:00:00.000Z"),
    ]);
    expect(r.total).toBe(1);
    expect(r.byMeeting).toEqual([{ meetingId: "m1", opens: 1 }]);
  });

  it("沒有場次的分享事件仍進總數，只是無處可歸", () => {
    const r = shareOpens([{ userHash: null, type: "share_opened", subject: null, at: "2026-08-01T00:00:00.000Z" }]);
    expect(r.total).toBe(1);
    expect(r.byMeeting).toEqual([]);
  });
});

const joined = (ref: string | null, at: string): UsageEvent => ({
  userHash: null,
  type: "join_clicked",
  subject: ref,
  at,
});

describe("joinClicks", () => {
  it("沒點過就是 0", () => {
    expect(joinClicks([])).toEqual({ total: 0, byRef: [] });
  });

  it("依來源分組，多的排前面", () => {
    const stats = joinClicks([
      joined("share", "2026-08-01T00:00:00.000Z"),
      joined("share", "2026-08-02T00:00:00.000Z"),
      joined(null, "2026-08-03T00:00:00.000Z"),
      created("a", "2026-08-04T00:00:00.000Z"),
      opened("m1", "2026-08-05T00:00:00.000Z"),
    ]);
    expect(stats.total).toBe(3);
    expect(stats.byRef).toEqual([
      { ref: "share", clicks: 2 },
      { ref: null, clicks: 1 },
    ]);
  });
});

describe("shareConversion", () => {
  it("沒人開過分享頁 → 沒有比率可算（分母 0 不是 0%）", () => {
    expect(shareConversion([joined("share", "2026-08-01T00:00:00.000Z")])).toEqual({
      opens: 0,
      clicks: 1,
      rate: null,
    });
  });

  it("分子只算 ref=share 的點擊，分母是分享頁開啟數", () => {
    const stats = shareConversion([
      opened("m1", "2026-08-01T00:00:00.000Z"),
      opened("m1", "2026-08-02T00:00:00.000Z"),
      opened("m2", "2026-08-03T00:00:00.000Z"),
      opened("m2", "2026-08-04T00:00:00.000Z"),
      joined("share", "2026-08-05T00:00:00.000Z"),
      joined(null, "2026-08-06T00:00:00.000Z"),
    ]);
    expect(stats).toEqual({ opens: 4, clicks: 1, rate: 0.25 });
  });
});

const demoOpened = (at: string): UsageEvent => ({
  userHash: null,
  type: "demo_opened",
  subject: null,
  at,
});

describe("demoConversion", () => {
  it("沒人開過示範頁 → 沒有比率可算（分母 0 不是 0%）", () => {
    expect(demoConversion([joined("demo", "2026-08-01T00:00:00.000Z")])).toEqual({
      opens: 0,
      clicks: 1,
      rate: null,
    });
  });

  it("分母只算 demo_opened、分子只算 ref=demo——share 那條迴路的數字混不進來", () => {
    const stats = demoConversion([
      demoOpened("2026-08-01T00:00:00.000Z"),
      demoOpened("2026-08-02T00:00:00.000Z"),
      opened("m1", "2026-08-03T00:00:00.000Z"),
      joined("demo", "2026-08-04T00:00:00.000Z"),
      joined("share", "2026-08-05T00:00:00.000Z"),
    ]);
    expect(stats).toEqual({ opens: 2, clicks: 1, rate: 0.5 });
  });
});

const trialDone = (meetingId: string, at: string): UsageEvent => ({
  userHash: null,
  type: "trial_completed",
  subject: meetingId,
  at,
});

const trialClaimed = (userHash: string, meetingId: string, at: string): UsageEvent => ({
  userHash,
  type: "trial_claimed",
  subject: meetingId,
  at,
});

describe("trialFunnel", () => {
  it("沒人試用過 → 沒有比率可算（分母 0 不是 0%）", () => {
    expect(trialFunnel([])).toEqual({ completed: 0, claimed: 0, rate: null });
  });

  it("試用完成數與認領數分開算——這兩個點是 issue #19 有沒有用的唯一依據", () => {
    const stats = trialFunnel([
      trialDone("t1", "2026-08-01T00:00:00.000Z"),
      trialDone("t2", "2026-08-02T00:00:00.000Z"),
      trialClaimed("u1", "t1", "2026-08-02T01:00:00.000Z"),
      // 別的事件混不進來
      opened("m1", "2026-08-03T00:00:00.000Z"),
      joined("trial", "2026-08-03T01:00:00.000Z"),
    ]);
    expect(stats).toEqual({ completed: 2, claimed: 1, rate: 0.5 });
  });
});
