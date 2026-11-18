import type { TranscriptTurn } from "../lib/types";

/**
 * STT bake-off 的評分（issue #28）。全部是純函式：吃 reference 與 hypothesis，吐數字。
 * 為什麼要有這一層：2026-08-12 的選型只看「讀起來對不對」，沒有任何數字，
 * 於是「吵一點會不會塌」「換一家會不會比較好」只能用印象回答。
 *
 * 繁中用 CER（字元）不是 WER——中文沒有詞邊界，斷詞本身就會引入誤差。
 */

/**
 * 比對前的正規化：標點、空白、全形都不算錯。
 * reference 是人改引擎輸出改出來的，人不會去統一標點，這些差異算進去只是噪音。
 * 英文一律小寫（Scribe 的大小寫不穩，但那不影響讀者理解）。
 */
export function normalizeForCompare(text: string): string {
  return Array.from(text.normalize("NFKC").toLowerCase())
    .filter((ch) => /[\p{Script=Han}\p{Letter}\p{Number}]/u.test(ch))
    .join("");
}

/**
 * 估算用的說話速度（字／秒）。只在「段落沒有下一段可以定尾巴」時當退路，
 * 中文口語大約 4–5 字／秒；估錯一兩秒不影響結論，我們要抓的是差十秒那種。
 */
const CHARS_PER_SECOND = 4.5;

export type CerResult = {
  /** 編輯距離 ÷ reference 長度；reference 為空時回 0。 */
  cer: number;
  distance: number;
  refLen: number;
  hypLen: number;
  /**
   * hypLen ÷ refLen。> 1 是補字（幻覺的宏觀跡象），< 1 是漏字。
   * 沒做 sub/ins/del 拆解是刻意的：那要留整張 DP 矩陣，長會議會吃掉幾百 MB，
   * 而這個比值已經回答了「錯在多寫還是少寫」。
   */
  lenRatio: number;
};

/** Levenshtein，兩列滾動（O(n) 記憶體，長會議也撐得住）。 */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Uint32Array(b.length + 1);
  let cur = new Uint32Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    const ca = a[i - 1];
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

export function cer(reference: string, hypothesis: string): CerResult {
  const ref = normalizeForCompare(reference);
  const hyp = normalizeForCompare(hypothesis);
  const distance = editDistance(ref, hyp);
  return {
    cer: ref.length === 0 ? 0 : distance / ref.length,
    distance,
    refLen: ref.length,
    hypLen: hyp.length,
    lenRatio: ref.length === 0 ? 0 : hyp.length / ref.length,
  };
}

export type TermResult = {
  term: string;
  /** 逐字命中的次數。 */
  hits: number;
  /** 聽錯成別的寫法的近似字串（已正規化）。有幾條，校正表就要補幾條。 */
  variants: { text: string; count: number }[];
};

/**
 * 一個詞可以錯得多離譜還算「同一個詞聽錯」。0.4 是照著已知案例定的：
 * 「一次側變流量」→「一次測電流量」（6 字錯 2）、「IPLV」→「IPOV」（4 字錯 2）都要抓得到，
 * 再鬆下去就會把不相干的詞湊進來。錯超過這個界線的詞不列變體——
 * 那代表它被聽成完全另一個詞，校正 pass 也救不回來，這件事本身就是結論。
 */
const VARIANT_TOLERANCE = 0.4;

/**
 * 短於這個長度的詞不找變體，只認逐字命中。
 * 兩個字的詞容錯一個字，「台積」就會把台北／台大／台南全收進來——
 * 而 README 說「有幾條變體，校正表就要補幾條」，照做等於寫出「台→台積」這種毀稿替換。
 */
const MIN_VARIANT_TERM_LENGTH = 3;

/**
 * 專有名詞召回率。這條比 CER 更貼近產品：
 * 一份 CER 5% 但把公司名全聽錯的稿子是廢的。
 */
