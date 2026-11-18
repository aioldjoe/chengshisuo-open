import { describe, expect, it } from "vitest";

import { exportBaseName, meetingToDocx } from "./docx";
import type { Meeting } from "./types";
import { readZipText } from "./zip.testutil";

const AT = new Date("2026-08-22T10:30:00Z");

const base: Parameters<typeof meetingToDocx>[0] = {
  createdAt: "2026-08-20T02:00:00.000Z",
  durationLabel: "12:34",
  turns: [],
  speakerNames: {},
  summary: {
    title: "週會",
    highlights: [],
    decisions: [],
    todos: [],
    commitments: [],
    sections: [],
  },
};

const asName = (m: Pick<Meeting, "speakerNames">) => (label: string | null) =>
  label ? (m.speakerNames[label] ?? label) : "發言";

function parts(m: typeof base) {
  return readZipText(meetingToDocx(m, asName(m), AT));
}

/** document.xml → 每段的 { style, text }，讓斷言講「文件長怎樣」而不是「XML 長怎樣」。 */
function paras(m: typeof base): { style: string; text: string }[] {
  const doc = parts(m).get("word/document.xml")!;
  return [...doc.matchAll(/<w:p>(.*?)<\/w:p>/g)].map(([, inner]) => ({
    style: /<w:pStyle w:val="([^"]+)"/.exec(inner)?.[1] ?? "Normal",
    text: [...inner.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g)]
      .map(([, t]) => t)
      .join("")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&"),
  }));
}

const textOf = (m: typeof base) => paras(m).map((p) => p.text);

describe("meetingToDocx", () => {
  it("是一包 Word 認得的 OPC——必要的 part 都在，標題進得了正文", () => {
    const p = parts(base);
    expect([...p.keys()]).toEqual(
      expect.arrayContaining([
        "[Content_Types].xml",
        "_rels/.rels",
        "word/_rels/document.xml.rels",
        "word/document.xml",
        "word/styles.xml",
        "docProps/core.xml",
      ]),
    );
    const doc = p.get("word/document.xml")!;
    expect(doc.startsWith("<?xml")).toBe(true);
    expect(doc).toContain('<w:t xml:space="preserve">週會</w:t>');
    expect(p.get("docProps/core.xml")).toContain("<dc:title>週會</dc:title>");
  });

  it("抬頭是標題與 meta 行", () => {
    const p = paras(base);
    expect(p[0]).toEqual({ style: "Title", text: "週會" });
    expect(p[1].style).toBe("Meta");
    expect(p[1].text).toContain("2026-08-20");
    expect(p[1].text).toContain("12 分 34 秒");
  });

  it("重點、決議照順序各成一區，條列前面有記號", () => {
    const p = paras({
      ...base,
      summary: { ...base.summary, highlights: ["營收超標"], decisions: ["下週上線"] },
    });
    const heads = p.filter((x) => x.style === "Heading1").map((x) => x.text);
    expect(heads).toEqual(["重點", "決議"]);
    expect(p.map((x) => x.text)).toContain("・營收超標");
    expect(p.map((x) => x.text)).toContain("・下週上線");
  });

  it("空的區塊整區不出現——文件裡一個只有標題沒有內容的段落看起來像壞了", () => {
    expect(paras(base).filter((x) => x.style === "Heading1")).toEqual([]);
  });

  it("待辦帶負責人與期限，缺的欄位不留空殼", () => {
    const t = textOf({
      ...base,
      summary: {
        ...base.summary,
        todos: [
          { task: "改報價單", owner: "王協理", due: "下週五前" },
          { task: "查庫存", owner: null, due: null },
        ],
      },
    });
    expect(t).toContain("・改報價單");
    expect(t).toContain("負責人：王協理　/　期限：下週五前");
    expect(t).toContain("・查庫存");
    expect(t.join("\n")).not.toContain("負責人：　");
  });

  it("承諾一定綁說話人，說話人命名要跟著換", () => {
    const t = textOf({
      ...base,
      speakerNames: { "講者 A": "王協理" },
      summary: {
        ...base.summary,
        commitments: [{ who: "講者 A", what: "週三前給數字", due: null }],
      },
    });
    expect(t).toContain("・王協理：週三前給數字");
  });

  it("議題分段只在兩段以上才另成一區（跟記錄頁同一條規則）", () => {
    const one = { title: "定價", points: ["先做 A"], decisions: [], todos: [] };
    const two = { title: "人力", points: ["再招一人"], decisions: [], todos: [] };
    expect(textOf({ ...base, summary: { ...base.summary, sections: [one] } })).not.toContain("議題分段");
    const t = textOf({ ...base, summary: { ...base.summary, sections: [one, two] } });
    expect(t).toContain("議題分段");
    expect(t).toContain("定價");
    expect(t).toContain("・再招一人");
  });

  it("逐字稿另起一頁，換人才標名字，說話人命名跟著換", () => {
    const m = {
      ...base,
      speakerNames: { "講者 A": "王協理" },
      turns: [
        { speaker: "講者 A", start: 0, text: "先講進度" },
        { speaker: "講者 A", start: 12, text: "都照計畫" },
        { speaker: "講者 B", start: 3661, text: "我補一句" },
      ],
    };
    const p = paras(m);
    const head = p.find((x) => x.text === "逐字稿")!;
    expect(head.style).toBe("Heading1");

    const doc = parts(m).get("word/document.xml")!;
    expect(doc).toContain("<w:pageBreakBefore/>");

    const t = p.map((x) => x.text);
    // 講者 A 連講兩段只標一次名；換成 B 才再標
    expect(t.filter((x) => x === "王協理")).toHaveLength(1);
    expect(t).toContain("講者 B");
    expect(t).toContain("00:00\u3000先講進度");
    expect(t).toContain("00:12\u3000都照計畫");
    // 超過一小時的時間戳要有小時位
    expect(t).toContain("1:01:01\u3000我補一句");
  });

  it("沒有逐字稿就不放那一區", () => {
    expect(textOf(base)).not.toContain("逐字稿");
  });

  it("XML 特殊字元跳脫，段內換行變 w:br", () => {
    const m = {
      ...base,
      summary: { ...base.summary, title: "R&D <季>", highlights: ["第一行\n第二行"] },
    };
    const doc = parts(m).get("word/document.xml")!;
    expect(doc).toContain("R&amp;D &lt;季&gt;");
    expect(doc).not.toContain("<季>");
    expect(doc).toContain("<w:br/>");
    expect(textOf(m)).toContain("R&D <季>");
  });
});

describe("exportBaseName", () => {
  it("空標題有預設、檔名不合法的字元換掉、過長切短", () => {
    expect(exportBaseName("  ")).toBe("會議記錄");
    expect(exportBaseName("Q3/Q4 檢討")).toBe("Q3 Q4 檢討");
    expect(exportBaseName("長".repeat(80))).toHaveLength(60);
  });
});
