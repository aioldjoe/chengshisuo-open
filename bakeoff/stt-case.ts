/**
 * 一場測試 case 的定義（issue #28）。格式與人工工作流見 bakeoff/cases/README.md。
 *
 * 這一層唯一的職責是「把人手寫的 case.json 讀成數字，讀不懂就當場喊」——
 * 評測最貴的錯是安靜地算出一個錯的分數，然後拿它去做選型決策。
 */

import { parseClock } from "../lib/format";
import type { CaseSpec } from "./stt-score";

export type SttCase = {
  id: string;
  /** 這場屬於哪一類場景（安靜會議室／遠場／吵雜／插話／專有名詞／線上會議）。 */
  scenario: string;
  /** 音檔路徑（相對於 case 目錄或絕對路徑，支援 ~）。 */
  audio: string;
  /** 真正的講者數（人數提示引擎要用；沒填就不跑那組）。 */
  speakers?: number;
  notes?: string;
  spec: CaseSpec;
};

/** 「03:12」或 192 都收；讀不懂就丟錯（把原字串帶出來，人才知道去改哪一行）。 */
function seconds(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const s = parseClock(value);
    if (s !== null) return s;
  }
  throw new Error(`case.json 的 ${field} 看不懂：${JSON.stringify(value)}（要 mm:ss、h:mm:ss 或秒數）`);
}

export function parseCase(id: string, raw: unknown): SttCase {
  const c = raw as Record<string, unknown>;
  if (typeof c?.audio !== "string" || c.audio.length === 0) {
    throw new Error(`case「${id}」缺 audio——沒有音檔就沒有 case`);
  }

  const anchors = (c.anchors as { at: unknown; text: unknown }[] | undefined)?.map((a, i) => ({
    at: seconds(a.at, `anchors[${i}].at`),
    text: String(a.text ?? ""),
  }));
  const silences = (c.silences as { from: unknown; to: unknown }[] | undefined)?.map((s, i) => ({
    from: seconds(s.from, `silences[${i}].from`),
    to: seconds(s.to, `silences[${i}].to`),
  }));

  return {
    id,
    scenario: typeof c.scenario === "string" ? c.scenario : "（未分類）",
    audio: c.audio,
    speakers: typeof c.speakers === "number" ? c.speakers : undefined,
    notes: typeof c.notes === "string" ? c.notes : undefined,
    spec: {
      terms: Array.isArray(c.terms) ? c.terms.map(String) : [],
      anchors,
      silences,
      audioSeconds: c.audioSeconds === undefined ? undefined : seconds(c.audioSeconds, "audioSeconds"),
    },
  };
}