export function termRecall(
  terms: string[],
  hypothesis: string,
): { recall: number; found: number; total: number; terms: TermResult[] } {
  const hyp = normalizeForCompare(hypothesis);
  const results = terms.map((term) => scanTerm(term, hyp));
  const found = results.filter((r) => r.hits > 0).length;
  return {
    recall: results.length === 0 ? 1 : found / results.length,
    found,
    total: results.length,
    terms: results,
  };
}

/**
 * 掃出所有落在容錯內的窗口，再由「錯得最少」優先挑不重疊的。
 * 不能單純由左而右貪心：「那個 IPOV」從「個」開始也在容錯內，
 * 先挑到它就會把變體記成「個ipov」，錯誤發散度的統計就髒了。
 */
function scanTerm(term: string, hyp: string): TermResult {
  const t = normalizeForCompare(term);
  const result: TermResult = { term, hits: 0, variants: [] };
  if (t.length === 0) return result;

  const tolerance =
    t.length < MIN_VARIANT_TERM_LENGTH ? 0 : Math.max(1, Math.round(t.length * VARIANT_TOLERANCE));
  const minLen = Math.max(1, t.length - tolerance);
  const maxLen = t.length + tolerance;

  const candidates: { at: number; len: number; distance: number }[] = [];
  for (let i = 0; i < hyp.length; i++) {
    for (let len = minLen; len <= maxLen && i + len <= hyp.length; len++) {
      const d = editDistance(t, hyp.slice(i, i + len));
      if (d <= tolerance) candidates.push({ at: i, len, distance: d });
      if (d === 0) break;
    }
  }
  candidates.sort((a, b) => a.distance - b.distance || a.at - b.at || a.len - b.len);

  const taken = new Uint8Array(hyp.length);
  const counts = new Map<string, number>();
  for (const c of candidates) {
    let overlaps = false;
    for (let i = c.at; i < c.at + c.len; i++) if (taken[i]) overlaps = true;
    if (overlaps) continue;
    taken.fill(1, c.at, c.at + c.len);
    if (c.distance === 0) result.hits++;
    else {
      const text = hyp.slice(c.at, c.at + c.len);
      counts.set(text, (counts.get(text) ?? 0) + 1);
    }
  }

  result.variants = [...counts]
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
  return result;
}

export type SpeakerMetrics = {
  refSpeakers: number;
  hypSpeakers: number;
  boundary: {
    /** reference 上的講者輪替次數。 */
    refBoundaries: number;
    /** hyp 切出來的輪替次數。跟 ref 差太多，下面那幾個數字就別單獨讀。 */
    hypBoundaries: number;
    /** 每個 ref 邊界配到最近的 hyp 邊界，取誤差的平均與中位數（秒）。 */
    meanErrorS: number;
    medianErrorS: number;
    /** 誤差在 1 秒內的比例——記錄頁的跳播點準不準看這個。 */
    within1sRatio: number;
    /**
     * 多切出來的刀：附近（1 秒內）沒有任何 ref 邊界的 hyp 邊界佔比。
     * 只算 ref→hyp 那個方向會被騙——每兩秒亂切一刀的分離，每個 ref 邊界附近都剛好有一刀，
     * 誤差會漂亮地等於 0 秒，而插話搶話正是最會這樣塌的那一類。
     */
    spuriousRatio: number;
  };
  attribution: {
    /**
     * 逐秒歸屬正確率（簡化版，不是完整 DER：不算重疊發言、不算 false alarm）。
     * 要先把標籤對映過去才算——speaker_0 / 講者 A 只是代號，A 跟 B 對調不是錯。
     */
    accuracy: number;
    /** hyp 標籤 → ref 標籤的對映。 */
    mapping: Record<string, string>;
  };
};

/** 講者切換的時間點（第一段的起點不算切換）。 */
function boundaries(turns: TranscriptTurn[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < turns.length; i++) {
    if (turns[i].speaker !== turns[i - 1].speaker) out.push(turns[i].start);
  }
  return out;
}

