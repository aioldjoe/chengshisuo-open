import type { MetadataRoute } from "next";

/**
 * 私密路徑（/m /s /t）刻意**不**寫進 disallow，而是各自掛 noindex meta。
 *
 * 這兩者不能混用：disallow 是「別進來爬」，爬蟲進不來就讀不到 noindex，
 * 而只要有一條外部連結指向那個網址，Google 仍可能把「網址本身」列進索引。
 * 分享連結是設計來被轉傳的——它遲早會出現在某個公開的地方，所以要讓爬蟲進得來、
 * 讀到 noindex、然後不收錄。真正的授權閘門在伺服器，不在 robots.txt。
 */

const BASE = process.env.APP_BASE_URL || "https://chengshisuo.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
    sitemap: `${BASE}/sitemap.xml`,
  };
}
