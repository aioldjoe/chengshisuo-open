import { describe, expect, it } from "vitest";

import { applyCorrections, correctTurns } from "./correct";
import type { AIProvider } from "../ai/provider";
import type { TranscriptTurn } from "../types";

const turns: TranscriptTurn[] = [
  { speaker: "講者 A", start: 0, text: "一次測電流量的取分相對值最高" },
  { speaker: "講者 B", start: 10, text: "IPOV 手冊不要求，公式是要 COP 來算，一次測電流量也一樣" },
];

describe("applyCorrections", () => {
  it("全域替換、跨 turn 全數命中", () => {
    const out = applyCorrections(turns, [
      { from: "一次測電流量", to: "一次側變流量" },
      { from: "IPOV", to: "IPLV" },
    ]);
    expect(out[0].text).toBe("一次側變流量的取分相對值最高");
    expect(out[1].text).toBe("IPLV 手冊不要求，公式是要 COP 來算，一次側變流量也一樣");
  });

  it("不動沒列進替換表的字", () => {
    const out = applyCorrections(turns, [{ from: "IPOV", to: "IPLV" }]);
    expect(out[0].text).toBe(turns[0].text);
  });

  it("空表、單字、from===to 一律略過", () => {
    const out = applyCorrections(turns, [
      { from: "", to: "x" },
      { from: "分", to: "分" },
      { from: "算", to: "换" }, // 單字（<2）不套，避免誤傷
    ]);
    expect(out).toEqual(turns);
  });
});

/** 假 provider：依序回應腳本裡的下一項（Error 就丟出來），並記下每次的 maxTokens。 */
function fakeProvider(script: (unknown | Error)[]) {
  const budgets: (number | undefined)[] = [];
  const provider: AIProvider = {
    name: "fake",
    model: "fake",
    async generateJSON<T>(opts: { maxTokens?: number }): Promise<T> {
      budgets.push(opts.maxTokens);
      const next = script.shift();
      if (next instanceof Error) throw next;
      return next as T;
    },
  };
  return { provider, budgets };
}

describe("correctTurns 的失敗處理", () => {
  it("第一次截斷就用雙倍額度再打一次", async () => {
    const { provider, budgets } = fakeProvider([
      new Error("Unexpected end of JSON input"),
      { corrections: [{ from: "IPOV", to: "IPLV" }] },
    ]);
    const out = await correctTurns(turns, provider);
    expect(budgets).toEqual([2048, 4096]);
    expect(out.corrections).toEqual([{ from: "IPOV", to: "IPLV" }]);
    expect(out.turns[1].text).toContain("IPLV 手冊");
  });

  it("成功就不多打——重試只在失敗時發生", async () => {
    const { provider, budgets } = fakeProvider([{ corrections: [] }]);
    await correctTurns(turns, provider);
    expect(budgets).toEqual([2048]);
  });

  it("兩次都失敗：退回原文，不擋主流程", async () => {
    const { provider, budgets } = fakeProvider([new Error("500"), new Error("500")]);
    const out = await correctTurns(turns, provider);
    expect(budgets).toEqual([2048, 4096]);
    expect(out.turns).toEqual(turns);
    expect(out.corrections).toEqual([]);
  });
});
