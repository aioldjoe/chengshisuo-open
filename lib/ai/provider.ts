/**
 * AI provider 抽象層（移植自 littleboss-line-bot）。
 * 換 provider／model／key 只改 env 與這裡的 factory，pipeline 的 prompt／schema 不動。
 *
 * 2026-08-16 起以 Gemini 與 Grok 為主體（作者決定，成本考量）；Anthropic 保留當備援。
 * 選型依據跑 bakeoff/llm.ts，不憑印象。
 */

export type JSONSchema = Record<string, unknown>;

export interface GenerateJSONOptions {
  system: string;
  user: string;
  /** 期望輸出的 JSON schema（結構化輸出用）。 */
  schema: JSONSchema;
  schemaName: string;
  /** 輸出上限；長會議的紀要抽取要開大，預設 4096。 */
  maxTokens?: number;
  /**
   * 思考深度提示。校正是查表型工作用 minimal（快、便宜、不會思考到把輸出額度吃光）；
   * 抽取用 low。不支援的 provider 忽略即可。
   */
  effort?: "minimal" | "low" | "high";
}

export type TokenUsage = { input: number; output: number };

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  /** 依 schema 產出結構化 JSON，回傳已解析的物件。 */
  generateJSON<T>(opts: GenerateJSONOptions): Promise<T>;
  /** 最近一次呼叫的用量（算成本用；provider 沒回報就是 undefined）。 */
  lastUsage?: TokenUsage;
}

export type ProviderName = "google" | "grok" | "anthropic";

/** 建立指定 provider。bake-off 直接用它組模型矩陣，不經 env 與 singleton。 */
export async function createProvider(name: string, model?: string): Promise<AIProvider> {
  switch (name.toLowerCase()) {
    case "google":
    case "gemini": {
      const { GeminiProvider } = await import("./gemini");
      return new GeminiProvider(model);
    }
    case "grok":
    case "xai": {
      const { GrokProvider } = await import("./grok");
      return new GrokProvider(model);
    }
    case "anthropic": {
      const { AnthropicProvider } = await import("./anthropic");
      return new AnthropicProvider(model);
    }
    default:
      throw new Error(`未知的 AI_PROVIDER: ${name}`);
  }
}

let cached: AIProvider | null = null;

/** 依 env 建立 provider（AI_PROVIDER／AI_MODEL），程序內快取一份。 */
export async function getProvider(): Promise<AIProvider> {
  if (!cached) {
    cached = await createProvider(process.env.AI_PROVIDER ?? "google", process.env.AI_MODEL);
  }
  return cached;
}
