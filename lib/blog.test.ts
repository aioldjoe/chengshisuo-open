import { describe, expect, it } from "vitest";

import { parseArticle, renderInline } from "./blog";

const SRC = `---
title: 標題全長版｜成事所使用教學
slug: demo-post
meta_title: 短一點的 SEO 標題｜成事所
meta_description: 給搜尋結果看的那一句。
updated: 2026-09-10
---

# 標題全長版｜成事所使用教學

開頭這段是**粗體**與[連結](https://example.com)混排。
這一行跟上一行同段，只是換行。

## 第一個小節

- 第一點
- 第二點有**重點**

1. 步驟一
2. 步驟二

### 更小的標題

> 引用一句話。

| 要素 | 你在找什麼 |
|------|------------|
| 決議 | 已經拍板的共識 |

## FAQ

**Q：一定要註冊嗎？**
A：不用。加 LINE 好友就可以開始用。

**Q：錄音會留著嗎？**
A：錄音 **48 小時真刪**。
`;

describe("parseArticle", () => {
  const a = parseArticle(SRC);

  it("frontmatter 讀出 meta——meta_title 與 title 是兩個欄位，SEO 標題比正文標題短", () => {
    expect(a.slug).toBe("demo-post");
    expect(a.title).toBe("標題全長版｜成事所使用教學");
    expect(a.metaTitle).toBe("短一點的 SEO 標題｜成事所");
    expect(a.metaDescription).toBe("給搜尋結果看的那一句。");
    expect(a.updated).toBe("2026-09-10");
  });

  it("正文的 H1 不進 blocks——頁面自己出 h1，重複一個是 SEO 上的雙 h1", () => {
    expect(a.blocks.some((b) => b.kind === "h2" && b.text === "標題全長版｜成事所使用教學")).toBe(false);
  });

  /** 第一個段落的 spans。找不到就讓測試當場失敗，別讓後面的斷言對著空陣列過關。 */
  const firstParagraph = () => {
    const p = a.blocks.find((b) => b.kind === "p");
    if (p?.kind !== "p") throw new Error("解析結果裡沒有段落");
    return p.spans;
  };

  it("段落內的單一換行是 soft break，不切成兩段", () => {
    expect(renderInline(firstParagraph())).toContain("這一行跟上一行同段");
  });

  it("inline 認得粗體與連結", () => {
    const spans = firstParagraph();
    expect(spans.some((s) => s.bold && s.text === "粗體")).toBe(true);
    expect(spans.some((s) => s.href === "https://example.com" && s.text === "連結")).toBe(true);
  });

  it("清單分得出有序與無序", () => {
    const ul = a.blocks.find((b) => b.kind === "ul");
    const ol = a.blocks.find((b) => b.kind === "ol");
    expect(ul?.kind === "ul" && ul.items.length).toBe(2);
    expect(ol?.kind === "ol" && ol.items.length).toBe(2);
  });

  it("標題帶 id——目錄與錨點連結要用，中文 slug 化後不能是空字串", () => {
    const h2 = a.blocks.find((b) => b.kind === "h2");
    expect(h2?.kind === "h2" && h2.id).toBeTruthy();
  });

  it("表格與引用各成一塊", () => {
    const t = a.blocks.find((b) => b.kind === "table");
    expect(t?.kind === "table" && t.head).toEqual(["要素", "你在找什麼"]);
    expect(t?.kind === "table" && t.rows.length).toBe(1);
    expect(a.blocks.some((b) => b.kind === "quote")).toBe(true);
  });
});

describe("FAQ 抽取", () => {
  const a = parseArticle(SRC);

  it("Q/A 成對抽出來——JSON-LD 要的是純文字問答，不是排版好的 HTML", () => {
    expect(a.faq).toEqual([
      { q: "一定要註冊嗎？", a: "不用。加 LINE 好友就可以開始用。" },
      { q: "錄音會留著嗎？", a: "錄音 48 小時真刪。" },
    ]);
  });

  it("FAQ 那些段落不會同時留在 blocks 裡——留著就會在頁面上出現兩次", () => {
    const faqIdx = a.blocks.findIndex((b) => b.kind === "h2" && b.text === "FAQ");
    expect(faqIdx).toBeGreaterThan(-1);
    expect(a.blocks.slice(faqIdx + 1)).toEqual([]);
  });
});

describe("邊界", () => {
  it("沒有 frontmatter 就丟錯——寧可 build 掛掉，也不要上線一篇沒有 meta 的頁", () => {
    expect(() => parseArticle("# 只有標題\n")).toThrow();
  });

  it("沒有 FAQ 區塊時 faq 是空陣列，不是 undefined（JSON-LD 那端只判長度）", () => {
    const noFaq = parseArticle(SRC.split("## FAQ")[0]);
    expect(noFaq.faq).toEqual([]);
  });
});

describe("項目之間隔空行的清單", () => {
  // 稿子用空行把「標題＋一段說明」型的長項目拉開。跟著空行就收尾的話，
  // 一份清單會被切成好幾份 <ol>，畫面上的編號每一項都從 1 重來。
  const SRC_SPACED = `---
title: t
slug: s
meta_title: m
meta_description: d
updated: 2026-09-10
---

1. **摘要**
   先花 30 秒確認方向。

2. **決議**
   看清楚已經拍板的共識。

3. **待辦**
   核對誰、做什麼、什麼時候。
`;

  it("仍是一份清單、三個項目", () => {
    const blocks = parseArticle(SRC_SPACED).blocks;
    const ols = blocks.filter((b) => b.kind === "ol");
    expect(ols.length).toBe(1);
    expect(ols[0].kind === "ol" && ols[0].items.length).toBe(3);
  });

  it("每個項目都保住了自己的續行說明", () => {
    const ol = parseArticle(SRC_SPACED).blocks.find((b) => b.kind === "ol");
    if (ol?.kind !== "ol") throw new Error("解析結果裡沒有有序清單");
    const texts = ol.items.map(renderInline);
    expect(texts[0]).toContain("先花 30 秒確認方向");
    expect(texts[2]).toContain("核對誰、做什麼、什麼時候");
  });

  it("隔兩行以上就是兩份清單——那是作者真的想斷開", () => {
    const blocks = parseArticle(SRC_SPACED.replace("\n2. **決議**", "\n\n2. **決議**")).blocks;
    expect(blocks.filter((b) => b.kind === "ol").length).toBe(2);
  });
});
