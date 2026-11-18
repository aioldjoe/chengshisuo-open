import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { renderInline } from "./blog";
import { allArticles, articleSlugs, getArticle } from "./blog-source";
import { PLANS } from "./plans";

/**
 * 對真稿子的護欄。合成字串測得了解析器，測不到「稿子被改壞」——
 * 而這兩篇是對外承諾，改壞的代價比程式 bug 高。
 */

const SLUGS = ["line-meeting-notes-how-to", "transcript-vs-decisions-todos"];
const raw = (slug: string) => readFileSync(join(process.cwd(), "content", "blog", `${slug}.md`), "utf8");

describe("上架的兩篇", () => {
  it("slug 就是 SEO 那邊定的兩個，不多不少", () => {
    expect(articleSlugs()).toEqual([...SLUGS].sort());
  });

  it.each(SLUGS)("%s：meta 齊全（缺一個就是上線一篇沒有 title／description 的頁）", (slug) => {
    const a = getArticle(slug);
    expect(a).not.toBeNull();
    expect(a!.title.length).toBeGreaterThan(10);
    expect(a!.metaTitle.length).toBeGreaterThan(10);
    // Google 的標題大約 60 個字元後截斷，中文更早；超過就是白寫
    expect(a!.metaTitle.length).toBeLessThanOrEqual(40);
    expect(a!.metaDescription.length).toBeGreaterThan(20);
    expect(a!.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(a!.faq.length).toBeGreaterThan(2);
  });

  it("frontmatter 的 slug 跟檔名一致——不一致的話網址跟稿子的自我認知會對不上", () => {
    for (const slug of SLUGS) expect(getArticle(slug)!.slug).toBe(slug);
  });

  it("兩篇互鏈（SEO 的內鏈要求），且連的是站內相對路徑不是絕對網址", () => {
    expect(raw(SLUGS[0])).toContain(`/blog/${SLUGS[1]}`);
    expect(raw(SLUGS[1])).toContain(`/blog/${SLUGS[0]}`);
  });

  it("索引頁排序：新的在前", () => {
    const all = allArticles();
    expect(all.length).toBe(2);
    expect(all[0].updated >= all[1].updated).toBe(true);
  });
});

/**
 * 定價一致性。文章裡的數字是寫死的（稿子刻意如此），所以方案表一改，
 * 這裡就要紅——提醒去改文案，而不是讓官網跟文章各說各話。
 */
describe("文中定價與 lib/plans.ts 一致", () => {
  const all = SLUGS.map(raw).join("\n");

  it("兩檔付費的價格", () => {
    expect(all).toContain(`NT$${PLANS.lite.priceTwd}`);
    expect(all).toContain(`NT$${PLANS.standard.priceTwd}`);
  });

  it("時數與場次", () => {
    expect(all).toContain(`${PLANS.lite.monthlyHours} 小時`);
    expect(all).toContain(`${PLANS.standard.monthlyHours} 小時`);
    expect(all).toContain(`${PLANS.free.monthlyMeetings} 場`);
  });

  it("免費檔的單場上限與保留天數", () => {
    expect(all).toContain(`${PLANS.free.maxMeetingSeconds! / 3600} 小時`);
    expect(all).toContain(`${PLANS.free.pageDays} 天`);
  });
});

describe("FAQ 內容進得了 JSON-LD", () => {
  it.each(SLUGS)("%s：每組問答都是非空純文字，且沒有殘留 markdown 標記", (slug) => {
    for (const f of getArticle(slug)!.faq) {
      expect(f.q.length).toBeGreaterThan(3);
      expect(f.a.length).toBeGreaterThan(3);
      expect(f.a).not.toContain("**");
      expect(f.q).not.toContain("**");
    }
  });

  it("FAQ 的段落不會同時留在正文 blocks 裡（留著就整份出現兩次）", () => {
    for (const slug of SLUGS) {
      const a = getArticle(slug)!;
      const body = a.blocks.map((b) => (b.kind === "p" ? renderInline(b.spans) : "")).join("\n");
      expect(body).not.toContain(a.faq[0].q);
    }
  });
});
