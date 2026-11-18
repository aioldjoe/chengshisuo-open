/**
 * LLM bake-off：Gemini vs Grok，跑的是 pipeline 裡「真的」那兩支 prompt
 * （校正 correctTurns、重點抽取 extractSummary），餵同一份真實逐字稿，
 * 比每一場的成本、耗時、輸出形狀。品質最後還是要人看輸出 md 判斷——
 * 這支只負責把「看得到的差異」擺在同一張表上。
 *
 *   pnpm bakeoff:llm path/to/transcript.md # 指定一份逐字稿
 *   pnpm bakeoff:llm                       # 不指定就撿 results/ 裡最新的一份 STT 產出
 *   BAKEOFF_MODELS=google:gemini-2.5-flash-lite,grok:grok-4.3 pnpm bakeoff:llm
 *
 * 需要 .env.local 有 GEMINI_API_KEY 與 XAI_API_KEY（缺哪家就跳過哪家）。
 * 產出：bakeoff/results/llm-summary.md（總表）＋ llm-<model>.md（各家完整輸出）。
 */

import fs from "node:fs";
import path from "node:path";

import { createProvider, type AIProvider } from "../lib/ai/provider";
import { loadEnvLocal } from "./env";
import { correctTurns } from "../lib/pipeline/correct";
import { extractSummary } from "../lib/pipeline/extract";
import type { MeetingSummary, TranscriptTurn } from "../lib/types";
import { parseTranscriptMd } from "./transcript-md";

loadEnvLocal();

/**
 * 牌價（USD／百萬 token），2026-08-16 查自官方定價頁；改價自己更新這張表。
 *   Gemini：https://ai.google.dev/gemini-api/docs/pricing
 *   xAI：   https://docs.x.ai/docs/models
 * 注意 grok-4-fast／grok-4.1-fast 已於 2026-05-15 退役，會被靜默轉到 grok-4.3 計費，別列。
 */
const PRICE: Record<string, { input: number; output: number }> = {
  // gemini-2.5-* 對新帳號已停開（generateContent 404），牌價留著但矩陣不列
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5 },
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "gemini-3.5-flash": { input: 1.5, output: 9.0 },
  "gemini-3.6-flash": { input: 0.75, output: 3.75 },
  "gemini-3.7-flash": { input: 0.75, output: 3.75 },
  "grok-4.3": { input: 1.25, output: 2.5 },
  "grok-build-0.1": { input: 1.0, output: 2.0 },
  "grok-4.6": { input: 2.0, output: 6.0 },
};

/** 預設矩陣：兩家各自「flash 等級」的候選。 */
const DEFAULT_MODELS = [
  "google:gemini-3.1-flash-lite",
  "google:gemini-3.5-flash-lite",
  "google:gemini-3.6-flash",
  "google:gemini-3.7-flash",
  "grok:grok-4.3",
];

const RESULTS_DIR = path.join(import.meta.dirname, "results");

/**
 * 沒指定就撿 results/ 裡最新的一份 STT 逐字稿（stt-<case>-<engine>.md，或 2026-08-12 留下的
 * elevenlabs.md）。這支要的只是「一份夠真實的稿子」，哪一場都行。
 */
