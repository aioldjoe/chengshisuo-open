import { describe, expect, it } from "vitest";

import { caseMd, summaryMd, type ReportCase, type ReportRun } from "./stt-report";
import { scoreTurns } from "./stt-score";

const c: ReportCase = {
  id: "far-field",
  scenario: "遠場",
  audio: "a.m4a",
  terms: 1,
  anchors: 0,
  silences: 0,
  referenceFrom: "Scribe v1（現況）",
};

const ref = [
  { speaker: "講者 A", start: 0, text: "一次側變流量的取分最高。" },
  { speaker: "講者 B", start: 10, text: "主機換掉也是對的。" },
];
const hyp = [
  { speaker: "講者 A", start: 0, text: "一次測電流量的取分最高。" },
  { speaker: "講者 B", start: 11, text: "主機換掉也是對的。" },
];

const run: ReportRun = {
  caseId: "far-field",
  engine: { id: "scribe", label: "Scribe v1（現況）" },
  ok: true,
  elapsedMs: 41_000,
  turns: 2,
  score: scoreTurns(ref, hyp, { terms: ["一次側變流量"], audioSeconds: 20 }),
};

describe("summaryMd", () => {
  it("一家一列，數字進得了表格", () => {
    const md = summaryMd([c], [run], "2026-09-10");
    const row = md.split("\n").find((l) => l.includes("Scribe v1（現況）") && l.startsWith("| 遠場"));
    expect(row).toContain("10.5%"); // CER：正規化後 19 字（標點不算）錯 2 字
    expect(row).toContain("0.0%（0/1）"); // 詞表召回
    expect(row).toContain("41s");
  });

  it("帶答案考試的那組要標星號，並在表下講清楚為什麼", () => {
    const flagged: ReportRun = {
      ...run,
      engine: { id: "scribe-keyterms", label: "Scribe v1 ＋ 詞表提示", caveat: "等於帶著答案考試" },
    };
    const md = summaryMd([c], [flagged], "2026-09-10");
    expect(md).toContain("Scribe v1 ＋ 詞表提示 ※");
    expect(md).toContain("※ **Scribe v1 ＋ 詞表提示**：等於帶著答案考試");
  });

  it("表下要講明這張表不能回答的事——沒有讀法的數字會被當成結論引用", () => {
    const md = summaryMd([c], [run], "2026-09-10");
    expect(md).toContain("不是完整 DER");
    expect(md).toContain("reference 的時間戳是引擎給的");
  });
});

describe("caseMd", () => {
  it("列出詞被聽成哪幾種寫法，與 reference 草稿出自哪一家", () => {
    const md = caseMd(c, [run]);
    expect(md).toContain("一次測電流量×1");
    expect(md).toContain("reference 草稿出自 **Scribe v1（現況）**");
  });

  it("沒有 reference 的場次說「沒有分數」，不是印 0 分", () => {
    const md = caseMd(c, [{ caseId: "far-field", engine: run.engine, ok: true, turns: 170 }]);
    expect(md).toContain("沒有分數");
    expect(md).not.toContain("CER 0.0%");
  });
});
