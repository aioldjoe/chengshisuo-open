/**
 * STT bake-off 的對戰組合（issue #28）。
 *
 * Scribe 那幾家跑的是產品自己那支 lib/stt/scribe.ts——量到的必須是使用者真的拿到的東西
 * （含簡轉繁、含 wordsToTurns 的併段規則），不是另一條平行實作。可調的鈕以 options 傳。
 * 2026-09-10 對著真 API 打過確認：scribe_v2 存在、num_speakers／diarization_threshold 收、
 * keyterms 要重複欄位（送 JSON 字串會 400）。
 *
 * 第二供應商是 OpenAI gpt-4o-transcribe-diarize（沿用 2026-08-12 那次的對戰組合）。
 */

import { transcribe, type ScribeOptions } from "../lib/stt/scribe";
import type { TranscriptTurn } from "../lib/types";

export type EngineInput = {
  audio: Buffer;
  filename: string;
  contentType: string;
  /** 該場的專有名詞詞表（keyterms 引擎要用）。 */
  terms: string[];
  /** 該場真正的講者數（num_speakers 引擎要用）。 */
  speakers?: number;
};

export type EngineResult = {
  turns: TranscriptTurn[];
  language: string | null;
  durationSeconds: number | null;
  elapsedMs: number;
};

export type Engine = {
  id: string;
  label: string;
  /** 缺 key 就跳過，不是失敗。 */
  envKey: string;
  /** 這組不能跟別組並排比較的理由；沒有就不填。 */
  caveat?: string;
  /** 這次會送出去的參數——快取靠它失效，換了鈕不會拿舊稿算新分數。 */
  signature(input: Omit<EngineInput, "audio" | "contentType">): unknown;
  run(input: EngineInput): Promise<EngineResult>;
};

function scribeEngine(
  id: string,
  label: string,
  options: (input: Omit<EngineInput, "audio" | "contentType">) => ScribeOptions,
  caveat?: string,
): Engine {
  return {
    id,
    label,
    envKey: "ELEVENLABS_API_KEY",
    caveat,
    signature: options,
    async run(input) {
      const t0 = Date.now();
      const r = await transcribe(input.audio, input.filename, input.contentType, options(input));
      return {
        turns: r.turns,
        language: r.language,
        durationSeconds: r.durationSeconds,
        elapsedMs: Date.now() - t0,
      };
    },
  };
}

/**
 * fetch（undici）的 headersTimeout 是 5 分鐘，OpenAI 同步轉寫長音檔會超過——
 * 改用原生 https 手組 multipart（這段是從 2026-08-12 的 run.mjs 搬過來的，踩過才有）。
 */
async function openaiTranscribe(input: EngineInput): Promise<unknown> {
  const { request } = await import("node:https");
  const boundary = `----bakeoff${Math.random().toString(36).slice(2)}`;
  const field = (name: string, value: string) =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${encodeURIComponent(input.filename)}"\r\nContent-Type: ${input.contentType}\r\n\r\n`,
    ),
    input.audio,
    Buffer.from(
      `\r\n${field("model", "gpt-4o-transcribe-diarize")}${field("response_format", "diarized_json")}${field("chunking_strategy", "auto")}--${boundary}--\r\n`,
    ),
  ]);

  return new Promise((resolve, reject) => {
    const req = request(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
        },
        timeout: 1_800_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode !== 200) {
            reject(new Error(`openai ${res.statusCode}: ${text.slice(0, 300)}`));
            return;
          }
          resolve(JSON.parse(text));
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("openai: socket timeout")));
    req.on("error", reject);
    req.end(body);
  });
}

const openai: Engine = {
  id: "openai",
  label: "OpenAI gpt-4o-transcribe-diarize",
  envKey: "OPENAI_API_KEY",
  signature: () => ({ model: "gpt-4o-transcribe-diarize", response_format: "diarized_json" }),
  async run(input) {
    const t0 = Date.now();
    const json = (await openaiTranscribe(input)) as {
      language?: string;
      segments?: { speaker?: string; text?: string; start?: number; end?: number }[];
    };
    // speaker_0 / A → 講者 A、講者 B…（依首次出現順序，跟 Scribe 那邊對齊）
    const seen = new Map<string, string>();
    const label = (raw: string) => {
      if (!seen.has(raw)) seen.set(raw, `講者 ${String.fromCharCode(65 + seen.size)}`);
      return seen.get(raw)!;
    };
    const turns: TranscriptTurn[] = [];
    let lastEnd = 0;
    for (const s of json.segments ?? []) {
      const speaker = label(String(s.speaker ?? "?"));
      lastEnd = Math.max(lastEnd, s.end ?? 0);
      const prev = turns.at(-1);
      if (prev && prev.speaker === speaker) prev.text += s.text ?? "";
      else turns.push({ speaker, start: s.start ?? 0, text: s.text ?? "" });
    }
    return {
      turns: turns.map((t) => ({ ...t, text: t.text.trim() })).filter((t) => t.text.length > 0),
      language: json.language ?? null,
      durationSeconds: lastEnd > 0 ? lastEnd : null,
      elapsedMs: Date.now() - t0,
    };
  },
};

/**
 * 對戰名單。`scribe` 是現況（＝產品此刻送出去的那組參數），其餘是「可調的鈕」與對照組。
 * 想加一組就在這裡加一行——run 的那支只認 id。
 */
export const ENGINES: Engine[] = [
  scribeEngine("scribe", "Scribe v1（現況）", () => ({ model: "scribe_v1" })),
  scribeEngine("scribe-v2", "Scribe v2", () => ({ model: "scribe_v2" })),
  scribeEngine(
    "scribe-keyterms",
    "Scribe v1 ＋ 詞表提示",
    (i) => ({ model: "scribe_v1", keyterms: i.terms.slice(0, 1000).filter((t) => t.length < 50) }),
    "餵進 STT 的 keyterms 就是拿來算召回率的那份詞表——這一組等於帶著答案考試，"
      + "召回率不能跟別組並排比。真實情境沒有逐場詞表；要它上線就得先有「詞表從哪來」的答案"
      + "（使用者自己填？從歷史會議累積？），那是另一張票。看它有沒有用要看 CER 與逐段表。",
  ),
  scribeEngine("scribe-speakers", "Scribe v1 ＋ 講者數提示", (i) => ({
    model: "scribe_v1",
    numSpeakers: i.speakers,
  })),
  openai,
];

export function engineById(id: string): Engine | undefined {
  return ENGINES.find((e) => e.id === id);
}
