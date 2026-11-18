import { describe, expect, it } from "vitest";

import { parseCase } from "./stt-case";

const base = { scenario: "遠場：手機放桌角", audio: "~/rec/a.m4a" };

describe("parseCase", () => {
  it("人寫的是 mm:ss，算的是秒", () => {
    const c = parseCase("far-field", {
      ...base,
      anchors: [{ at: "03:12", text: "先講泵浦" }],
      silences: [{ from: "05:10", to: "05:40" }],
    });
    expect(c.spec.anchors).toEqual([{ at: 192, text: "先講泵浦" }]);
    expect(c.spec.silences).toEqual([{ from: 310, to: 340 }]);
  });

  it("超過一小時的錨點寫 h:mm:ss 也認得", () => {
    const c = parseCase("long", { ...base, anchors: [{ at: "1:02:03", text: "尾聲" }] });
    expect(c.spec.anchors?.[0].at).toBe(3723);
  });

  it("時間寫壞了要當場喊出來——不能安靜地算出一個錯的分數", () => {
    expect(() => parseCase("bad", { ...base, silences: [{ from: "五分十秒", to: "05:40" }] })).toThrow(
      /五分十秒/,
    );
  });

  it("沒有 audio 就不是一場 case", () => {
    expect(() => parseCase("bad", { scenario: "x" })).toThrow(/audio/);
  });
});
