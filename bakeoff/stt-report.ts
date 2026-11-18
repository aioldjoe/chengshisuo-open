/**
 * STT bake-off 的報表（issue #28）。純函式：吃跑完的結果，吐 markdown。
 *
 * 這兩張表就是「選型決策實際會看的東西」，所以每個數字旁邊都要有讀法——
 * 一個沒有讀法的數字比沒有數字更危險，它會被當成結論引用。
 */

import { fmtTime } from "../lib/format";
import type { Score } from "./stt-score";

export type ReportEngine = {
  id: string;
  label: string;
  /** 這組不能跟別組並排比較的理由（例如詞表提示拿的就是評分答案）。 */
  caveat?: string;
};

export type ReportCase = {
  id: string;
  scenario: string;
  audio: string;
  notes?: string;
  terms: number;
  anchors: number;
  silences: number;
  /** reference 的時間戳是哪一家出的草稿——講者與時間戳的數字對那一家有利。 */
  referenceFrom?: string;
};

export type ReportRun = {
  caseId: string;
  engine: ReportEngine;
  ok: boolean;
  error?: string;
  elapsedMs?: number;
  turns?: number;
  score?: Score;
  corrected?: { score: Score; corrections: { from: string; to: string }[] };
};

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export function summaryMd(cases: ReportCase[], runs: ReportRun[], today: string): string {
  const lines = [
    "# STT bake-off",
    "",
    `- 日期：${today}`,
    `- 場次 ${cases.length}、引擎 ${new Set(runs.map((r) => r.engine.id)).size}`,
    "- 指標定義與人工標註的做法見 bakeoff/cases/README.md",
    "",
    "| 場景 | case | 引擎 | CER | 長度比 | 詞表召回 | 講者數 | 輪替 | 邊界誤差 | 亂切 | 歸屬 | 空檔補字 | 重複 | 耗時 |",
    "|---|---|---|---:|---:|---:|:---:|---:|---:|---:|---:|---:|---:|---:|",
  ];

  const blank = "| | | | | | | | | | |";
  for (const c of cases) {
    for (const r of runs.filter((x) => x.caseId === c.id)) {
      const head = `| ${c.scenario} | ${c.id} | ${r.engine.label}${r.engine.caveat ? " ※" : ""}`;
      const el = `${((r.elapsedMs ?? 0) / 1000).toFixed(0)}s`;
      if (!r.ok) {
        lines.push(`${head} | ✗ ${(r.error ?? "").slice(0, 60)} ${blank} |`);
        continue;
      }
      const s = r.score;
      if (!s) {
        lines.push(`${head} | （缺 reference，未評分） ${blank.slice(0, -2)} ${el} |`);
        continue;
      }
      const b = s.speakers.boundary;
      lines.push(
        [
          head,
          pct(s.text.cer),
          s.text.lenRatio.toFixed(2),
          `${pct(s.terms.recall)}（${s.terms.found}/${s.terms.total}）`,
          `${s.speakers.hypSpeakers}/${s.speakers.refSpeakers}${s.speakers.hypSpeakers === s.speakers.refSpeakers ? " ✓" : " ✗"}`,
          `${b.hypBoundaries}/${b.refBoundaries}`,
          `${b.meanErrorS.toFixed(1)}s`,
          pct(b.spuriousRatio),
          pct(s.speakers.attribution.accuracy),
          `${s.silence.chars} 字`,
          s.repetition.maxRepeats > 1 ? `×${s.repetition.maxRepeats}` : "—",
          `${el} |`,
        ].join(" | "),
      );
    }
  }

  const caveats = [...new Map(runs.filter((r) => r.engine.caveat).map((r) => [r.engine.id, r.engine])).values()];
  if (caveats.length > 0) {
    lines.push("");
    for (const e of caveats) lines.push(`※ **${e.label}**：${e.caveat}`);
  }

  const scored = runs.filter((r) => r.score && r.corrected);
  if (scored.length > 0) {
    lines.push(
      "",
      "## 校正 pass 的增益",
      "",
      "同一份稿子，校正前 / 校正後。第一次能回答「那筆 token 值不值」——",
      "CER 幾乎不動是正常的（校正只換詞不重寫），**要看的是詞表召回率補回多少**。",
      "**CER 變差就是警訊**：那代表校正動到了不該動的地方（改說法、或替換到錯的目標詞），",
      "打開 stt-<case>.md 看它到底改了什麼——界線見 lib/pipeline/correct.ts。",
      "",
      "| case | 引擎 | CER 前 | CER 後 | 詞表召回 前 | 後 | 替換條數 |",
      "|---|---|---:|---:|---:|---:|---:|",
    );
    for (const r of scored) {
      lines.push(
        `| ${r.caseId} | ${r.engine.label} | ${pct(r.score!.text.cer)} | ${pct(r.corrected!.score.text.cer)} | ${pct(r.score!.terms.recall)} | ${pct(r.corrected!.score.terms.recall)} | ${r.corrected!.corrections.length} |`,
      );
    }
  }

  lines.push(
    "",
    "## 怎麼讀",
    "",
    "- **CER** 是字元錯誤率（繁中不用 WER，中文沒有詞邊界）。標點、空白、英文大小寫不算錯。",
    "  補的字比原文還多時會超過 100%——那不是算錯，是那一段被塞了原文沒有的東西。",
    "- **長度比** > 1 是補字（幻覺的宏觀跡象），< 1 是漏字。塌在哪一段看 stt-<case>.md 的逐段表。",
    "- **詞表召回**比 CER 更貼近產品：CER 5% 但把公司名全聽錯的稿子是廢的。",
    "- **講者數**寫成 hyp/ref。分離錯比聽錯貴——校正 pass 完全不碰它，而記錄頁的說話人命名",
    "  會把錯的歸屬固化成真名（#23）。",
    "- **輪替**是講者切換次數 hyp/ref，**亂切**是附近沒有任何 ref 邊界的 hyp 邊界佔比。",
    "  **邊界誤差要跟這兩欄一起讀**：每兩秒亂切一刀的分離，邊界誤差會漂亮地接近 0 秒。",
    "- **空檔補字**是人工標的無語音區間裡冒出來的字——這是幻覺最危險的形態，句子完全通順。",
    "",
    "### 這張表不能回答的事",
    "",
    "- **reference 的時間戳是引擎給的**（人工校對是改草稿，不是重新計時），所以**出草稿的那一家",
    "  在講者邊界與歸屬上系統性佔便宜**。跨引擎比這幾欄時，要嘛都用同一家出的草稿當基準、",
    "  只看相對差距，要嘛人工把切開的段落重新計時。文字類指標（CER、詞表）不受影響。",
    "- 邊界與歸屬是簡化版，**不是完整 DER**：不算重疊發言、不算 false alarm。",
    "- 逐段 CER 的段落邊界是用時間內插切的，邊緣會溢出一兩個字——那是粗略定位，不是精確分數。",
    "",
  );
  return lines.join("\n");
}

