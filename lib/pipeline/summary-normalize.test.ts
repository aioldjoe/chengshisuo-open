import { describe, expect, it } from "vitest";

import { normalizeSummary } from "./summary-normalize";

describe("normalizeSummary", () => {
  it("完整形狀原樣通過，含承諾追蹤", () => {
    const s = normalizeSummary({
      title: "冰水主機能效檢討",
      sections: [{ title: "泵浦", points: ["p1"], decisions: ["d1"], todos: [] }],
      highlights: ["h1"],
      decisions: ["d1"],
      todos: [{ task: "整理主機清單", owner: "講者 A", due: null }],
      commitments: [{ who: "講者 B", what: "下週給評估報告", due: "下週五前" }],
    });
    expect(s.title).toBe("冰水主機能效檢討");
    expect(s.commitments).toEqual([{ who: "講者 B", what: "下週給評估報告", due: "下週五前" }]);
  });

  it("通用標題退回第一段小標題", () => {
    const s = normalizeSummary({
      title: "會議紀要",
      sections: [{ title: "泵浦變流量", points: ["p"], decisions: [], todos: [] }],
    });
    expect(s.title).toBe("泵浦變流量");
  });

  it("頂層彙總缺席時從 sections 彙整；壞形狀承諾被過濾", () => {
    const s = normalizeSummary({
      sections: [
        { title: "A", points: ["p1"], decisions: ["d1"], todos: [{ task: "t1" }] },
        { title: "B", points: ["p2"], decisions: [], todos: [] },
      ],
      commitments: [{ who: "", what: "沒有承諾人" }, { who: "講者 A" }, "junk"],
    });
    expect(s.highlights).toEqual(["p1", "p2"]);
    expect(s.decisions).toEqual(["d1"]);
    expect(s.todos).toMatchObject([{ task: "t1" }]);
    expect(s.commitments).toEqual([]);
  });

  it("整包垃圾也回安全保底", () => {
    const s = normalizeSummary(null);
    expect(s.title).toBe("會議紀要");
    expect(s.sections).toEqual([]);
    expect(s.commitments).toEqual([]);
  });
});
