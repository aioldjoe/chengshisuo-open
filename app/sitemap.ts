import type { MetadataRoute } from "next";

import { allArticles } from "@/lib/blog-source";

/**
 * 只收「歡迎被搜到」的頁。記錄頁／分享頁／試用頁不在這裡，也各自掛了 noindex——
 * 兩件事要一起做：sitemap 上線等於主動請 Google 來爬，這時候私密路徑還沒關門就是放大漏洞。
 */

const BASE = process.env.APP_BASE_URL || "https://chengshisuo.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const articles = allArticles().map((a) => ({
    url: `${BASE}/blog/${a.slug}`,
    lastModified: new Date(a.updated),
    changeFrequency: "yearly" as const,
    priority: 0.8,
  }));

  return [
    { url: BASE, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/blog`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/demo`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    ...articles,
  ];
}
