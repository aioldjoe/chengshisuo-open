import { describe, expect, it } from "vitest";

import {
  applyCorrections,
  countHits,
  display,
  displayTurns,
  setSpeakerName,
  speakerLabels,
} from "./transcript";
import type { Meeting, TranscriptTurn } from "./types";

const turns: TranscriptTurn[] = [
  { speaker: "講者 A", start: 0, text: "先把愛克賽表拉出來" },
  { speaker: "講者 A", start: 6, text: "愛克賽那欄對齊，愛克賽再存一次" },
  { speaker: "講者 B", start: 12, text: "好，我回去弄" },
];

const m = (over: Partial<Meeting> = {}): Pick<
  Meeting,
  "turns" | "corrections" | "speakerFixes" | "speakerNames"
> => ({
  turns,
  corrections: [],
  speakerFixes: {},
  speakerNames: {},
  ...over,
});

describe("applyCorrections", () => {
  it("精確字串、全篇替換", () => {
    expect(applyCorrections("愛克賽裡的愛克賽", [{ from: "愛克賽", to: "Excel" }])).toBe(
      "Excel裡的Excel",
    );
  });

  it("依序套用，後一條吃得到前一條的結果", () => {
    expect(
      applyCorrections("愛克賽", [
        { from: "愛克賽", to: "excel" },
        { from: "excel", to: "Excel" },
      ]),
    ).toBe("Excel");
  });

  it("不做 regex、不做大小寫模糊", () => {
    expect(applyCorrections("a.c abc", [{ from: "a.c", to: "X" }])).toBe("X abc");
    expect(applyCorrections("EXCEL", [{ from: "excel", to: "Excel" }])).toBe("EXCEL");
  });

  it("from 空字串直接跳過——不然 split('') 會把每個字都切開", () => {
    expect(applyCorrections("原文", [{ from: "", to: "X" }])).toBe("原文");
  });

  it("沒有規則（含舊資料沒有這欄）原文照回", () => {
    expect(applyCorrections("原文", [])).toBe("原文");
    expect(applyCorrections("原文", undefined)).toBe("原文");
  });
});

describe("countHits", () => {
  it("數全篇命中次數，同一段裡的多次也算", () => {
    expect(countHits(turns, "愛克賽")).toBe(3);
    expect(countHits(turns, "沒出現過")).toBe(0);
    expect(countHits(turns, "")).toBe(0);
  });
});

describe("displayTurns", () => {
  it("套錯詞替換，但不動原 turns", () => {
    const source = m({ corrections: [{ from: "愛克賽", to: "Excel" }] });
    const out = displayTurns(source);
    expect(out.map((t) => t.text)).toEqual([
      "先把Excel表拉出來",
      "Excel那欄對齊，Excel再存一次",
      "好，我回去弄",
    ]);
    expect(source.turns).toEqual(turns); // 原文逐字節不變
  });

  it("套說話人修正：只換那一段的指派，文字與時間不動", () => {
    const out = displayTurns(m({ speakerFixes: { "1": "講者 B" } }));
    expect(out.map((t) => t.speaker)).toEqual(["講者 A", "講者 B", "講者 B"]);
    expect(out[1].text).toBe(turns[1].text);
    expect(out[1].start).toBe(turns[1].start);
  });

  it("範圍外的 index 當沒這回事（資料舊了、turns 對不上時不炸）", () => {
    const out = displayTurns(m({ speakerFixes: { "9": "講者 B", "-1": "講者 B" } }));
    expect(out.map((t) => t.speaker)).toEqual(["講者 A", "講者 A", "講者 B"]);
  });

  it("舊資料沒有 corrections／speakerFixes 兩欄也照跑", () => {
    const out = displayTurns({ turns, speakerNames: {} } as Pick<
      Meeting,
      "turns" | "corrections" | "speakerFixes" | "speakerNames"
    >);
    expect(out).toEqual(turns);
  });
});

describe("display / speakerLabels", () => {
  it("命名過用真名，沒命名就用原標籤", () => {
    expect(display({ speakerNames: { "講者 A": "王協理" } }, "講者 A")).toBe("王協理");
    expect(display({ speakerNames: {} }, "講者 A")).toBe("講者 A");
    expect(display({ speakerNames: {} }, null)).toBe("發言");
  });

  it("講者清單＝逐字稿裡出現的＋命名過的，排序後去重", () => {
    expect(speakerLabels(m({ speakerNames: { "講者 C": "小林" } }))).toEqual([
      "講者 A",
      "講者 B",
      "講者 C",
    ]);
  });
});

describe("setSpeakerName", () => {
  it("命名：寫進去，不動原物件", () => {
    const names = {};
    expect(setSpeakerName(names, "講者 A", "王協理")).toEqual({ "講者 A": "王協理" });
    expect(names).toEqual({});
  });

  it("改名：只換那一位，其他人不動", () => {
    expect(setSpeakerName({ "講者 A": "王協理", "講者 B": "小林" }, "講者 A", "王經理")).toEqual({
      "講者 A": "王經理",
      "講者 B": "小林",
    });
  });

  it("清空＝取消命名，鍵要真的刪掉（留空字串的話 display() 會回一片空白）", () => {
    const out = setSpeakerName({ "講者 A": "王協理" }, "講者 A", "");
    expect(out).toEqual({});
    expect(display({ speakerNames: out }, "講者 A")).toBe("講者 A");
  });

  it("只有空白也算清空", () => {
    expect(setSpeakerName({ "講者 A": "王協理" }, "講者 A", "  ")).toEqual({});
  });

  it("名字裡的空白不修剪——正在打字的中間態不該被搶走（落庫時才 trim）", () => {
    expect(setSpeakerName({}, "講者 A", "王 協理 ")).toEqual({ "講者 A": "王 協理 " });
  });
});