export function caseMd(c: ReportCase, runs: ReportRun[]): string {
  const lines = [`# ${c.id}｜${c.scenario}`, "", `- 音檔：${c.audio}`];
  if (c.notes) lines.push(`- 備註：${c.notes}`);
  lines.push(`- 詞表 ${c.terms} 個、時間錨點 ${c.anchors} 個、無語音區間 ${c.silences} 段`);
  if (c.referenceFrom) {
    lines.push(`- reference 草稿出自 **${c.referenceFrom}**——時間戳是那一家的，講者與時間戳的數字對它有利`);
  }
  lines.push("");

  for (const r of runs) {
    lines.push(`## ${r.engine.label}`, "");
    if (r.engine.caveat) lines.push(`> ※ ${r.engine.caveat}`, "");
    if (!r.ok) {
      lines.push(`失敗：${r.error}`, "");
      continue;
    }
    if (!r.score) {
      lines.push(`（這場還沒有 reference.md，只有 ${r.turns ?? 0} 段轉寫結果，沒有分數）`, "");
      continue;
    }
    const s = r.score;
    const b = s.speakers.boundary;
    lines.push(
      `- CER ${pct(s.text.cer)}（編輯距離 ${s.text.distance} ／ reference ${s.text.refLen} 字、長度比 ${s.text.lenRatio.toFixed(2)}）`,
      `- 講者數 hyp ${s.speakers.hypSpeakers} vs ref ${s.speakers.refSpeakers}；輪替 ${b.hypBoundaries}/${b.refBoundaries} 次，其中亂切 ${pct(b.spuriousRatio)}`,
      `- 邊界誤差 平均 ${b.meanErrorS.toFixed(1)}s／中位數 ${b.medianErrorS.toFixed(1)}s；1 秒內 ${pct(b.within1sRatio)}`,
      `- 逐秒歸屬正確率 ${pct(s.speakers.attribution.accuracy)}`,
      "",
      "### 專有名詞",
      "",
    );
    if (s.terms.terms.length === 0) lines.push("- （case.json 沒填 terms）");
    for (const t of s.terms.terms) {
      const variants = t.variants.map((v) => `${v.text}×${v.count}`).join("、");
      const tail = variants
        ? `；被聽成 ${t.variants.length} 種寫法（${variants}）`
        : t.hits
          ? ""
          : "；連近似的都找不到——被聽成完全另一個詞，校正 pass 也救不回來";
      lines.push(`- **${t.term}**：命中 ${t.hits} 次${tail}`);
    }

    const worst = [...s.segments].sort((a, b2) => b2.cer - a.cer).slice(0, 3).filter((x) => x.cer > 0);
    if (worst.length > 0) {
      lines.push("", "### 塌得最兇的三段（粗略定位）", "");
      for (const w of worst) {
        lines.push(
          `- **[${fmtTime(w.start)}] ${w.speaker ?? "發言"}** CER ${pct(w.cer)}`,
          `  - 應該是：${w.text}`,
          `  - 聽成了：${w.hypText || "（整段沒有東西）"}`,
        );
      }
    }

    if (s.anchors.checked > 0) {
      lines.push(
        "",
        "### 時間戳",
        "",
        `- 錨點 ${s.anchors.found}/${s.anchors.checked} 找得到；平均誤差 ${s.anchors.meanErrorS.toFixed(1)}s、最大 ${s.anchors.maxErrorS.toFixed(1)}s`,
      );
      if (s.anchors.missing.length) lines.push(`- 找不到：${s.anchors.missing.join("、")}`);
    }

    if (c.silences > 0) {
      lines.push("", "### 無語音段落", "");
      if (s.silence.turns.length === 0) lines.push("- 沒有補字 ✓");
      else lines.push("（逐字時間是內插估的，區間邊緣會溢出一兩個字；要看的是整句級的憑空補字）", "");
      for (const t of s.silence.turns) lines.push(`- [${fmtTime(t.at)}] ${t.text}`);
    }

    if (s.repetition.maxRepeats > 1) {
      lines.push(
        "",
        "### 重複迴圈",
        "",
        `- 「${s.repetition.sample}」連續出現 ${s.repetition.maxRepeats} 次`,
      );
    }

    if (r.corrected) {
      lines.push(
        "",
        "### 校正 pass 之後",
        "",
        `- CER ${pct(s.text.cer)} → ${pct(r.corrected.score.text.cer)}`,
        `- 詞表召回 ${pct(s.terms.recall)} → ${pct(r.corrected.score.terms.recall)}`,
        "",
        "替換表（**改了說法就是越界**，界線見 lib/pipeline/correct.ts）：",
        "",
      );
      if (r.corrected.corrections.length === 0) lines.push("- （無）");
      for (const c2 of r.corrected.corrections) lines.push(`- ${c2.from} → ${c2.to}`);
    }
    lines.push("");
  }
  return lines.join("\n") + "\n";
}
