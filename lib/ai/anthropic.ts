import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider, GenerateJSONOptions, TokenUsage } from "./provider";
import { gatewayBaseUrl, gatewayHeaders } from "../gateway";
import { parseJSON } from "./json";

/**
 * Anthropic 實作。
 * 用「prompt 指示回傳 JSON + 解析」而非各家專屬的 structured-output API——
 * 這樣換 provider（OpenAI/Google…）時介面一致、可攜性最高。
 */
export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  readonly model: string;
  lastUsage?: TokenUsage;
  // 讀 ANTHROPIC_API_KEY；有 Cloudflare AI Gateway 設定時改走 gateway（SDK 會在 baseURL 後接 /v1/messages）
  private client = new Anthropic({
    baseURL: gatewayBaseUrl("anthropic") ?? undefined,
    defaultHeaders: gatewayHeaders(),
  });

  constructor(model?: string) {
    this.model = model ?? process.env.AI_MODEL ?? "claude-opus-5";
  }

  async generateJSON<T>(opts: GenerateJSONOptions): Promise<T> {
    const system = [
      opts.system,
      "",
      "只輸出一個 JSON 物件，符合以下 JSON schema，不要有任何其他文字、不要用 markdown 程式碼區塊包起來：",
      JSON.stringify(opts.schema),
    ].join("\n");

    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: opts.maxTokens ?? 4096,
      system,
      messages: [{ role: "user", content: [{ type: "text", text: opts.user }] }],
    });

    this.lastUsage = { input: res.usage.input_tokens, output: res.usage.output_tokens };
    const textBlock = res.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("AI 未回傳文字內容");
    }
    return parseJSON<T>(textBlock.text);
  }
}
