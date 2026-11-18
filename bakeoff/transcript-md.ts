import { fmtTime } from "../lib/format";
import type { TranscriptTurn } from "../lib/types";

/**
 * bake-off 的逐字稿交換格式：`**[mm:ss] 講者 X**：文字`。
 * 這個格式同時是「人工 reference transcript」的格式——reference 是由引擎輸出改出來的，
 * 不是從零打字，所以兩邊必須是同一個格式（見 bakeoff/cases/README.md）。
 */

const LINE = /^\*\*\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s+([^*]+?)\*\*[：:]\s*(.*)$/;

/** md → turns。認不出的行一律略過（標題、meta、空行）。 */
export function parseTranscriptMd(md: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const raw of md.split("\n")) {
    const m = LINE.exec(raw.trim());
    if (!m) continue;
    const [, a, b, c, speaker, text] = m;
    // 三段是 h:mm:ss（超過一小時的場次），兩段是 mm:ss
    const start = c
      ? Number(a) * 3600 + Number(b) * 60 + Number(c)
      : Number(a) * 60 + Number(b);
    turns.push({ speaker: speaker.trim(), start, text: text.trim() });
  }
  return turns;
}

/** turns → md。`--init` 產 reference 草稿用：人改的就是這份。 */
export function formatTranscriptMd(turns: TranscriptTurn[]): string {
  return turns
    .map((t) => `**[${fmtTime(t.start)}] ${t.speaker ?? "發言"}**：${t.text}`)
    .join("\n\n");
}
