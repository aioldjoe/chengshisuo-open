import { describe, expect, it } from "vitest";

import {
  anchorDrift,
  cer,
  repetitionRuns,
  scoreTurns,
  segmentScores,
  silenceFill,
  speakerMetrics,
  termRecall,
} from "./stt-score";

describe("cer", () => {
  it("兩個字聽錯就是 2/6", () => {
    // 「一次側變流量」→「一次測電流量」：側→測、變→電，六字錯兩字
    const r = cer("一次側變流量", "一次測電流量");
    expect(r.distance).toBe(2);
    expect(r.refLen).toBe(6);
    expect(r.cer).toBeCloseTo(0.3333, 4);
  });

  it("標點、空格、全半形與英文大小寫不算錯", () => {
    expect(cer("我們先講泵浦，IPLV 的部分。", "我們先講泵浦 iplv的部分").cer).toBe(0);
  });

  it("完全一樣就是 0", () => {
    expect(cer("一次側變流量", "一次側變流量").cer).toBe(0);
  });
});

describe("termRecall", () => {
  const hyp = [
    "大概一次側變流量的角度是沒有錯的，",
    "不管一次測電流量、還是一次設電流量，",
    "它的取分相對值是最高的。",
  ].join("");

  it("詞表命中幾個就是召回率", () => {
    const r = termRecall(["一次側變流量", "IPLV"], hyp);
    expect(r.recall).toBe(0.5);
    expect(r.terms[0].hits).toBe(1);
    expect(r.terms[1].hits).toBe(0);
  });

  it("同一個詞被聽成幾種寫法就列幾條——校正表要補幾條看這個", () => {
    const [t] = termRecall(["一次側變流量"], hyp).terms;
    expect(t.variants.map((v) => v.text)).toEqual(["一次測電流量", "一次設電流量"]);
  });

  it("短的英文縮寫聽錯也要抓得到——IPLV→IPOV 是已知的系統性錯誤", () => {
    const [t] = termRecall(["IPLV"], "他說那個 IPOV 的值比較高").terms;
    expect(t.hits).toBe(0);
    expect(t.variants.map((v) => v.text)).toEqual(["ipov"]);
  });

  it("錯到認不出來的詞不硬湊變體", () => {
    const [t] = termRecall(["建築能效"], "然後寫了一份評估報告給他").terms;
    expect(t.hits).toBe(0);
    expect(t.variants).toEqual([]);
  });
});

describe("speakerMetrics", () => {
  const ref = [
    { speaker: "講者 A", start: 0, text: "一" },
    { speaker: "講者 B", start: 10, text: "二" },
    { speaker: "講者 A", start: 20, text: "三" },
  ];

  it("講者數對不對是第一個問題", () => {
    const r = speakerMetrics(ref, [{ speaker: "講者 A", start: 0, text: "一二三" }], 30);
    expect(r.refSpeakers).toBe(2);
    expect(r.hypSpeakers).toBe(1);
  });

  it("輪替邊界差幾秒", () => {
    const hyp = [
      { speaker: "講者 A", start: 0, text: "一" },
      { speaker: "講者 B", start: 12, text: "二" },
      { speaker: "講者 A", start: 20, text: "三" },
    ];
    const r = speakerMetrics(ref, hyp, 30);
    // ref 邊界在 10s 與 20s；hyp 在 12s 與 20s → 差 2s 與 0s
    expect(r.boundary.meanErrorS).toBe(1);
    expect(r.boundary.within1sRatio).toBe(0.5);
    // 10、11 兩秒被歸給錯的人，其餘 28 秒對
    expect(r.attribution.accuracy).toBeCloseTo(28 / 30, 4);
  });

  it("講者標籤只是代號——A/B 對調不算錯", () => {
    const swapped = [
      { speaker: "講者 B", start: 0, text: "一" },
      { speaker: "講者 A", start: 10, text: "二" },
      { speaker: "講者 B", start: 20, text: "三" },
    ];
    const r = speakerMetrics(ref, swapped, 30);
    expect(r.attribution.accuracy).toBe(1);
    expect(r.attribution.mapping["講者 B"]).toBe("講者 A");
  });
});

describe("anchorDrift", () => {
  // 十個字均勻攤在十秒裡：第 n 個字約在第 n 秒
  const hyp = [
    { speaker: "講者 A", start: 0, text: "零一二三四五六七八九" },
    { speaker: "講者 B", start: 10, text: "後面這段" },
  ];

  it("錨點句子落在稿子的哪一秒——差幾秒就是跳播會差幾秒", () => {
    const r = anchorDrift([{ at: 6, text: "六七" }], hyp);
    expect(r.found).toBe(1);
    expect(r.meanErrorS).toBeCloseTo(0, 3);
  });

  it("找不到錨點句子就算沒找到，不當成零誤差", () => {
    const r = anchorDrift([{ at: 6, text: "這句話沒出現過" }], hyp);
    expect(r.found).toBe(0);
    expect(r.missing).toEqual(["這句話沒出現過"]);
  });
});

