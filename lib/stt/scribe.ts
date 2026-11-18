import { Converter } from "opencc-js";

import { gatewayBaseUrl, gatewayHeaders } from "../gateway";
import { fmtTime } from "../format";
import type { TranscriptTurn } from "../types";

/**
 * ElevenLabs Scribe 語音轉文字＋講者分離（移植自先前專案的 asr.ts）。
 * 2026-08-12 bake-off 定案：41s 轉完 17.6 分鐘、中英夾雜過關。
 * 領域詞的系統性聽錯（IPLV→IPOV 之類）交給 pipeline 的 LLM 校正 pass，不在這層處理。
 * 文件：https://elevenlabs.io/docs/api-reference/speech-to-text/convert
 */

// Scribe 對中文輸出簡體；一律轉繁體（字級轉換，保持逐字）。
const toTraditional = Converter({ from: "cn", to: "tw" });

const MODEL = process.env.ELEVENLABS_STT_MODEL || "scribe_v1";

function sttEndpoint(): string {
  const gw = gatewayBaseUrl("elevenlabs");
  return gw ? `${gw}/v1/speech-to-text` : "https://api.elevenlabs.io/v1/speech-to-text";
}

type ElevenWord = {
  text: string;
  start: number | null;
  end: number | null;
  type: "word" | "spacing" | "audio_event";
  speaker_id: string | null;
};

type ElevenResponse = {
  language_code: string | null;
  text: string;
  words?: ElevenWord[];
};

export function hasSttKey(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

/** speaker_0 / speaker_1 … → 講者 A / 講者 B …（依首次出現順序）。 */
function speakerLabeler() {
  const seen = new Map<string, string>();
  return (id: string | null): string | null => {
    if (!id) return null;
    if (!seen.has(id)) {
      seen.set(id, `講者 ${String.fromCharCode(65 + seen.size)}`);
    }
    return seen.get(id)!;
  };
}

/** 把字詞序列依連續講者併成發言段落。exported for test。 */
export function wordsToTurns(words: ElevenWord[]): TranscriptTurn[] {
  const label = speakerLabeler();
  const turns: TranscriptTurn[] = [];
  let cur: TranscriptTurn | null = null;
  let curId: string | null | undefined = undefined;

  for (const w of words) {
    if (w.type === "audio_event") continue;
    const isWord = w.type === "word";
    // 講者切換（以實質字詞為準，spacing 接在當前段）
    if (isWord && w.speaker_id !== curId) {
      cur = { speaker: label(w.speaker_id), start: w.start ?? 0, text: "" };
      curId = w.speaker_id;
      turns.push(cur);
    }
    if (cur) cur.text += w.text;
  }

  return turns
    .map((t) => ({ ...t, text: toTraditional(t.text.trim()) }))
    .filter((t) => t.text.length > 0);
}

// fmtTime 移居 lib/format.ts（client 也要用）；re-export 保持舊 import 路徑可用。
export { fmtTime };

/**
 * Scribe 的可調參數。產品端一個都不傳（＝現況），只有 bake-off（issue #28）在轉這些鈕——
 * 這樣量到的才是使用者真的拿到的東西，而不是另一條平行的實作。
 * 量出哪顆鈕有用再回頭改產品預設。文件：https://elevenlabs.io/docs/api-reference/speech-to-text/convert
 */
export type ScribeOptions = {
  /** 覆寫 model_id（預設 env 或 scribe_v1）。 */
  model?: string;
  /** 講者數上限；設了之後 diarizationThreshold 會被 API 忽略。 */
  numSpeakers?: number;
  /** 講者分離的敏感度（越高越傾向把兩個人併成一個）；只在沒給 numSpeakers 時有效。 */
  diarizationThreshold?: number;
  /** 專有名詞提示（最多 1000 個、每個 50 字內）——在 STT 這層就把詞聽對，而不是事後校正。 */
  keyterms?: string[];
};

export async function transcribe(
  audio: Buffer,
  filename: string,
  contentType: string,
  options: ScribeOptions = {},
): Promise<{
  turns: TranscriptTurn[];
  language: string | null;
  durationLabel: string | null;
  /** 額度計量用的秒數（最後一個字的結束時間）；量不到為 null。 */
  durationSeconds: number | null;
}> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: contentType }), filename);
  form.append("model_id", options.model || MODEL);
  form.append("diarize", "true");
  form.append("timestamps_granularity", "word");
  form.append("tag_audio_events", "false");
  if (options.numSpeakers) form.append("num_speakers", String(options.numSpeakers));
  else if (options.diarizationThreshold !== undefined) {
    form.append("diarization_threshold", String(options.diarizationThreshold));
  }
  // keyterms 要一個一個 append（重複欄位）。整包送 JSON 字串會被當成一個關鍵詞，
  // API 回 400 invalid_keyword——2026-09-10 實打驗過。
  for (const term of options.keyterms ?? []) form.append("keyterms", term);

  const res = await fetch(sttEndpoint(), {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY as string, ...gatewayHeaders() },
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs STT ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as ElevenResponse;
  const words = data.words ?? [];
  const turns = words.length
    ? wordsToTurns(words)
    : data.text
      ? [{ speaker: null, start: 0, text: toTraditional(data.text.trim()) }]
      : [];

  const lastEnd = words.reduce((m, w) => Math.max(m, w.end ?? 0), 0);

  return {
    turns,
    language: data.language_code,
    durationLabel: lastEnd > 0 ? fmtTime(lastEnd) : null,
    durationSeconds: lastEnd > 0 ? lastEnd : null,
  };
}
