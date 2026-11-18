import { describe, expect, it } from "vitest";

import {
  TRIAL_MAX_BYTES,
  TRIAL_MAX_SECONDS,
  TRIAL_PAGE_TTL_MS,
  isTrialMeeting,
  transcribedTooLong,
  trialRejectionText,
  trialUserId,
  trialVerdict,
} from "./trial";

const OK = { bytes: 3 * 1024 * 1024, durationSeconds: 180, usedToday: false };

describe("trialVerdict", () => {
  it("5 分鐘內、沒超量、今天沒用過 → 放行", () => {
    expect(trialVerdict(OK)).toEqual({ ok: true });
    expect(trialVerdict({ ...OK, durationSeconds: TRIAL_MAX_SECONDS })).toEqual({ ok: true });
  });

  it("同 IP 今天用過就擋——這是試用唯一的底線（issue #19：月額度在這裡不是底）", () => {
    expect(trialVerdict({ ...OK, usedToday: true })).toEqual({ ok: false, reason: "ip-limit" });
  });

  it("檔案超過上限就擋，連時長都不用看", () => {
    expect(trialVerdict({ ...OK, bytes: TRIAL_MAX_BYTES + 1, durationSeconds: null })).toEqual({
      ok: false,
      reason: "too-large",
    });
    expect(trialVerdict({ ...OK, bytes: TRIAL_MAX_BYTES })).toEqual({ ok: true });
  });

  it("讀不出時長一律拒收——正式管線放行靠月額度兜底，試用沒有那道底", () => {
    expect(trialVerdict({ ...OK, durationSeconds: null })).toEqual({
      ok: false,
      reason: "unknown-duration",
    });
  });

  it("超過 5 分鐘就擋", () => {
    expect(trialVerdict({ ...OK, durationSeconds: TRIAL_MAX_SECONDS + 1 })).toEqual({
      ok: false,
      reason: "too-long",
    });
  });

  it("IP 限制優先於檔案問題——今天沒名額的話，講檔案哪裡不對只是噪音", () => {
    expect(
      trialVerdict({ bytes: TRIAL_MAX_BYTES + 1, durationSeconds: null, usedToday: true }),
    ).toEqual({ ok: false, reason: "ip-limit" });
  });
});

describe("trialRejectionText", () => {
  it("每一種拒收都給出路（加好友）——不做靜默拒收是全站的規矩", () => {
    for (const reason of ["ip-limit", "too-large", "unknown-duration", "too-long"] as const) {
      expect(trialRejectionText(reason)).toContain("加");
      expect(trialRejectionText(reason)).toContain("好友");
    }
  });

  it("ip-limit 要講清楚是一天一場，不是壞掉", () => {
    expect(trialRejectionText("ip-limit")).toContain("一天一場");
  });
});

describe("transcribedTooLong", () => {
  it("轉寫回來的真時長超過寬限就算超長——檔頭可偽造，5 分鐘上限不能只驗檔頭", () => {
    expect(transcribedTooLong(TRIAL_MAX_SECONDS * 1.25 + 1)).toBe(true);
    expect(transcribedTooLong(1800)).toBe(true);
  });

  it("寬限內不冤枉真人——CBR 估法本來就會失真", () => {
    expect(transcribedTooLong(TRIAL_MAX_SECONDS)).toBe(false);
    expect(transcribedTooLong(TRIAL_MAX_SECONDS * 1.25)).toBe(false);
  });

  it("量不到就放行——進得了這關代表檔頭那關已經量到過一次", () => {
    expect(transcribedTooLong(null)).toBe(false);
  });
});

describe("trialUserId / isTrialMeeting", () => {
  it("試用場次的 userId 帶 trial: 前綴——跟 LINE userId（U 開頭）永不相撞", () => {
    const id = trialUserId("abc123");
    expect(id).toBe("trial:abc123");
    expect(isTrialMeeting(id)).toBe(true);
  });

  it("真人的 userId 不是試用", () => {
    expect(isTrialMeeting("U1234567890abcdef")).toBe(false);
  });
});

describe("常數", () => {
  it("試用頁 24 小時；上限 5 分鐘（issue #19 的數字，改了要連文案一起改）", () => {
    expect(TRIAL_PAGE_TTL_MS).toBe(24 * 3600_000);
    expect(TRIAL_MAX_SECONDS).toBe(300);
  });
});
