import { describe, expect, it } from "vitest";

import { applyMeetingEdits, cleanMeetingEdits } from "./meeting-edit";
import type { Meeting } from "./types";

const meeting = (): Meeting => ({
  id: "11111111-2222-4333-8444-555555555555",
  userId: "U1",
  createdAt: "2026-08-12T03:00:00.000Z",
  filename: "a.m4a",
  language: "zho",
  durationLabel: "17:39",
  turns: [
    { speaker: "講者 A", start: 0, text: "開始" },
    { speaker: "講者 B", start: 8, text: "愛克賽那份呢" },
  ],
  summary: {
    title: "原標題",
    highlights: ["原重點"],
    decisions: [],
    todos: [{ task: "原待辦", owner: null, due: null }],
    commitments: [{ who: "講者 A", what: "原承諾", due: null }],
    sections: [],
  },
  speakerNames: {},
  audioKey: null,
  expiresAt: null,
  shareToken: null,
});

describe("applyMeetingEdits", () => {
  it("說話人命名：整份替換 speakerNames", () => {
    const out = applyMeetingEdits(meeting(), { speakerNames: { "講者 A": "王協理" } });
    expect(out?.speakerNames).toEqual({ "講者 A": "王協理" });
    expect(out?.turns).toEqual(meeting().turns); // 逐字稿本體不動，顯示端換名
  });

  it("重點區可改可補：partial summary 只動給的欄位", () => {
    const out = applyMeetingEdits(meeting(), {
      summary: { title: "新標題", highlights: ["新重點一", "新重點二"] },
    });
    expect(out?.summary.title).toBe("新標題");
    expect(out?.summary.highlights).toEqual(["新重點一", "新重點二"]);
    expect(out?.summary.todos).toEqual(meeting().summary.todos);
    expect(out?.summary.commitments).toEqual(meeting().summary.commitments);
  });

  it("todos／commitments 帶完整物件 shape 才收", () => {
    const out = applyMeetingEdits(meeting(), {
      summary: { todos: [{ task: "補一條", owner: "小林", due: "週五前" }] },
    });
    expect(out?.summary.todos).toEqual([{ task: "補一條", owner: "小林", due: "週五前" }]);
    expect(
      applyMeetingEdits(meeting(), { summary: { todos: [{ notTask: 1 }] } }),
    ).toBeNull();
  });

  it("未知頂層欄位 → null（逐字稿唯讀、身分欄位不可改）", () => {
    expect(applyMeetingEdits(meeting(), { turns: [] })).toBeNull();
    expect(applyMeetingEdits(meeting(), { userId: "U-evil" })).toBeNull();
  });

  it("壞 shape → null", () => {
    expect(applyMeetingEdits(meeting(), { summary: { highlights: "不是陣列" } })).toBeNull();
    expect(applyMeetingEdits(meeting(), { speakerNames: { "講者 A": 123 } })).toBeNull();
    expect(applyMeetingEdits(meeting(), "字串")).toBeNull();
  });

  it("錯詞替換：整份替換 corrections，逐字稿本體不動", () => {
    const out = applyMeetingEdits(meeting(), { corrections: [{ from: "愛克賽", to: "Excel" }] });
    expect(out?.corrections).toEqual([{ from: "愛克賽", to: "Excel" }]);
    expect(out?.turns).toEqual(meeting().turns); // 存的是規則，不是改過的原文
  });

  it("錯詞替換：壞 shape 與換不到東西的規則都不收", () => {
    expect(applyMeetingEdits(meeting(), { corrections: [{ from: "愛克賽" }] })).toBeNull();
    expect(applyMeetingEdits(meeting(), { corrections: [{ from: "", to: "X" }] })).toBeNull();
    expect(applyMeetingEdits(meeting(), { corrections: [{ from: "  ", to: "X" }] })).toBeNull();
    // 「改成」留空＝全篇刪掉一個詞，那是刪內容不是修拼法（前端也擋，這裡是機制面）
    expect(applyMeetingEdits(meeting(), { corrections: [{ from: "愛克賽", to: "" }] })).toBeNull();
    expect(applyMeetingEdits(meeting(), { corrections: [{ from: "X", to: "X" }] })).toBeNull();
    expect(
      applyMeetingEdits(meeting(), { corrections: [{ from: "a", to: "b", regex: true }] }),
    ).toBeNull();
    expect(applyMeetingEdits(meeting(), { corrections: {} })).toBeNull();
  });

  it("說話人修正：某一段改指派給另一位既有講者", () => {
    const out = applyMeetingEdits(meeting(), { speakerFixes: { "1": "講者 A" } });
    expect(out?.speakerFixes).toEqual({ "1": "講者 A" });
    expect(out?.turns).toEqual(meeting().turns); // 改的是「這段是誰講的」，一個字都不動
  });

  it("說話人修正：索引要落在逐字稿範圍內，值只能是既有講者", () => {
    expect(applyMeetingEdits(meeting(), { speakerFixes: { "9": "講者 A" } })).toBeNull();
    expect(applyMeetingEdits(meeting(), { speakerFixes: { "-1": "講者 A" } })).toBeNull();
    expect(applyMeetingEdits(meeting(), { speakerFixes: { "1.5": "講者 A" } })).toBeNull();
    expect(applyMeetingEdits(meeting(), { speakerFixes: { x: "講者 A" } })).toBeNull();
    // Number("") 與 Number(" ") 都是 0——鍵要長得像索引才算，別讓空字串混成第 0 段
    expect(applyMeetingEdits(meeting(), { speakerFixes: { "": "講者 A" } })).toBeNull();
    expect(applyMeetingEdits(meeting(), { speakerFixes: { " ": "講者 A" } })).toBeNull();
    // 憑空冒出一個沒出現過的人＝竄改，不是修正
    expect(applyMeetingEdits(meeting(), { speakerFixes: { "0": "講者 Z" } })).toBeNull();
  });

  it("說話人修正：已存在的修正指到誰，那個人就一直算數", () => {
    // 不然「命名過但沒發言的講者」被取消命名後，舊修正會讓之後每一次 autosave 都 400
    const m = { ...meeting(), speakerFixes: { "0": "講者 C" } };
    expect(applyMeetingEdits(m, { speakerFixes: { "0": "講者 C", "1": "講者 C" } })).not.toBeNull();
  });

  it("說話人修正：命名過但已不在逐字稿裡的講者也算既有", () => {
    const m = { ...meeting(), speakerNames: { "講者 C": "小林" } };
    expect(applyMeetingEdits(m, { speakerFixes: { "0": "講者 C" } })?.speakerFixes).toEqual({
      "0": "講者 C",
    });
  });
});

