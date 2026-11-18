/**
 * STT bake-off（issue #28）：一組音檔 ＋ 人工 reference → 一張有數字的表。
 *
 * 2026-08-12 的 Scribe 選型只驗過**一場**安靜會議室的理想錄音，判準是「讀起來對不對」，
 * 沒有任何數字。但 STT 是整條 pipeline 的天花板——聽錯了，校正與抽取只會把錯的東西
 * 整理得更整齊、更有說服力。這支的存在是為了回答兩個問題：
 * **哪一類場景會塌，以及塌的是文字還是講者。**
 *
 *   pnpm bakeoff:stt                      # 跑 bakeoff/cases/ 底下每一場 × 每一家
 *   pnpm bakeoff:stt --case far-field     # 只跑一場
 *   pnpm bakeoff:stt --engines scribe,scribe-v2
 *   pnpm bakeoff:stt --init far-field     # 產 reference 草稿給人改（見 cases/README.md）
 *   pnpm bakeoff:stt --fresh              # 不用快取，重打一次 API（要花錢）
 *   pnpm bakeoff:stt --no-correct         # 不跑校正 pass 的增益比較
 *
 * 產出：bakeoff/results/stt-summary.md（總表）＋ stt-<case>.md（每場的細節）
 * ＋ stt-<case>-<engine>.md（各家的完整逐字稿，可直接餵給 pnpm bakeoff:llm）。
 * 轉寫結果快取在 results/stt-cache/，改指標重算不用重打 API。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { correctTurns } from "../lib/pipeline/correct";
import type { TranscriptTurn } from "../lib/types";
import { loadEnvLocal } from "./env";
import { parseCase, type SttCase } from "./stt-case";
import { ENGINES, engineById, type Engine, type EngineResult } from "./stt-engines";
import { caseMd, summaryMd, type ReportCase, type ReportRun } from "./stt-report";
import { scoreTurns } from "./stt-score";
import { formatTranscriptMd, parseTranscriptMd } from "./transcript-md";

loadEnvLocal();

const CASES_DIR = path.join(import.meta.dirname, "cases");
const RESULTS_DIR = path.join(import.meta.dirname, "results");
const CACHE_DIR = path.join(RESULTS_DIR, "stt-cache");

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name: string) => argv.includes(`--${name}`);

// ── case 與音檔 ────────────────────────────────────────────────

function loadCases(onlyId?: string): SttCase[] {
  if (!fs.existsSync(CASES_DIR)) return [];
  return fs
    .readdirSync(CASES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .filter((d) => !onlyId || d.name === onlyId)
    .map((d) => {
      const file = path.join(CASES_DIR, d.name, "case.json");
      if (!fs.existsSync(file)) throw new Error(`case「${d.name}」缺 case.json`);
      return parseCase(d.name, JSON.parse(fs.readFileSync(file, "utf8")));
    });
}

function audioPath(c: SttCase): string {
  const raw = c.audio.startsWith("~") ? path.join(os.homedir(), c.audio.slice(1)) : c.audio;
  return path.isAbsolute(raw) ? raw : path.join(CASES_DIR, c.id, raw);
}

const CONTENT_TYPES: Record<string, string> = {
  ".m4a": "audio/mp4",
  ".mp4": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
};

// ── 轉寫（含快取）─────────────────────────────────────────────

type Cached = { signature: string; result: EngineResult };

/**
 * 快取的指紋 = 引擎那組參數 ＋ 音檔的大小與 mtime。
 * 只用 case id ＋ engine id 當鍵的話，換了參數或換了音檔都不會失效，
 * 會安安靜靜地拿舊稿算出「新設定」的分數——這種錯誤沒有任何跡象可以事後看出來。
 */
function signatureOf(c: SttCase, engine: Engine, file: string): string {
  const stat = fs.existsSync(file) ? fs.statSync(file) : null;
  return JSON.stringify({
    engine: engine.id,
    params: engine.signature({ filename: path.basename(file), terms: c.spec.terms ?? [], speakers: c.speakers }),
    audio: stat ? { size: stat.size, mtimeMs: Math.round(stat.mtimeMs) } : null,
  });
}