describe("silenceFill", () => {
  it("空檔裡冒出來的整段話就是憑空補的字", () => {
    const hyp = [
      { speaker: "講者 A", start: 0, text: "我們先講泵浦" },
      { speaker: "講者 B", start: 12, text: "謝謝大家的收看" },
    ];
    const r = silenceFill([{ from: 11, to: 60 }], hyp);
    expect(r.turns).toEqual([{ at: 12, text: "謝謝大家的收看" }]);
    expect(r.chars).toBe(7);
  });

  it("沒標無語音區間就沒東西可算", () => {
    expect(silenceFill([], [{ speaker: null, start: 0, text: "一二三" }]).chars).toBe(0);
  });
});

describe("repetitionRuns", () => {
  it("同一段字連續重複三次以上就是迴圈", () => {
    const r = repetitionRuns("那我們先講泵浦先講泵浦先講泵浦的部分");
    expect(r.maxRepeats).toBe(3);
    expect(r.sample).toBe("先講泵浦");
  });

  it("正常的話不算重複", () => {
    expect(repetitionRuns("好，好，那我這樣子來，以我的經驗。").maxRepeats).toBe(1);
  });
});

describe("scoreTurns", () => {
  it("把一份稿子對一場 case 的所有指標算齊", () => {
    const ref = [
      { speaker: "講者 A", start: 0, text: "一次側變流量的取分最高。" },
      { speaker: "講者 B", start: 10, text: "對，主機換掉也是對的。" },
    ];
    const hyp = [
      { speaker: "講者 A", start: 0, text: "一次測電流量的取分最高。" },
      { speaker: "講者 B", start: 11, text: "對，主機換掉也是對的。" },
    ];
    const s = scoreTurns(ref, hyp, { terms: ["一次側變流量"], audioSeconds: 20 });
    expect(s.text.distance).toBe(2);
    expect(s.terms.recall).toBe(0);
    expect(s.terms.terms[0].variants[0].text).toBe("一次測電流量");
    expect(s.speakers.hypSpeakers).toBe(2);
    expect(s.speakers.boundary.meanErrorS).toBe(1);
    expect(s.repetition.maxRepeats).toBe(1);
  });
});

describe("指標不能給出漂亮但騙人的數字", () => {
  const ref = [
    { speaker: "講者 A", start: 0, text: "一" },
    { speaker: "講者 B", start: 10, text: "二" },
    { speaker: "講者 A", start: 20, text: "三" },
  ];

  it("每兩秒亂切一刀的分離不該拿到滿分的邊界誤差", () => {
    const hyp = Array.from({ length: 15 }, (_, i) => ({
      speaker: `講者 ${i % 2 ? "B" : "A"}`,
      start: i * 2,
      text: "字",
    }));
    const r = speakerMetrics(ref, hyp, 30);
    // ref 的每個邊界附近都剛好有一刀 → 只看這個方向會是 0 秒誤差
    expect(r.boundary.meanErrorS).toBe(0);
    // 但多切出來的刀要被記下來，否則插話搶話那類會漂亮得剛好相反
    expect(r.boundary.hypBoundaries).toBe(14);
    expect(r.boundary.spuriousRatio).toBeGreaterThan(0.8);
  });

  it("幻覺句被併進前一段時，空檔補字仍要抓得到", () => {
    // 十個字攤在 0–30 秒（每字 3 秒），第 12／15／18 秒的字落在無語音區間裡
    const hyp = [
      { speaker: "講者 A", start: 0, text: "零一二三四五六七八九" },
      { speaker: "講者 B", start: 30, text: "後面這段" },
    ];
    const r = silenceFill([{ from: 10, to: 20 }], hyp);
    expect(r.turns).toEqual([{ at: 12, text: "四五六" }]);
    expect(r.chars).toBe(3);
  });

  it("兩個字的詞不列變體——分不出是聽錯還是另一個詞", () => {
    // tolerance 給到 1 的話，「台積」會把台北／台大／台南全收成變體，
    // 照著寫校正表就是「台→台積」這種毀稿替換
    const r = termRecall(["台積"], "台北、台大、台南都去過");
    expect(r.terms[0].variants).toEqual([]);
  });

  it("整句級的迴圈也是迴圈——長檔的幻覺是一整句在跳針", () => {
    const line = "那我們今天就先討論到這裡好嗎大家辛苦了謝謝各位";
    expect(repetitionRuns(line.repeat(4)).maxRepeats).toBe(4);
  });
});

describe("segmentScores", () => {
  it("整段被漏掉時，指出是哪一段——全篇長度比看不出塌在哪裡", () => {
    const ref = [
      { speaker: "講者 A", start: 0, text: "我們先講泵浦的部分" },
      { speaker: "講者 B", start: 10, text: "這一整段被漏掉了完全沒有" },
      { speaker: "講者 A", start: 20, text: "那第二個部分" },
    ];
    const hyp = [
      { speaker: "講者 A", start: 0, text: "我們先講泵浦的部分" },
      { speaker: "講者 A", start: 20, text: "那第二個部分" },
    ];
    const worst = segmentScores(ref, hyp, 30).sort((a, b) => b.cer - a.cer)[0];
    expect(worst.start).toBe(10);
    expect(worst.cer).toBeGreaterThan(0.8);
  });

  it("完全對上的稿子每一段都是零", () => {
    const turns = [
      { speaker: "講者 A", start: 0, text: "我們先講泵浦的部分" },
      { speaker: "講者 B", start: 10, text: "主機是空調最耗電的" },
    ];
    expect(segmentScores(turns, turns, 20).every((s) => s.cer === 0)).toBe(true);
  });
});
