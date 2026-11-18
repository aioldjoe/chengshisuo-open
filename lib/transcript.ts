import type { Correction, Meeting, TranscriptTurn } from "./types";

/**
 * 逐字稿的顯示解析。三件事都是「存的是規則、顯示時才套用」——
 * turns 一個字節都不落改（GLOSSARY.md：逐字稿唯讀，是承諾追蹤的證據層）。
 * 說話人命名（speakerNames）、錯詞替換（corrections）、說話人修正（speakerFixes）同構，
 * 所以刪掉規則就等於還原，原文從沒被動過。
 */

/** 說話人命名的顯示解析：命名過用真名，沒命名就用原標籤。 */
export function display(m: Pick<Meeting, "speakerNames">, label: string | null): string {
  if (!label) return "發言";
  return m.speakerNames[label] ?? label;
}

/**
 * 命名一位講者（回新的 speakerNames，不動原物件）。
 * 清空＝取消命名，而且鍵要真的刪掉：display() 只擋 null/undefined，
 * 留一個空字串等於講者名在畫面上變成一片空白——逐字稿列上就地改名時
 * 連可以再按的入口都沒了。落庫端 cleanMeetingEdits 也是同一條規則。
 * 名字本身不 trim：使用者還在打字，中間態不該被搶走。
 */
export function setSpeakerName(
  names: Record<string, string>,
  label: string,
  name: string,
): Record<string, string> {
  const next = { ...names };
  if (name.trim() === "") delete next[label];
  else next[label] = name;
  return next;
}

/** 這場會議的講者標籤：逐字稿裡出現過的，加上命名過（但可能已不在逐字稿裡）的。 */
export function speakerLabels(m: Pick<Meeting, "turns" | "speakerNames">): string[] {
  const set = new Set<string>();
  for (const t of m.turns) if (t.speaker) set.add(t.speaker);
  for (const k of Object.keys(m.speakerNames)) set.add(k);
  return [...set].sort();
}

/**
 * 錯詞替換：精確字串、依序套用。刻意不做 regex、不做大小寫模糊——
 * 內容以中文為主，模糊比對只會換到不該換的地方。
 * from 是空字串一定跳過：split("") 會把每個字切開，等於整段被 to 灌滿。
 */
export function applyCorrections(text: string, corrections: Correction[] | undefined): string {
  let out = text;
  for (const c of corrections ?? []) {
    if (c.from === "") continue;
    out = out.split(c.from).join(c.to);
  }
  return out;
}

/** 某個詞在全篇的命中次數（面板上的「全篇 N 處」，0 處不給存）。 */
export function countHits(turns: TranscriptTurn[], term: string): number {
  if (term === "") return 0;
  return turns.reduce((n, t) => n + t.text.split(term).length - 1, 0);
}

/**
 * 顯示用的逐字稿：套上錯詞替換與說話人修正。
 * 記錄頁、分享頁、SRT、Word 都吃這一份，四個出口才不會各自長出一套規則。
 */
export function displayTurns(
  m: Pick<Meeting, "turns" | "corrections" | "speakerFixes">,
): TranscriptTurn[] {
  const fixes = m.speakerFixes ?? {};
  return m.turns.map((t, i) => ({
    ...t,
    speaker: fixes[String(i)] ?? t.speaker,
    text: applyCorrections(t.text, m.corrections),
  }));
}
