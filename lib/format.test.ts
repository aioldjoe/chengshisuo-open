import { describe, expect, it } from "vitest";

import { fmtDurationZh, fmtTime, parseClock } from "./format";

describe("fmtTime", () => {
  it("mm:ss 與 h:mm:ss", () => {
    expect(fmtTime(452)).toBe("07:32");
    expect(fmtTime(3725)).toBe("1:02:05");
  });
});

describe("fmtDurationZh", () => {
  it("mm:ss 讀成中文時長，去前導零", () => {
    expect(fmtDurationZh("07:32")).toBe("7 分 32 秒");
  });
  it("h:mm:ss 帶小時", () => {
    expect(fmtDurationZh("1:02:05")).toBe("1 小時 2 分 5 秒");
  });
  it("不足一分只剩秒", () => {
    expect(fmtDurationZh("00:45")).toBe("45 秒");
  });
  it("整分不寫 0 秒", () => {
    expect(fmtDurationZh("12:00")).toBe("12 分");
  });
  it("看不懂的字串原樣回傳", () => {
    expect(fmtDurationZh("n/a")).toBe("n/a");
    expect(fmtDurationZh(null)).toBeNull();
  });
});

describe("parseClock", () => {
  it("讀回秒數——fmtTime 的反向", () => {
    expect(parseClock("07:32")).toBe(452);
    expect(parseClock("1:02:05")).toBe(3725);
    expect(parseClock("00:00")).toBe(0);
  });
  it("看不懂就回 null，不猜", () => {
    expect(parseClock("n/a")).toBeNull();
    expect(parseClock("")).toBeNull();
    expect(parseClock("12")).toBeNull();
    expect(parseClock(null)).toBeNull();
  });
});
