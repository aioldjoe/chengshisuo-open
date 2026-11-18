import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { parseArticle, type Article } from "./blog";

/**
 * content/blog/*.md 的讀取層。解析是純函式（lib/blog.ts），這裡只碰檔案系統。
 *
 * 只在 build 時跑：文章頁是 force-static ＋ generateStaticParams，產物是靜態 HTML，
 * 所以正式環境的函式裡不需要有 content/ 這個目錄（也就不必動 outputFileTracingIncludes）。
 *
 * slug 一律用「目錄裡實際存在的檔名」比對，不用來組路徑——組路徑就得防 ../。
 */

const DIR = join(process.cwd(), "content", "blog");

export function articleSlugs(): string[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3))
    .sort();
}

export function getArticle(slug: string): Article | null {
  if (!articleSlugs().includes(slug)) return null;
  return parseArticle(readFileSync(join(DIR, `${slug}.md`), "utf8"));
}

/** 索引頁用。新的排前面——updated 是 YYYY-MM-DD，字串比較就是日期比較。 */
export function allArticles(): Article[] {
  return articleSlugs()
    .map((s) => getArticle(s))
    .filter((a): a is Article => a !== null)
    .sort((a, b) => b.updated.localeCompare(a.updated));
}