describe("cleanMeetingEdits", () => {
  const summary = (over: Partial<Meeting["summary"]> = {}): Meeting["summary"] => ({
    ...meeting().summary,
    ...over,
  });

  it("丟掉編輯中留下的空白列", () => {
    const out = cleanMeetingEdits({
      speakerNames: {},
      summary: summary({
        highlights: ["真的重點", "", "   "],
        todos: [
          { task: "真的待辦", owner: null, due: null },
          { task: "  ", owner: "講者 A", due: "明天" },
        ],
        commitments: [
          { who: "講者 A", what: "真的承諾", due: null },
          { who: "講者 B", what: "", due: null },
        ],
      }),
    });
    expect(out.summary.highlights).toEqual(["真的重點"]);
    expect(out.summary.todos).toEqual([{ task: "真的待辦", owner: null, due: null }]);
    expect(out.summary.commitments).toEqual([{ who: "講者 A", what: "真的承諾", due: null }]);
  });

  it("修剪前後空白，空字串的 owner/due 收斂成 null", () => {
    const out = cleanMeetingEdits({
      speakerNames: {},
      summary: summary({
        title: "  標題  ",
        todos: [{ task: " 做事 ", owner: " ", due: "" }],
      }),
    });
    expect(out.summary.title).toBe("標題");
    expect(out.summary.todos).toEqual([{ task: "做事", owner: null, due: null }]);
  });

  it("說話人名字清空＝取消命名（該 key 不送出，顯示端退回標籤）", () => {
    const out = cleanMeetingEdits({
      speakerNames: { "講者 A": "王協理", "講者 B": "  " },
      summary: summary(),
    });
    expect(out.speakerNames).toEqual({ "講者 A": "王協理" });
  });

  it("議題分段：標題與要點都空才整段丟掉", () => {
    const out = cleanMeetingEdits({
      speakerNames: {},
      summary: summary({
        sections: [
          { title: "有標題", points: [], decisions: [], todos: [] },
          { title: "", points: ["有要點"], decisions: [], todos: [] },
          { title: "  ", points: ["", " "], decisions: [], todos: [] },
        ],
      }),
    });
    expect(out.summary.sections).toHaveLength(2);
  });

  it("輸出必定通得過 applyMeetingEdits 的嚴格驗證", () => {
    const out = cleanMeetingEdits({
      speakerNames: { "講者 A": "王協理" },
      summary: summary({ highlights: ["a", ""] }),
    });
    expect(applyMeetingEdits(meeting(), out)).not.toBeNull();
  });

  it("錯詞替換：空的「轉錯的詞」不落庫，其餘一字不改地送出", () => {
    const out = cleanMeetingEdits({
      speakerNames: {},
      summary: summary(),
      corrections: [
        { from: "愛克賽", to: "Excel" },
        { from: "  ", to: "X" },
        { from: "", to: "" },
        { from: "空的改成", to: " " },
        { from: "一樣", to: "一樣" },
      ],
    });
    // 面板上的「全篇 N 處」是用原字串數的，這裡不能偷偷 trim——數到的跟存下去的要是同一條規則
    expect(out.corrections).toEqual([{ from: "愛克賽", to: "Excel" }]);
  });

  it("說話人修正：空值＝取消修正，該 key 不送出", () => {
    const out = cleanMeetingEdits({
      speakerNames: {},
      summary: summary(),
      speakerFixes: { "0": "講者 B", "1": "  " },
    });
    expect(out.speakerFixes).toEqual({ "0": "講者 B" });
  });

  it("兩個新欄位的輸出也通得過嚴格驗證", () => {
    const out = cleanMeetingEdits({
      speakerNames: {},
      summary: summary(),
      corrections: [{ from: "愛克賽", to: "Excel" }],
      speakerFixes: { "1": "講者 A" },
    });
    expect(applyMeetingEdits(meeting(), out)).not.toBeNull();
  });
});
