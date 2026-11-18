import { getProvider, type AIProvider } from "../ai/provider";
import type { TranscriptTurn } from "../types";

/**
 * LLM 校正 pass——pipeline 第二段（STT → 校正 → 抽取）。
 * bake-off 洞察：Scribe 的錯誤集中在「領域詞的系統性聽錯」
 * （一次側變流量→一次測電流量、IPLV→IPOV、1+ 級→E plus）。
 * 因此不叫 LLM 重寫全文（輸出貴、且會手癢潤飾），而是要一張全域替換表，
 * 由純函式套用——輸出小、可測、絕不動到沒錯的字。
 */

export type Correction = { from: string; to: string };

/** 套用替換表（全域、逐條）。純函式，exported for test。 */
export function applyCorrections(
  turns: TranscriptTurn[],
  corrections: Correction[],
): TranscriptTurn[] {
  const valid = corrections.filter(
    (c) => c.from && c.to && c.from !== c.to && c.from.length >= 2,
  );
  if (valid.length === 0) return turns;
  return turns.map((t) => {
    let text = t.text;
    for (const c of valid) text = text.split(c.from).join(c.to);
    return { ...t, text };
  });
}

const SYSTEM = `你是台灣商務會議逐字稿的校正員。逐字稿由語音辨識產生，中英夾雜，錯誤集中在「專有名詞或領域術語被系統性聽錯」。
你的任務：找出這類聽錯，輸出一張全域替換表。規則：
- 只抓「明顯聽錯的專有名詞、術語、單位、人名、機構名」；口語、贅字、語氣一律不動。
- from 必須逐字等於逐字稿裡實際出現的字串；to 是正確寫法。
- 「在／再」「的／得／地」「做／作」「他／她」這類同音而會改變語意的常用字，除非上下文有明確依據，一律保留原文。
- 標點、空格、英文大小寫、簡繁用詞都不在範圍內——這裡只修聽錯的詞，不做排版也不做在地化改寫。
- 不確定的不要列。寧缺勿濫——錯誤的替換比不替換更糟。
- 沒有可修的就回空陣列。`;

const SCHEMA = {
  type: "object",
  properties: {
    corrections: {
      type: "array",
      items: {
        type: "object",
        properties: { from: { type: "string" }, to: { type: "string" } },
        required: ["from", "to"],
      },
    },
  },
  required: ["corrections"],
};

/**
 * 每次嘗試的輸出額度。2048 裝得下一張正常的替換表，但長會議或模型多話時 JSON 會被截斷，
 * 而「截斷」跟「暫時性 API 錯誤」在這裡長得一模一樣——都再打一次，第二次給雙倍額度。
 * 校正失敗是靜默的（退回原文、使用者不會知道），所以值得這一次重試的成本。
 */
const TOKEN_BUDGETS = [2048, 4096];

/**
 * 校正一份逐字稿。LLM 失敗不擋主流程——退回原文（記錄頁晚一點好，開天窗不行）。
 */
export async function correctTurns(
  turns: TranscriptTurn[],
  /** 不給就用 env 的 provider；bake-off 用來換模型矩陣。 */
  providerOverride?: AIProvider,
): Promise<{ turns: TranscriptTurn[]; corrections: Correction[] }> {
  let provider: AIProvider;
  try {
    provider = providerOverride ?? (await getProvider());
  } catch (e) {
    // 沒 key／provider 名字打錯——重試也是一樣的結果，直接退回原文
    console.error("[pipeline] 校正 pass 取不到 provider，退回原文", e);
    return { turns, corrections: [] };
  }

  const transcript = turns.map((t) => `${t.speaker ?? "發言"}：${t.text}`).join("\n");
  for (const maxTokens of TOKEN_BUDGETS) {
    try {
      const { corrections } = await provider.generateJSON<{ corrections: Correction[] }>({
        system: SYSTEM,
        user: transcript,
        schema: SCHEMA,
        schemaName: "transcript_corrections",
        maxTokens,
        effort: "minimal",
      });
      // 只留真的出現在逐字稿裡的替換
      const applicable = (corrections ?? []).filter((c) =>
        turns.some((t) => t.text.includes(c.from)),
      );
      return { turns: applyCorrections(turns, applicable), corrections: applicable };
    } catch (e) {
      console.error(`[pipeline] 校正 pass 失敗（maxTokens=${maxTokens}）`, e);
    }
  }
  return { turns, corrections: [] };
}