function latestTranscript(): string {
  if (!fs.existsSync(RESULTS_DIR)) return path.join(RESULTS_DIR, "elevenlabs.md");
  const candidates = fs
    .readdirSync(RESULTS_DIR)
    .filter((f) => (f.startsWith("stt-") || f === "elevenlabs.md") && f.endsWith(".md"))
    .filter((f) => !f.startsWith("stt-summary"))
    .map((f) => ({ f, at: fs.statSync(path.join(RESULTS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  return path.join(RESULTS_DIR, candidates[0]?.f ?? "elevenlabs.md");
}

const TRANSCRIPT = process.argv[2] ?? latestTranscript();

type Run = {
  id: string;
  provider: string;
  model: string;
  ok: boolean;
  error?: string;
  correctMs: number;
  extractMs: number;
  usage: { input: number; output: number };
  costUsd: number | null;
  corrections: number;
  shape: { highlights: number; decisions: number; todos: number; commitments: number; sections: number };
  summary?: MeetingSummary;
  correctionsList?: { from: string; to: string }[];
};

function cost(model: string, usage: { input: number; output: number }): number | null {
  const p = PRICE[model];
  if (!p) return null;
  return (usage.input * p.input + usage.output * p.output) / 1_000_000;
}

async function runOne(spec: string, turns: TranscriptTurn[]): Promise<Run> {
  const [providerName, model] = spec.split(":");
  const base: Run = {
    id: spec,
    provider: providerName,
    model,
    ok: false,
    correctMs: 0,
    extractMs: 0,
    usage: { input: 0, output: 0 },
    costUsd: null,
    corrections: 0,
    shape: { highlights: 0, decisions: 0, todos: 0, commitments: 0, sections: 0 },
  };

  let provider: AIProvider;
  try {
    provider = await createProvider(providerName, model);
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e) };
  }

  const add = () => {
    if (provider.lastUsage) {
      base.usage.input += provider.lastUsage.input;
      base.usage.output += provider.lastUsage.output;
      provider.lastUsage = undefined;
    }
  };

  try {
    let t = Date.now();
    // correctTurns 內部會吞錯退回原文，這裡要看得出它有沒有失敗——用 corrections 數與 usage 判斷
    const corrected = await correctTurns(turns, provider);
    base.correctMs = Date.now() - t;
    add();
    base.corrections = corrected.corrections.length;
    base.correctionsList = corrected.corrections;

    t = Date.now();
    const summary = await extractSummary(corrected.turns, provider);
    base.extractMs = Date.now() - t;
    add();

    base.summary = summary;
    base.shape = {
      highlights: summary.highlights.length,
      decisions: summary.decisions.length,
      todos: summary.todos.length,
      commitments: summary.commitments.length,
      sections: summary.sections.length,
    };
    base.costUsd = cost(model, base.usage);
    base.ok = true;
  } catch (e) {
    base.error = e instanceof Error ? e.message : String(e);
  }
  return base;
}

function fmtUsd(v: number | null): string {
  return v === null ? "（無牌價）" : `$${v.toFixed(4)}`;
}

function summaryMd(runs: Run[], turnCount: number, chars: number): string {
  const lines = [
    "# LLM bake-off：Gemini vs Grok",
    "",
    `- 逐字稿：${path.basename(TRANSCRIPT)}（${turnCount} 段、${chars} 字）`,
    `- 跑的是 pipeline 真 prompt：correctTurns → extractSummary`,
    `- 日期：${new Date().toISOString().slice(0, 10)}；牌價見 bakeoff/llm.ts 的 PRICE 表`,
    "",
    "| 模型 | 狀態 | 校正 | 抽取 | in/out tokens | 每場成本 | 校正數 | 重點/決議/待辦/承諾/議題 |",
    "|---|---|---:|---:|---:|---:|---:|---|",
  ];
  for (const r of runs) {
    const s = r.shape;
    lines.push(
      `| ${r.id} | ${r.ok ? "✓" : "✗ " + (r.error ?? "").slice(0, 60)} | ${(r.correctMs / 1000).toFixed(1)}s | ${(r.extractMs / 1000).toFixed(1)}s | ${r.usage.input}/${r.usage.output} | ${fmtUsd(r.costUsd)} | ${r.corrections} | ${s.highlights}/${s.decisions}/${s.todos}/${s.commitments}/${s.sections} |`,
    );
  }
  lines.push(
    "",
    "## 怎麼讀",
    "",
    "- **每場成本**是這份逐字稿實際用量 × 牌價。一小時會議大約是這份的 N 倍，等比放大即可。",
    "- **校正數**高不代表好——要打開各家的 llm-<model>.md 看它改了什麼，改對才算數。",
    "- **形狀欄**看的是「有沒有抽出東西」與「有沒有亂補」；同一份逐字稿各家數量差太多就要人工比對。",
    "- 判品質請直接看各家的完整輸出：重點寫得像不像人講的、承諾有沒有綁對講者、議題有沒有切對。",
    "",
  );
  return lines.join("\n");
}

function detailMd(r: Run): string {
  const lines = [`# ${r.id}`, ""];
  if (!r.ok) {
    lines.push(`失敗：${r.error}`);
    return lines.join("\n");
  }
  lines.push(
    `- 校正 ${(r.correctMs / 1000).toFixed(1)}s ／ 抽取 ${(r.extractMs / 1000).toFixed(1)}s`,
    `- tokens in/out：${r.usage.input}/${r.usage.output}；每場成本 ${fmtUsd(r.costUsd)}`,
    "",
    "## 校正表",
    "",
  );
  if (!r.correctionsList?.length) lines.push("（無）");
  for (const c of r.correctionsList ?? []) lines.push(`- ${c.from} → ${c.to}`);
  const s = r.summary!;
  lines.push("", `## ${s.title}`, "", "### 重點", "");
  for (const h of s.highlights) lines.push(`- ${h}`);
  lines.push("", "### 決議", "");
  for (const d of s.decisions) lines.push(`- ${d}`);
  lines.push("", "### 待辦", "");
  for (const t of s.todos) lines.push(`- ${t.task}（${t.owner ?? "未指定"}${t.due ? "，" + t.due : ""}）`);
  lines.push("", "### 承諾追蹤", "");
  for (const c of s.commitments) lines.push(`- ${c.who}：${c.what}${c.due ? "（" + c.due + "）" : ""}`);
  lines.push("", "### 議題分段", "");
  for (const sec of s.sections) {
    lines.push(`#### ${sec.title}`, "");
    for (const p of sec.points) lines.push(`- ${p}`);
    lines.push("");
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  if (!fs.existsSync(TRANSCRIPT)) {
    console.error(`找不到逐字稿：${TRANSCRIPT}`);
    console.error("先跑 pnpm bakeoff:stt 產出 results/stt-<case>-<engine>.md，或指定一份同格式的 md。");
    process.exit(1);
  }
  const md = fs.readFileSync(TRANSCRIPT, "utf8");
  const turns = parseTranscriptMd(md);
  if (turns.length === 0) {
    console.error("逐字稿解析不出任何段落——格式要是 **[mm:ss] 講者 X**：文字");
    process.exit(1);
  }
  const chars = turns.reduce((n, t) => n + t.text.length, 0);

  const specs = (process.env.BAKEOFF_MODELS ?? DEFAULT_MODELS.join(",")).split(",").map((s) => s.trim());
  const skip = (p: string) =>
    (p === "google" && !process.env.GEMINI_API_KEY) || (p === "grok" && !process.env.XAI_API_KEY);

  console.log(`逐字稿 ${turns.length} 段、${chars} 字；模型 ${specs.length} 個\n`);
  const runs: Run[] = [];
  for (const spec of specs) {
    const [p] = spec.split(":");
    if (skip(p)) {
      console.log(`  ⤳ ${spec}  跳過（缺 ${p === "google" ? "GEMINI_API_KEY" : "XAI_API_KEY"}）`);
      continue;
    }
    process.stdout.write(`  ▸ ${spec} … `);
    const r = await runOne(spec, turns);
    runs.push(r);
    console.log(
      r.ok
        ? `✓ ${((r.correctMs + r.extractMs) / 1000).toFixed(1)}s  ${fmtUsd(r.costUsd)}  ${r.usage.input}/${r.usage.output}`
        : `✗ ${r.error}`,
    );
    fs.writeFileSync(path.join(RESULTS_DIR, `llm-${r.model}.md`), detailMd(r));
  }

  const out = path.join(RESULTS_DIR, "llm-summary.md");
  fs.writeFileSync(out, summaryMd(runs, turns.length, chars));
  console.log(`\n總表：${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
