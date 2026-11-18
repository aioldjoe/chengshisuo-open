import { speakerLabels } from "./transcript";
import type {
  Commitment,
  Correction,
  Meeting,
  MeetingSection,
  MeetingSummary,
  TodoItem,
} from "./types";

/**
 * 記錄頁編輯的驗證＋套用（重點區可改可補、說話人命名全篇連動——GLOSSARY.md）。
 * strict：未知欄位或壞 shape 一律回 null（400），因為 patch 直接來自瀏覽器。
 * 逐字稿唯讀、身分與生命週期欄位（id/userId/audioKey/expiresAt…）不在可編輯範圍——
 * 錯詞替換（corrections）與說話人修正（speakerFixes）存的是規則不是改過的原文，
 * turns 因此永遠不在 patch 裡（見 lib/transcript.ts）。
 */

const isStr = (v: unknown): v is string => typeof v === "string";
const isStrOrNull = (v: unknown): v is string | null => v === null || isStr(v);
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** 物件只准出現 keys 中列出的鍵（多給就整包拒絕）。 */
const onlyKeys = (v: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(v).every((k) => keys.includes(k));

const isTodo = (v: unknown): v is TodoItem =>
  isRecord(v) && onlyKeys(v, ["task", "owner", "due"]) && isStr(v.task) &&
  isStrOrNull(v.owner ?? null) && isStrOrNull(v.due ?? null);

const isCommitment = (v: unknown): v is Commitment =>
  isRecord(v) && onlyKeys(v, ["who", "what", "due"]) && isStr(v.who) && isStr(v.what) &&
  isStrOrNull(v.due ?? null);

const isSection = (v: unknown): v is MeetingSection =>
  isRecord(v) && onlyKeys(v, ["title", "points", "decisions", "todos"]) && isStr(v.title) &&
  isStrArray(v.points) && isStrArray(v.decisions) &&
  Array.isArray(v.todos) && v.todos.every(isTodo);

/**
 * 一條換得到東西的規則：兩邊都要有字，而且不能一樣。
 * 「轉錯的詞」空字串會讓 split 把每個字都切開；「改成」空字串是全篇刪詞——
 * 那是刪內容不是修拼法，逐字稿唯讀這條線就破了。
 * 至於「全篇 0 處」只在面板擋：規則能不能命中會隨其他規則增刪而變，
 * 拿它當落庫條件會讓一次刪除害後面每一次 autosave 都 400。
 */
const isCorrection = (v: unknown): v is Correction =>
  isRecord(v) && onlyKeys(v, ["from", "to"]) && isStr(v.from) && isStr(v.to) &&
  v.from.trim() !== "" && v.to.trim() !== "" && v.from !== v.to;

/**
 * 說話人修正的鍵是 turns 的索引（字串），值只能是這場會議既有的講者標籤——
 * 憑空冒出一個沒出現過的人不是「修正」，是竄改。
 */
function isSpeakerFixes(v: unknown, m: Meeting): v is Record<string, string> {
  if (!isRecord(v)) return false;
  // 已經指到誰，那個人就一直算數——否則「命名過但沒發言的講者」被取消命名之後，
  // 舊修正會讓之後每一次 autosave 都 400，而使用者只看到「沒存上」。
  const labels = new Set([...speakerLabels(m), ...Object.values(m.speakerFixes ?? {})]);
  return Object.entries(v).every(([k, label]) => {
    // 鍵要長得像索引才算：Number("") 與 Number(" ") 都是 0，會混成「第 0 段」
    if (!/^\d+$/.test(k)) return false;
    return Number(k) < m.turns.length && isStr(label) && labels.has(label);
  });
}

function parseSummaryPatch(v: unknown): Partial<MeetingSummary> | null {
  if (!isRecord(v)) return null;
  if (!onlyKeys(v, ["title", "highlights", "decisions", "todos", "commitments", "sections"])) {
    return null;
  }
  const out: Partial<MeetingSummary> = {};
  if ("title" in v) { if (!isStr(v.title)) return null; out.title = v.title; }
  if ("highlights" in v) { if (!isStrArray(v.highlights)) return null; out.highlights = v.highlights; }
  if ("decisions" in v) { if (!isStrArray(v.decisions)) return null; out.decisions = v.decisions; }
  if ("todos" in v) {
    if (!Array.isArray(v.todos) || !v.todos.every(isTodo)) return null;
    out.todos = v.todos;
  }
  if ("commitments" in v) {
    if (!Array.isArray(v.commitments) || !v.commitments.every(isCommitment)) return null;
    out.commitments = v.commitments;
  }
  if ("sections" in v) {
    if (!Array.isArray(v.sections) || !v.sections.every(isSection)) return null;
    out.sections = v.sections;
  }
  return out;
}

/**
 * 記錄頁送出前的清理（頁端用）。編輯 UI 允許先按「新增」再打字，
 * 所以空白列一定會出現——它們是編輯中的暫態，不該落庫。
 * 只清空白與前後空白，不做任何內容判斷。
 */
export function cleanMeetingEdits({
  speakerNames,
  summary,
  corrections = [],
  speakerFixes = {},
}: Pick<Meeting, "speakerNames" | "summary" | "corrections" | "speakerFixes">): {
  speakerNames: Record<string, string>;
  summary: MeetingSummary;
  corrections: Correction[];
  speakerFixes: Record<string, string>;
} {
  const blank = (s: string) => s.trim() === "";
  const nullIfBlank = (s: string | null) => (s === null || blank(s) ? null : s.trim());
  const strings = (xs: string[]) => xs.filter((x) => !blank(x)).map((x) => x.trim());
  const todos = (xs: TodoItem[]) =>
    xs
      .filter((t) => !blank(t.task))
      .map((t) => ({ task: t.task.trim(), owner: nullIfBlank(t.owner), due: nullIfBlank(t.due) }));

  const names: Record<string, string> = {};
  for (const [label, name] of Object.entries(speakerNames)) {
    // 名字清空＝取消命名，顯示端會退回原本的講者標籤。
    if (!blank(name)) names[label] = name.trim();
  }

  const fixes: Record<string, string> = {};
  for (const [i, label] of Object.entries(speakerFixes)) {
    // 清空＝取消修正，顯示端退回原本分離出來的講者
    if (!blank(label)) fixes[i] = label;
  }

  return {
    speakerNames: names,
    // 規則本身不 trim：面板上的「全篇 N 處」是用使用者打的字串數的，
    // 偷偷修剪會讓數到的跟存下去的不是同一條規則。空的整條丟掉就好。
    corrections: corrections.filter((c) => !blank(c.from) && !blank(c.to) && c.from !== c.to),
    speakerFixes: fixes,
    summary: {
      title: summary.title.trim(),
      highlights: strings(summary.highlights),
      decisions: strings(summary.decisions),
      todos: todos(summary.todos),
      commitments: summary.commitments
        .filter((c) => !blank(c.what))
        .map((c) => ({ who: c.who.trim(), what: c.what.trim(), due: nullIfBlank(c.due) })),
      sections: summary.sections
        .map((s) => ({
          title: s.title.trim(),
          points: strings(s.points),
          decisions: strings(s.decisions),
          todos: todos(s.todos),
        }))
        .filter((s) => !blank(s.title) || s.points.length > 0),
    },
  };
}

/** 驗證並套用編輯；patch 非法回 null。成功回新 Meeting（不改原物件）。 */
export function applyMeetingEdits(m: Meeting, patch: unknown): Meeting | null {
  if (!isRecord(patch)) return null;
  if (!onlyKeys(patch, ["speakerNames", "summary", "corrections", "speakerFixes"])) return null;

  let speakerNames = m.speakerNames;
  if ("speakerNames" in patch) {
    const v = patch.speakerNames;
    if (!isRecord(v) || !Object.values(v).every(isStr)) return null;
    speakerNames = v as Record<string, string>;
  }

  let corrections = m.corrections;
  if ("corrections" in patch) {
    const v = patch.corrections;
    if (!Array.isArray(v) || !v.every(isCorrection)) return null;
    corrections = v;
  }

  let speakerFixes = m.speakerFixes;
  if ("speakerFixes" in patch) {
    if (!isSpeakerFixes(patch.speakerFixes, m)) return null;
    speakerFixes = patch.speakerFixes;
  }

  let summary = m.summary;
  if ("summary" in patch) {
    const p = parseSummaryPatch(patch.summary);
    if (!p) return null;
    summary = { ...m.summary, ...p };
  }

  return { ...m, speakerNames, corrections, speakerFixes, summary };
}