/** 逐秒的講者標籤；一段發言算到下一段開始為止。 */
function timeline(turns: TranscriptTurn[], endSeconds: number): (string | null)[] {
  const line: (string | null)[] = new Array(Math.max(0, Math.ceil(endSeconds))).fill(null);
  for (let i = 0; i < turns.length; i++) {
    const from = Math.max(0, Math.floor(turns[i].start));
    const to = Math.min(line.length, Math.floor(turns[i + 1]?.start ?? endSeconds));
    for (let s = from; s < to; s++) line[s] = turns[i].speaker;
  }
  return line;
}

export function speakerMetrics(
  refTurns: TranscriptTurn[],
  hypTurns: TranscriptTurn[],
  /** 音檔長度；不給就用最後一段的起點＋1（尾巴少算，只影響 accuracy 的分母）。 */
  endSeconds?: number,
): SpeakerMetrics {
  const end =
    endSeconds ?? Math.max(refTurns.at(-1)?.start ?? 0, hypTurns.at(-1)?.start ?? 0) + 1;

  const refB = boundaries(refTurns);
  const hypB = boundaries(hypTurns);
  const nearest = (t: number, list: number[]) =>
    list.length === 0 ? Infinity : Math.min(...list.map((x) => Math.abs(x - t)));
  const errors = refB.map((t) => nearest(t, hypB));
  const spurious = hypB.filter((t) => nearest(t, refB) > 1).length;
  const finite = errors.filter((e) => Number.isFinite(e));
  const sorted = [...finite].sort((a, b) => a - b);

  const refLine = timeline(refTurns, end);
  const hypLine = timeline(hypTurns, end);

  // 混淆矩陣 → 貪心對映：重疊秒數最多的配對先成立，每個標籤只配一次
  const pairs = new Map<string, number>();
  for (let s = 0; s < refLine.length; s++) {
    const r = refLine[s];
    const h = hypLine[s];
    if (r === null || h === null) continue;
    const key = JSON.stringify([h, r]);
    pairs.set(key, (pairs.get(key) ?? 0) + 1);
  }
  const mapping: Record<string, string> = {};
  const usedRef = new Set<string>();
  for (const [key] of [...pairs].sort((a, b) => b[1] - a[1])) {
    const [h, r] = JSON.parse(key) as [string, string];
    if (mapping[h] !== undefined || usedRef.has(r)) continue;
    mapping[h] = r;
    usedRef.add(r);
  }

  let correct = 0;
  let total = 0;
  for (let s = 0; s < refLine.length; s++) {
    const r = refLine[s];
    if (r === null) continue;
    total++;
    const h = hypLine[s];
    if (h !== null && mapping[h] === r) correct++;
  }

  const distinct = (turns: TranscriptTurn[]) =>
    new Set(turns.map((t) => t.speaker).filter((s): s is string => s !== null)).size;

  return {
    refSpeakers: distinct(refTurns),
    hypSpeakers: distinct(hypTurns),
    boundary: {
      refBoundaries: refB.length,
      hypBoundaries: hypB.length,
      meanErrorS: finite.length === 0 ? 0 : finite.reduce((a, b) => a + b, 0) / finite.length,
      medianErrorS: sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)],
      within1sRatio:
        errors.length === 0 ? 1 : errors.filter((e) => e <= 1).length / errors.length,
      spuriousRatio: hypB.length === 0 ? 0 : spurious / hypB.length,
    },
    attribution: { accuracy: total === 0 ? 0 : correct / total, mapping },
  };
}

/** 人工標的時間錨點：某句話真正出現在音檔的第幾秒。 */
export type Anchor = { at: number; text: string };

export type AnchorDrift = {
  checked: number;
  found: number;
  /** 找得到的錨點的平均絕對誤差（秒）。 */
  meanErrorS: number;
  maxErrorS: number;
  /** 稿子裡根本找不到這句話——可能是聽錯到認不出來，不是時間戳的問題。 */
  missing: string[];
};

/**
 * 時間戳偏差。為什麼要人工錨點而不是拿 reference 的時間戳來比：
 * reference 是由引擎輸出改出來的，時間戳本來就是那家引擎自己的，比了等於比自己。
 * 所以一場只要人工標三五句「這句話在第幾秒」，就能量到跳播會不會跳錯地方。
 *
 * 段落內的位置用等速說話估算（段落起點 → 下一段起點之間線性內插）——
 * 錯個一兩秒不影響結論，我們要抓的是「差十秒」那種。
 */
