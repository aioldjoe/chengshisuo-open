import { describe, expect, it } from "vitest";

import {
  activeTurnIndex,
  isSelectingText,
  nextRate,
  parseRate,
  progressPercent,
  rateLabel,
  skipTarget,
} from "./player";

describe("activeTurnIndex", () => {
  const starts = [0, 12, 30, 30.5, 90];

  it("落在哪一段就回哪一段", () => {
    expect(activeTurnIndex(starts, 0)).toBe(0);
    expect(activeTurnIndex(starts, 11.9)).toBe(0);
    expect(activeTurnIndex(starts, 12)).toBe(1);
    expect(activeTurnIndex(starts, 29.999)).toBe(1);
    expect(activeTurnIndex(starts, 60)).toBe(3);
  });

  it("同一秒有兩段時取後面那段——播到 30.5 就該亮 30.5 那句", () => {
    expect(activeTurnIndex(starts, 30.4)).toBe(2);
    expect(activeTurnIndex(starts, 30.5)).toBe(3);
  });

  it("播完最後一段之後仍停在最後一段", () => {
    expect(activeTurnIndex(starts, 99999)).toBe(4);
  });

  it("第一段還沒開始、或根本沒有逐字稿：沒有人亮", () => {
    expect(activeTurnIndex([5, 10], 0)).toBe(-1);
    expect(activeTurnIndex([], 3)).toBe(-1);
  });
});

describe("progressPercent", () => {
  it("填色百分比", () => {
    expect(progressPercent(0, 100)).toBe(0);
    expect(progressPercent(25, 100)).toBe(25);
    expect(progressPercent(100, 100)).toBe(100);
  });

  it("超出範圍夾回 0–100", () => {
    expect(progressPercent(150, 100)).toBe(100);
    expect(progressPercent(-3, 100)).toBe(0);
  });

  it("時長還沒讀到（m4a 常見）回 0，條不亂跳", () => {
    expect(progressPercent(10, 0)).toBe(0);
    expect(progressPercent(10, Number.NaN)).toBe(0);
    expect(progressPercent(10, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("isSelectingText", () => {
  const sel = (text: string, isCollapsed = false) => ({
    isCollapsed,
    toString: () => text,
  });

  it("使用者正在複製逐字稿：整列點擊要放行給選字，不跳播", () => {
    expect(isSelectingText(sel("那我們就先這樣"))).toBe(true);
  });

  it("單純點一下（游標塌成一點）＝要跳播", () => {
    expect(isSelectingText(sel("", true))).toBe(false);
  });

  it("沒有 Selection API 或拿不到就當作沒選字——寧可播，不要整列變啞的", () => {
    expect(isSelectingText(null)).toBe(false);
  });

  it("選到的只是空白／換行（點擊跨到段落邊界時瀏覽器會這樣回報）：仍算沒選字", () => {
    expect(isSelectingText(sel(" \n "))).toBe(false);
  });
});

describe("skipTarget", () => {
  it("往前往後各跳 10 秒", () => {
    expect(skipTarget(30, 10, 100)).toBe(40);
    expect(skipTarget(30, -10, 100)).toBe(20);
  });

  it("開頭往回跳停在 0，不是負秒", () => {
    expect(skipTarget(4, -10, 100)).toBe(0);
    expect(skipTarget(0, -10, 100)).toBe(0);
  });

  it("結尾往前跳停在結尾", () => {
    expect(skipTarget(95, 10, 100)).toBe(100);
  });

  it("時長還沒讀到就不夾上界——夾了會變成跳回開頭", () => {
    expect(skipTarget(30, 10, 0)).toBe(40);
    expect(skipTarget(30, 10, Number.NaN)).toBe(40);
    expect(skipTarget(30, 10, Number.POSITIVE_INFINITY)).toBe(40);
  });
});

describe("nextRate", () => {
  it("點一下換下一段，2× 之後繞回 1×", () => {
    expect(nextRate(1)).toBe(1.5);
    expect(nextRate(1.5)).toBe(2);
    expect(nextRate(2)).toBe(1);
  });

  it("不在清單上的值回 1×（存壞了、或舊版留下的）", () => {
    expect(nextRate(1.25)).toBe(1);
    expect(nextRate(Number.NaN)).toBe(1);
  });
});

describe("parseRate", () => {
  it("讀得回存進去的速度", () => {
    expect(parseRate("1.5")).toBe(1.5);
    expect(parseRate("2")).toBe(2);
  });

  it("沒存過、亂寫、超出範圍都回 1×", () => {
    expect(parseRate(null)).toBe(1);
    expect(parseRate("")).toBe(1);
    expect(parseRate("很快")).toBe(1);
    expect(parseRate("16")).toBe(1);
  });
});

describe("rateLabel", () => {
  it("固定一位小數，鈕的寬度才不會抖", () => {
    expect(rateLabel(1)).toBe("1.0×");
    expect(rateLabel(1.5)).toBe("1.5×");
    expect(rateLabel(2)).toBe("2.0×");
  });
});
