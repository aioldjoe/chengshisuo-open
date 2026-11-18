import { describe, expect, it } from "vitest";

import { DEMO_MEETING } from "./demo-meeting";
import { parseClock } from "./format";

/**
 * 示範會議是手寫資料，沒有 pipeline 幫它把關——這些不變量壞掉的話，
 * 首頁點進來的第一印象就是一頁怪怪的記錄，所以用測試釘住。
 */
describe("DEMO_MEETING", () => {
  it("逐字稿時間戳嚴格遞增、從 0 開始、落在時長之內", () => {
    const starts = DEMO_MEETING.turns.map((t) => t.start);
    expect(starts[0]).toBe(0);
    for (let i = 1; i < starts.length; i++) expect(starts[i]).toBeGreaterThan(starts[i - 1]);
    expect(starts[starts.length - 1]).toBeLessThan(DEMO_MEETING.durationSeconds!);
  });

  it("durationLabel 跟 durationSeconds 講同一個數字", () => {
    expect(parseClock(DEMO_MEETING.durationLabel)).toBe(DEMO_MEETING.durationSeconds);
  });

  it("每一段發言的講者都有真名——示範頁同時展示講者改名這個功能", () => {
    for (const t of DEMO_MEETING.turns) {
      expect(t.speaker).not.toBeNull();
      expect(DEMO_MEETING.speakerNames[t.speaker!]).toBeTruthy();
    }
  });

  it("待辦與承諾的負責人都對得到講者——顯示端才翻得出真名", () => {
    const s = DEMO_MEETING.summary;
    const known = new Set(Object.keys(DEMO_MEETING.speakerNames));
    for (const todo of [...s.todos, ...s.sections.flatMap((x) => x.todos)]) {
      if (todo.owner) expect(known.has(todo.owner)).toBe(true);
    }
    for (const c of s.commitments) expect(known.has(c.who)).toBe(true);
  });

  it("重點區沒有一塊是空的，議題至少兩段——這頁是產品的門面，不能有空區", () => {
    const s = DEMO_MEETING.summary;
    expect(s.title).toBeTruthy();
    expect(s.highlights.length).toBeGreaterThan(0);
    expect(s.decisions.length).toBeGreaterThan(0);
    expect(s.todos.length).toBeGreaterThan(0);
    expect(s.commitments.length).toBeGreaterThan(0);
    // 議題分段視圖 >= 2 段才會出現（share-view 同款規則）
    expect(s.sections.length).toBeGreaterThanOrEqual(2);
    for (const sec of s.sections) {
      expect(sec.title).toBeTruthy();
      expect(sec.points.length).toBeGreaterThan(0);
    }
  });

  it("不過期、不帶音檔——demo 頁的兩個承諾", () => {
    expect(DEMO_MEETING.expiresAt).toBeNull();
    expect(DEMO_MEETING.audioKey).toBeNull();
  });

  it("首頁縮影的節錄句真的在這場會議裡——mock 與真頁講同一個故事", () => {
    const texts = DEMO_MEETING.turns.map((t) => t.text).join("\n");
    expect(DEMO_MEETING.summary.highlights).toContain(
      "中部三家客戶的續約都卡在報價單改版，統一延到月底再談。",
    );
    expect(DEMO_MEETING.summary.highlights).toContain(
      "這個月客訴多一倍，主因是出貨延遲，不是產品品質。",
    );
    expect(texts).toContain("上週報價單寄出去五家，只有兩家回");
    expect(texts).toContain("是價格問題，還是規格沒講清楚？");
  });
});
