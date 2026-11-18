import type { AIProvider, GenerateJSONOptions, TokenUsage } from "./provider";
import { gatewayBaseUrl, gatewayHeaders } from "../gateway";
import { parseJSON } from "./json";

/**
 * xAI Grok 實作（REST、零依賴）。xAI 的 API 相容 OpenAI chat completions，
 * 直連 https://api.x.ai/v1，走 Cloudflare AI Gateway 時 slug 是 grok。
 *
 * 與 Gemini 版同策略：「prompt 指示回傳 JSON + 解析」，另開
 * response_format: json_object 提高服從度。不用 json_schema strict 模式——
 * strict 會拒收 pipeline 裡那些 items 沒展開的寬鬆 schema，而且三家要同一套 prompt 才能比。
 *
 * 型號注意：grok-4-fast／grok-4.1-fast 已於 2026-05-15 退役，打那個名字會被
 * 靜默轉到 grok-4.3 並照 grok-4.3 計費——所以預設就直接寫 grok-4.3，不用退役別名。
 */

const XAI_API = "https://api.x.ai/v1";

function endpoint(): string {
  const gw = gatewayBaseUrl("grok");
  return `${gw ?? XAI_API}/chat/completions`;
}

export class GrokProvider implements AIProvider {
  readonly name = "grok";
  readonly model: string;
  lastUsage?: TokenUsage;

  constructor(model?: string) {
    this.model = model ?? process.env.AI_MODEL ?? "grok-4.3";
  }

  async generateJSON<T>(opts: GenerateJSONOptions): Promise<T> {
    const key = process.env.XAI_API_KEY;
    if (!key) throw new Error("XAI_API_KEY 未設定");

    const system = [
      opts.system,
      "",
      "只輸出一個 JSON 物件，符合以下 JSON schema，不要有任何其他文字、不要用 markdown 程式碼區塊包起來：",
      JSON.stringify(opts.schema),
    ].join("\n");

    const res = await fetch(endpoint(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
        ...gatewayHeaders(),
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: opts.user },
        ],
        response_format: { type: "json_object" },
        max_tokens: opts.maxTokens ?? 4096,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`xAI API ${res.status}: ${body.slice(0, 500)}`);
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string | null } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    if (json.usage) {
      this.lastUsage = {
        input: json.usage.prompt_tokens ?? 0,
        output: json.usage.completion_tokens ?? 0,
      };
    }
    const text = json.choices?.[0]?.message?.content;
    if (!text) throw new Error("Grok 未回傳文字內容");
    return parseJSON<T>(text);
  }
}
