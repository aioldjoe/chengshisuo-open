import type { AIProvider, GenerateJSONOptions, TokenUsage } from "./provider";
import { gatewayBaseUrl, gatewayHeaders } from "../gateway";
import { parseJSON } from "./json";

/**
 * Google Gemini 實作（REST、零依賴，同 lib/line.ts 的 fetch 風格）。
 * 與 Anthropic 版同策略：「prompt 指示回傳 JSON + 解析」，
 * 另開 responseMimeType: application/json 提高服從度。
 */

// 直連走 v1beta；gateway 版路徑照 Cloudflare 文件是 /google-ai-studio/v1/models/...
const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";

function geminiEndpoint(model: string): string {
  const gw = gatewayBaseUrl("google-ai-studio");
  return gw
    ? `${gw}/v1/models/${model}:generateContent`
    : `${GEMINI_API}/models/${model}:generateContent`;
}

export class GeminiProvider implements AIProvider {
  readonly name = "google";
  readonly model: string;
  lastUsage?: TokenUsage;

  constructor(model?: string) {
    // 2.5 那一代對新帳號已停開（generateContent 回 404 "no longer available to new users"），
    // 別再寫 2.5；預設 3.6-flash，最終選型看 pnpm bakeoff:llm。
    this.model = model ?? process.env.AI_MODEL ?? "gemini-3.6-flash";
  }

  async generateJSON<T>(opts: GenerateJSONOptions): Promise<T> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY 未設定");

    const system = [
      opts.system,
      "",
      "只輸出一個 JSON 物件，符合以下 JSON schema，不要有任何其他文字、不要用 markdown 程式碼區塊包起來：",
      JSON.stringify(opts.schema),
    ].join("\n");

    // Gemini 3 系列會思考，而思考 token 也算在 maxOutputTokens 裡——不處理的話
    // 校正那種 2048 上限的呼叫會被思考吃光、JSON 截斷（bake-off 實際踩到）。
    // minimal＝不思考；其他等級要多留 headroom 給思考，正文才寫得完。
    // 不是每個型號都吃 minimal（3.7-flash 就回 400），被拒就降到 low 重打一次。
    const call = (effort: "minimal" | "low" | "high") =>
      fetch(geminiEndpoint(this.model), {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key, ...gatewayHeaders() },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: opts.user }] }],
          generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens: (opts.maxTokens ?? 4096) + (effort === "minimal" ? 0 : 4096),
            thinkingConfig: { thinkingLevel: effort },
          },
        }),
      });

    const effort = opts.effort ?? "low";
    let res = await call(effort);
    if (res.status === 400 && effort === "minimal") {
      const body = await res.text();
      if (!/thinking level/i.test(body)) throw new Error(`Gemini API 400: ${body.slice(0, 500)}`);
      res = await call("low");
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gemini API ${res.status}: ${body.slice(0, 500)}`);
    }

    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
    };
    if (json.usageMetadata) {
      // Gemini 的 thinking token 也照 output 計價，要一起算
      this.lastUsage = {
        input: json.usageMetadata.promptTokenCount ?? 0,
        output: (json.usageMetadata.candidatesTokenCount ?? 0) + (json.usageMetadata.thoughtsTokenCount ?? 0),
      };
    }
    const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    if (!text) throw new Error("Gemini 未回傳文字內容");
    return parseJSON<T>(text);
  }
}
