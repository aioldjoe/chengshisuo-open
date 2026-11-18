import type { Commitment, MeetingSection, MeetingSummary, TodoItem } from "../types";

// 把 LLM 回傳的 JSON（形狀不保證）正規化成 MeetingSummary。
// 移植自先前專案的 summary-normalize，加上承諾追蹤（commitments）。
// 純函式（不 import server-only）以便單元測試。

// title 若退回這些通用詞，視同沒給——改用第一段小標題。
const GENERIC_TITLES = new Set(["會議紀要", "會議記錄", "會議記録", "會議", "紀要"]);
// 只有在「模型沒給具體標題、又完全沒有可用的分段小標題」時才會落到這個保底。
const FALLBACK_TITLE = "會議紀要";

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === "string" ? x.trim() : "")).filter((x) => x.length > 0);
}

function asTodoArray(v: unknown): TodoItem[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((t) => {
      const o = (t ?? {}) as Record<string, unknown>;
      const task = typeof o.task === "string" ? o.task.trim() : "";
      return {
        task,
        owner: typeof o.owner === "string" && o.owner.trim() ? o.owner.trim() : null,
        due: typeof o.due === "string" && o.due.trim() ? o.due.trim() : null,
      };
    })
    .filter((t) => t.task.length > 0);
}

function asCommitmentArray(v: unknown): Commitment[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((c) => {
      const o = (c ?? {}) as Record<string, unknown>;
      return {
        who: typeof o.who === "string" ? o.who.trim() : "",
        what: typeof o.what === "string" ? o.what.trim() : "",
        due: typeof o.due === "string" && o.due.trim() ? o.due.trim() : null,
      };
    })
    .filter((c) => c.who.length > 0 && c.what.length > 0);
}

function normalizeSection(v: unknown): MeetingSection {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    title: typeof o.title === "string" ? o.title.trim() : "",
    points: asStringArray(o.points),
    decisions: asStringArray(o.decisions),
    todos: asTodoArray(o.todos),
  };
}

function sectionIsEmpty(s: MeetingSection): boolean {
  return !s.title && s.points.length === 0 && s.decisions.length === 0 && s.todos.length === 0;
}

export function normalizeSummary(parsed: unknown): MeetingSummary {
  const o = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;

  const sections = (Array.isArray(o.sections) ? o.sections : [])
    .map(normalizeSection)
    .filter((s) => !sectionIsEmpty(s));

  // 頂層彙總：優先用模型給的；沒給就從各段彙整（總覽不留空）。
  let highlights = asStringArray(o.highlights);
  let decisions = asStringArray(o.decisions);
  let todos = asTodoArray(o.todos);
  if (highlights.length === 0) highlights = sections.flatMap((s) => s.points);
  if (decisions.length === 0) decisions = sections.flatMap((s) => s.decisions);
  if (todos.length === 0) todos = sections.flatMap((s) => s.todos);

  const rawTitle = typeof o.title === "string" ? o.title.trim() : "";
  const title =
    rawTitle && !GENERIC_TITLES.has(rawTitle)
      ? rawTitle
      : sections.find((s) => s.title)?.title || FALLBACK_TITLE;

  return { title, highlights, decisions, todos, commitments: asCommitmentArray(o.commitments), sections };
}