async function transcribeCached(c: SttCase, engine: Engine): Promise<EngineResult> {
  const cacheFile = path.join(CACHE_DIR, c.id, `${engine.id}.json`);
  const file = audioPath(c);
  const signature = signatureOf(c, engine, file);

  if (!has("fresh") && fs.existsSync(cacheFile)) {
    const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8")) as Cached;
    if (cached.signature === signature) return cached.result;
    // 音檔不見了就沒得比對——用舊稿但要講出來，別讓人以為這是這次跑出來的
    if (!fs.existsSync(file)) {
      console.warn(`\n    ⚠ 音檔不在了，沿用舊快取：${cacheFile}`);
      return cached.result;
    }
    console.warn(`\n    ⚠ 參數或音檔變了，重跑（舊快取作廢）`);
  }

  if (!fs.existsSync(file)) throw new Error(`音檔不存在：${file}`);
  const result = await engine.run({
    audio: fs.readFileSync(file),
    filename: path.basename(file),
    contentType: CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    terms: c.spec.terms ?? [],
    speakers: c.speakers,
  });
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify({ signature, result } satisfies Cached, null, 2));
  return result;
}

// ── 跑一場 × 一家 ─────────────────────────────────────────────

function referenceOf(c: SttCase): TranscriptTurn[] | null {
  const file = path.join(CASES_DIR, c.id, "reference.md");
  if (!fs.existsSync(file)) return null;
  const turns = parseTranscriptMd(fs.readFileSync(file, "utf8"));
  return turns.length > 0 ? turns : null;
}

/** reference 草稿是哪一家出的——那一家在講者與時間戳上系統性佔便宜，報表要標。 */
function referenceFrom(c: SttCase): string | undefined {
  const file = path.join(CASES_DIR, c.id, "reference.md");
  if (!fs.existsSync(file)) return undefined;
  const m = /草稿來自\s*([^\n]+?)\s*$/m.exec(fs.readFileSync(file, "utf8").slice(0, 500));
  return m?.[1];
}

async function runOne(c: SttCase, engine: Engine, reference: TranscriptTurn[] | null): Promise<ReportRun> {
  const run: ReportRun = { caseId: c.id, engine, ok: false };
  let result: EngineResult;
  try {
    result = await transcribeCached(c, engine);
  } catch (e) {
    run.error = e instanceof Error ? e.message : String(e);
    return run;
  }
  run.ok = true;
  run.elapsedMs = result.elapsedMs;
  run.turns = result.turns.length;

  // 各家的完整逐字稿留一份：人要讀，而且 pnpm bakeoff:llm 直接吃得下
  fs.writeFileSync(
    path.join(RESULTS_DIR, `stt-${c.id}-${engine.id}.md`),
    [`# ${engine.label}`, "", `- case：${c.id}（${c.scenario}）`, `- 講者數：${new Set(result.turns.map((t) => t.speaker)).size}`, "", formatTranscriptMd(result.turns), ""].join("\n"),
  );

  if (!reference) return run;

  const spec = { ...c.spec, audioSeconds: c.spec.audioSeconds ?? result.durationSeconds ?? undefined };
  run.score = scoreTurns(reference, result.turns, spec);

  if (!has("no-correct")) {
    try {
      const { turns, corrections } = await correctTurns(result.turns);
      run.corrected = { score: scoreTurns(reference, turns, spec), corrections };
    } catch (e) {
      console.error(`  （校正 pass 跳過：${e instanceof Error ? e.message : String(e)}）`);
    }
  }
  return run;
}

// ── reference 草稿 ────────────────────────────────────────────

/**
 * reference 不是從零打字，是拿引擎輸出來改——這是把這張票的人工成本壓到可承受的唯一辦法。
 * 草稿刻意寫成 reference.draft.md，改完自己改名成 reference.md，
 * 免得下一次 --init 把人改了兩小時的東西蓋掉。
 */