export function anchorDrift(anchors: Anchor[], hypTurns: TranscriptTurn[]): AnchorDrift {
  const errors: number[] = [];
  const missing: string[] = [];

  for (const anchor of anchors) {
    const needle = normalizeForCompare(anchor.text);
    let at: number | null = null;
    for (let i = 0; i < hypTurns.length && at === null; i++) {
      const turn = hypTurns[i];
      const chars = Array.from(normalizeForCompare(turn.text));
      const idx = chars.join("").indexOf(needle);
      if (idx < 0) continue;
      const end = hypTurns[i + 1]?.start ?? turn.start + chars.length / CHARS_PER_SECOND;
      const span = Math.max(0, end - turn.start);
      at = turn.start + (chars.length === 0 ? 0 : (idx / chars.length) * span);
    }
    if (at === null) missing.push(anchor.text);
    else errors.push(Math.abs(at - anchor.at));
  }

  return {
    checked: anchors.length,
    found: errors.length,
    meanErrorS: errors.length === 0 ? 0 : errors.reduce((a, b) => a + b, 0) / errors.length,
    maxErrorS: errors.length === 0 ? 0 : Math.max(...errors),
    missing,
  };
}


/** 人工標的無語音區間（會議空檔）。 */
export type Silence = { from: number; to: number };

export type SilenceFill = {
  /** 落在無語音區間裡的段落——每一段都是憑空補出來的字。 */
  turns: { at: number; text: string }[];
  chars: number;
};

/**
 * 無語音段落被填字。Whisper 的模型卡明白警告弱監督訓練會補出音檔裡沒說的內容，
 * Scribe 是不是同一個毛病沒人驗過——這支就是在驗它。
 * 特別危險的是這種句子完全通順，人工抽查也不見得看得出來，只有對著空檔看才抓得到。
 *
 * 逐字內插而不是看「段落起點在不在區間裡」：wordsToTurns 同一個講者會併段，
 * 幻覺句被判給前一位講者時，段落起點在靜音之前——只看起點就會回「沒有補字 ✓」，
 * 剛好漏掉這張票指名要驗的東西。反向也一樣：跨出區間的段落不該整段算成補字。
 */
export function silenceFill(silences: Silence[], hypTurns: TranscriptTurn[]): SilenceFill {
  const turns: { at: number; text: string }[] = [];
  for (let i = 0; i < hypTurns.length; i++) {
    const turn = hypTurns[i];
    const chars = Array.from(turn.text);
    if (chars.length === 0) continue;
    const end = hypTurns[i + 1]?.start ?? turn.start + chars.length / CHARS_PER_SECOND;
    const per = Math.max(0, end - turn.start) / chars.length;
    for (const s of silences) {
      const inside = chars.filter((_, n) => {
        const at = turn.start + n * per;
        return at >= s.from && at < s.to;
      });
      if (inside.length === 0) continue;
      const first = chars.findIndex((_, n) => turn.start + n * per >= s.from);
      turns.push({ at: turn.start + first * per, text: inside.join("") });
    }
  }
  return { turns, chars: turns.reduce((n, t) => n + t.text.length, 0) };
}

/**
 * 重複迴圈：同一段字連續重複三次以上。長檔最容易出現，而且一出現就是整段廢掉。
 * 只看 2 字以上的片段——一個字的「好好好」是真人講話；
 * 上限拉到 60 字是因為長檔的迴圈幻覺是**整句**在跳針，不是幾個字。
 */
export function repetitionRuns(text: string): { maxRepeats: number; sample: string | null } {
  const s = normalizeForCompare(text);
  let best = { maxRepeats: 1, sample: null as string | null };
  for (let len = 2; len <= 60; len++) {
    for (let i = 0; i + len * 2 <= s.length; i++) {
      const unit = s.slice(i, i + len);
      let repeats = 1;
      while (s.slice(i + len * repeats, i + len * (repeats + 1)) === unit) repeats++;
      if (repeats >= 3 && repeats > best.maxRepeats) best = { maxRepeats: repeats, sample: unit };
      if (repeats > 1) i += len * (repeats - 1);
    }
  }
  return best;
}

