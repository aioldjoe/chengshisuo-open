import type { TranscriptTurn } from "./types";

/**
 * 逐字稿轉 SRT。turns 只存起始秒數，沒有結束時間——
 * 用下一句的起始時間當這句的結束，最後一句補一段固定長度（TAIL_SECONDS）。
 */
const TAIL_SECONDS = 4;

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

function srtTimestamp(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms % 1000, 3)}`;
}

export function turnsToSrt(
  turns: TranscriptTurn[],
  displayName: (label: string | null) => string,
): string {
  return turns
    .map((t, i) => {
      const nextStart = i < turns.length - 1 ? turns[i + 1].start : t.start + TAIL_SECONDS;
      const end = Math.max(nextStart, t.start + 0.5); // 保底 0.5 秒，避免起訖相同
      const speaker = t.speaker ? `${displayName(t.speaker)}：` : "";
      return `${i + 1}\n${srtTimestamp(t.start)} --> ${srtTimestamp(end)}\n${speaker}${t.text}\n`;
    })
    .join("\n");
}
