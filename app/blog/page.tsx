import type { Metadata } from "next";

import { allArticles } from "@/lib/blog-source";

import { OG_BASE } from "./og";

import { ThemeToggle } from "../theme-toggle";
import css from "./article.module.css";

/**
 * 筆記索引。低調的入口：這裡是產品筆記，不是內容行銷的落地頁。
 */

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "筆記",
  description: "成事所的產品筆記與使用教學：LINE 丟錄音、會後紀要、決議與待辦怎麼整理。",
  alternates: { canonical: "/blog" },
  openGraph: { ...OG_BASE, type: "website", url: "/blog", title: "筆記｜成事所" },
};

export default function BlogIndex() {
  const articles = allArticles();
  return (
    <div className={css.wrap}>
      <header className={css.topbar}>
        <a className={css.brand} href="/">
          <span className={css.seal} aria-hidden>
            成
          </span>
          <span className={css.wordmark}>成事所</span>
        </a>
        <div className={css.topActions}>
          <ThemeToggle />
          <a className={css.topLink} href="/">
            回首頁
          </a>
        </div>
      </header>

      <div className={css.article}>
        <h1 className={css.h1}>筆記</h1>
        <p className={css.meta}>怎麼用、為什麼這樣做。</p>
        <ul className={css.list}>
          {articles.map((a) => (
            <li key={a.slug} className={css.listItem}>
              <a className={css.listLink} href={`/blog/${a.slug}`}>
                {a.title}
              </a>
              <p className={css.listDesc}>{a.metaDescription}</p>
              <time className={css.listDate} dateTime={a.updated}>
                {a.updated}
              </time>
            </li>
          ))}
        </ul>
      </div>

      <footer className={css.footer}>
        <a className={css.footLink} href="/">
          成事所
        </a>
      </footer>
    </div>
  );
}