async function initReference(c: SttCase, engine: Engine): Promise<void> {
  const result = await transcribeCached(c, engine);
  const out = path.join(CASES_DIR, c.id, "reference.draft.md");
  fs.writeFileSync(
    out,
    [
      `<!-- ${c.id}｜${c.scenario}`,
      "     改法：一句一句聽著改，只改「聽錯的字」與「講者歸屬」，不要順稿、不要改說法。",
      "     切開段落時順手把時間戳改對——講者與時間戳的分數是拿這裡的數字算的。",
      "     改完把檔名改成 reference.md（--init 不會蓋掉 reference.md）。",
      `     草稿來自 ${engine.label} -->`,
      "",
      formatTranscriptMd(result.turns),
      "",
    ].join("\n"),
  );
  console.log(`草稿：${out}（${result.turns.length} 段，出自 ${engine.label}）`);
}

// ── main ──────────────────────────────────────────────────────

function toReportCase(c: SttCase): ReportCase {
  return {
    id: c.id,
    scenario: c.scenario,
    audio: path.basename(c.audio),
    notes: c.notes,
    terms: c.spec.terms?.length ?? 0,
    anchors: c.spec.anchors?.length ?? 0,
    silences: c.spec.silences?.length ?? 0,
    referenceFrom: referenceFrom(c),
  };
}

async function main(): Promise<void> {
  const initCase = flag("init");
  const cases = loadCases(flag("case") ?? initCase);
  if (cases.length === 0) {
    console.error(`沒有可跑的 case。在 ${CASES_DIR}/<id>/case.json 建一場，格式見 cases/README.md`);
    process.exit(1);
  }

  const engines = (flag("engines")?.split(",").map((s) => s.trim()) ?? []).map((id) => {
    const engine = engineById(id);
    if (!engine) throw new Error(`未知的引擎：${id}（可用：${ENGINES.map((e) => e.id).join("、")}）`);
    return engine;
  });
  const matrix = engines.length > 0 ? engines : ENGINES;

  if (initCase) {
    const c = cases.find((x) => x.id === initCase);
    if (!c) throw new Error(`找不到 case：${initCase}`);
    await initReference(c, matrix[0]);
    return;
  }

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const runs: ReportRun[] = [];

  for (const c of cases) {
    const reference = referenceOf(c);
    console.log(`\n${c.id}（${c.scenario}）${reference ? "" : "  ⚠ 沒有 reference.md，只轉寫不評分"}`);
    for (const engine of matrix) {
      // 講者數提示要有人數才有意義，沒填就別浪費一次轉寫費
      if (engine.id === "scribe-speakers" && !c.speakers) {
        console.log(`  ⤳ ${engine.label}  跳過（case.json 沒填 speakers）`);
        continue;
      }
      if (!process.env[engine.envKey]) {
        console.log(`  ⤳ ${engine.label}  跳過（缺 ${engine.envKey}）`);
        continue;
      }
      process.stdout.write(`  ▸ ${engine.label} … `);
      const r = await runOne(c, engine, reference);
      runs.push(r);
      console.log(
        !r.ok
          ? `✗ ${r.error}`
          : r.score
            ? `✓ CER ${(r.score.text.cer * 100).toFixed(1)}%、詞表 ${(r.score.terms.recall * 100).toFixed(0)}%、講者 ${r.score.speakers.hypSpeakers}/${r.score.speakers.refSpeakers}`
            : `✓ ${r.turns} 段（未評分）`,
      );
    }
    fs.writeFileSync(
      path.join(RESULTS_DIR, `stt-${c.id}.md`),
      caseMd(toReportCase(c), runs.filter((r) => r.caseId === c.id)),
    );
  }

  const out = path.join(RESULTS_DIR, "stt-summary.md");
  fs.writeFileSync(out, summaryMd(cases.map(toReportCase), runs, new Date().toISOString().slice(0, 10)));
  console.log(`\n總表：${out}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
