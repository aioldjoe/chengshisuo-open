import { describe, expect, it } from "vitest";

import { formatTranscriptMd, parseTranscriptMd } from "./transcript-md";

describe("parseTranscriptMd", () => {
  it("讀出講者、起始秒數與內容", () => {
    const md = ["# ElevenLabs Scribe", "", "**[01:05] 講者 B**：一次側變流量。", ""].join("\n");
    expect(parseTranscriptMd(md)).toEqual([
      { speaker: "講者 B", start: 65, text: "一次側變流量。" },
    ]);
  });

  it("超過一小時的場次讀得懂 h:mm:ss", () => {
    expect(parseTranscriptMd("**[1:02:03] 講者 A**：三小時的場次。")[0].start).toBe(3723);
  });

  it("跳過標題與 meta 行", () => {
    const md = ["# ElevenLabs Scribe", "", "- 檔案：a.m4a", "- 講者數：2", ""].join("\n");
    expect(parseTranscriptMd(md)).toEqual([]);
  });
});

describe("formatTranscriptMd", () => {
  it("寫出來的稿子讀得回一模一樣的 turns", () => {
    const turns = [
      { speaker: "講者 A", start: 5, text: "先講泵浦的部分。" },
      { speaker: "講者 B", start: 3723, text: "IPLV 的取分相對值最高。" },
    ];
    expect(parseTranscriptMd(formatTranscriptMd(turns))).toEqual(turns);
  });
});
