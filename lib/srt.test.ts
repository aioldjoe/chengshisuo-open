import { describe, expect, it } from "vitest";

import { turnsToSrt } from "./srt";

const label = (l: string | null) => l ?? "";

describe("turnsToSrt", () => {
  it("用下一句的起始時間當這句的結束", () => {
    const srt = turnsToSrt(
      [
        { speaker: "講者 A", start: 0, text: "第一句" },
        { speaker: "講者 A", start: 2.5, text: "第二句" },
      ],
      label,
    );
    expect(srt).toBe(
      "1\n00:00:00,000 --> 00:00:02,500\n講者 A：第一句\n\n" +
        "2\n00:00:02,500 --> 00:00:06,500\n講者 A：第二句\n",
    );
  });

  it("沒有講者就不加冒號前綴", () => {
    const srt = turnsToSrt([{ speaker: null, start: 0, text: "無講者" }], label);
    expect(srt).toContain("\n無講者\n");
  });

  it("換算跨小時的時間戳", () => {
    const srt = turnsToSrt([{ speaker: null, start: 3661, text: "x" }], label);
    expect(srt).toContain("01:01:01,000 -->");
  });
});