/** 一場 case 的人工標註（bakeoff/cases/<id>/case.json 的評分相關欄位）。 */
export type CaseSpec = {
  /** 該場的專有名詞詞表。 */
  terms?: string[];
  /** 人工標的時間錨點。 */
  anchors?: Anchor[];
  /** 人工標的無語音區間。 */
  silences?: Silence[];
  /** 音檔長度（秒），算歸屬正確率的分母。 */
  audioSeconds?: number;
};

export type Score = {
  text: CerResult;
  terms: ReturnType<typeof termRecall>;
  speakers: SpeakerMetrics;
  anchors: AnchorDrift;
  silence: SilenceFill;
  repetition: ReturnType<typeof repetitionRuns>;
  /** 逐段 CER，報表印最糟的幾段。 */
  segments: SegmentScore[];
};

/** 一份稿子對一場 case 的完整成績單。 */
export function scoreTurns(
  refTurns: TranscriptTurn[],
  hypTurns: TranscriptTurn[],
  spec: CaseSpec = {},
): Score {
  const refText = refTurns.map((t) => t.text).join("");
  const hypText = hypTurns.map((t) => t.text).join("");
  return {
    text: cer(refText, hypText),
    terms: termRecall(spec.terms ?? [], hypText),
    speakers: speakerMetrics(refTurns, hypTurns, spec.audioSeconds),
    anchors: anchorDrift(spec.anchors ?? [], hypTurns),
    silence: silenceFill(spec.silences ?? [], hypTurns),
    repetition: repetitionRuns(hypText),
    segments: segmentScores(refTurns, hypTurns, spec.audioSeconds),
  };
}

export type SegmentScore = {
  /** 這一段在 reference 上的起點（秒）。 */
  start: number;
  speaker: string | null;
  /** reference 原文，報表要印給人看「塌的是哪一段」。 */
  text: string;
  /** 同一時間窗裡 hyp 說了什麼。 */
  hypText: string;
  cer: number;
};

/**
 * 逐段 CER——把「塌在哪裡」定位出來。
 * 全篇的長度比只說得出「少了字」，說不出少在哪一段；而「哪一類場景會塌」這個問題，
 * 答案常常是「只有某人講話的那五分鐘塌了」（離麥克風最遠的那個人）。
 *
 * 段落邊界是拿時間內插切的，邊緣會溢出一兩個字——這是粗略定位，不是精確分數，
 * 排序找最糟的幾段夠用，別拿單段的數字當結論。
 */
export function segmentScores(
  refTurns: TranscriptTurn[],
  hypTurns: TranscriptTurn[],
  /** 音檔長度（秒），用來定最後一段的尾巴。 */
  endSeconds?: number,
): SegmentScore[] {
  // hyp 的每個字攤在時間軸上
  const timed: { at: number; ch: string }[] = [];
  for (let i = 0; i < hypTurns.length; i++) {
    const turn = hypTurns[i];
    const chars = Array.from(turn.text);
    if (chars.length === 0) continue;
    const end = hypTurns[i + 1]?.start ?? turn.start + chars.length / CHARS_PER_SECOND;
    const per = Math.max(0, end - turn.start) / chars.length;
    chars.forEach((ch, n) => timed.push({ at: turn.start + n * per, ch }));
  }

  const tail = endSeconds ?? (refTurns.at(-1)?.start ?? 0) + 1;
  return refTurns.map((turn, i) => {
    const to = refTurns[i + 1]?.start ?? tail;
    const hypText = timed
      .filter((c) => c.at >= turn.start && c.at < to)
      .map((c) => c.ch)
      .join("");
    return {
      start: turn.start,
      speaker: turn.speaker,
      text: turn.text,
      hypText,
      cer: cer(turn.text, hypText).cer,
    };
  });
}
