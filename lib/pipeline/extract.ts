import { getProvider, type AIProvider } from "../ai/provider";
import { normalizeSummary } from "./summary-normalize";
import type { MeetingSummary, TranscriptTurn } from "../types";

/**
 * 重點抽取——pipeline 第三段。prompt 移植自先前專案的 summarize，
 * 客群放寬為台灣商務會議，加上承諾追蹤（記錄頁「重點區」的差異化欄位）。
 */

const SYSTEM = `你是專業的會議記錄助理，服務台灣的商務工作者。
讀完繁體中文（可能中英夾雜）的會議逐字稿後，輸出一份結構化紀要，**只回傳 JSON**，格式如下：
{
  "title": "具體會議主題（務必依實際內容推斷，例如『冰水主機能效改善檢討會』；25 字內繁體中文）",
  "sections": [
    {
      "title": "該議題小標題（繁體中文）",
      "points": ["此議題的討論重點，每點一句"],
      "decisions": ["此議題做成的決議，無則空陣列"],
      "todos": [{ "task": "待辦/行動項", "owner": "負責人或講者標籤，無法判斷填 null", "due": "期限字串如『本週五前』，無則 null" }]
    }
  ],
  "highlights": ["全場彙總重點（跨議題總覽）"],
  "decisions": ["全場彙總決議"],
  "todos": [{ "task": "全場彙總待辦", "owner": "…或 null", "due": "…或 null" }],
  "commitments": [{ "who": "承諾人（講者標籤或名字）", "what": "親口承諾的事", "due": "期限或 null" }]
}
規則：
- 依會議的議題／agenda 把內容切成多段 sections，一個議題一段；長會議請確實拆成多段，不要全部塞進一段。短會議至少 1 段。
- title 必須是能看出「談了什麼」的具體主題；**嚴禁**退回「會議紀要」「會議記錄」這類通用詞。
- commitments 是「承諾追蹤」：只收會中有人**親口承諾**的事（「我會…」「我來處理」「我下週給你」），一定綁定說話人；與 todos 的差別是 todos 可以是被指派或推斷的行動項。
- sections 是各議題細節；highlights／decisions／todos 是整場的彙總總覽——兩邊都要填。
- 忠於逐字稿、不杜撰；沒有決議或待辦時給空陣列；一律使用繁體中文。
- 密集長會議請完整涵蓋重要內容，數量不設硬上限，寧詳勿漏。`;

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    sections: { type: "array" },
    highlights: { type: "array", items: { type: "string" } },
    decisions: { type: "array", items: { type: "string" } },
    todos: { type: "array" },
    commitments: { type: "array" },
  },
  required: ["title", "sections", "highlights", "decisions", "todos", "commitments"],
};

export function transcriptText(turns: TranscriptTurn[]): string {
  return turns.map((t) => `${t.speaker ?? "發言"}：${t.text}`).join("\n");
}

export async function extractSummary(
  turns: TranscriptTurn[],
  providerOverride?: AIProvider,
): Promise<MeetingSummary> {
  const provider = providerOverride ?? (await getProvider());
  const raw = await provider.generateJSON<unknown>({
    system: SYSTEM,
    user: transcriptText(turns),
    schema: SCHEMA,
    schemaName: "meeting_summary",
    maxTokens: 8192,
    effort: "low",
  });
  return normalizeSummary(raw);
}
