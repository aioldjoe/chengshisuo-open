import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { faqJsonLd, type Block, type Inline } from "@/lib/blog";
import { articleSlugs, getArticle } from "@/lib/blog-source";
import { BLOG_REF, joinHref, joinTargetUrl } from "@/lib/join";

import { OG_BASE } from "../og";

import { ThemeToggle } from "../../theme-toggle";
import css from "../article.module.css";

/**
 * 文章頁。內容在 content/blog/*.md，解析在 lib/blog.ts——這裡只負責排版與 meta。
 *
 * force-static：文章是死的內容，靜態產生對搜尋引擎最好，也讓 content/ 不必進正式環境的函式。
 */

export const dynamic = "force-static";

export function generateStaticParams() {
  return articleSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const a = getArticle(slug);
  if (!a) return {};
  const path = `/blog/${slug}`;
  return {
    // absolute：稿子的 meta_title 已經自帶「｜成事所」，走 layout 的 %s 樣板會變成兩次
    title: { absolute: a.metaTitle },
    description: a.metaDescription,
    alternates: { canonical: path },
    openGraph: {
      ...OG_BASE,
      type: "article",
      url: path,
      title: a.metaTitle,
      description: a.metaDescription,
      publishedTime: a.updated,
    },
  };
}

// CTA 繞 /join 而不是直接跳 LINE：SEO 這條路要量得到「文章帶來多少加好友點擊」，
// 否則兩篇文上線之後只能憑感覺猜它有沒有用（lib/join.ts）。
// joinTargetUrl 只用來判斷「有沒有連結可去」——沒設 OA ID 時退回首頁 CTA
const HAS_ADD_FRIEND = joinTargetUrl(BLOG_REF) !== null;

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const a = getArticle(slug);
  if (!a) notFound();

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
          <a className={css.topLink} href="/blog">
            全部筆記
          </a>
        </div>
      </header>

      <article className={css.article}>
        <h1 className={css.h1}>{a.title}</h1>
        <p className={css.meta}>
          <time dateTime={a.updated}>{a.updated}</time>
        </p>
        {a.blocks.map((b, i) => (
          <BlockView key={i} block={b} />
        ))}

        {a.faq.length > 0 && (
          <dl className={css.faq}>
            {a.faq.map((f) => (
              <div key={f.q} className={css.faqItem}>
                <dt className={css.faqQ}>{f.q}</dt>
                <dd className={css.faqA}>{f.a}</dd>
              </div>
            ))}
          </dl>
        )}
      </article>

      <section className={css.cta}>
        <h2 className={css.ctaTitle}>開完的會，別讓決議跟著散掉。</h2>
        <p className={css.ctaSub}>加 LINE 好友就開始，不用註冊、不用留付款資料。</p>
        {HAS_ADD_FRIEND ? (
          <a className={css.ctaBtn} href={joinHref(BLOG_REF)}>
            加 LINE 好友開始用
          </a>
        ) : (
          <a className={css.ctaBtn} href="/">
            回首頁看看
          </a>
        )}
        <p className={css.ctaNote}>
          <a className={css.ctaGhost} href="/demo">
            先看一份真的記錄頁 →
          </a>
        </p>
      </section>

      <footer className={css.footer}>
        <a className={css.footLink} href="/">
          成事所
        </a>
        <span>·</span>
        <a className={css.footLink} href="/blog">
          筆記
        </a>
      </footer>

      {/* FAQPage 結構化資料。Google 從 2023 起只給政府／醫療站顯示摘錄，
          這裡的收益在 AI 問答引擎（AI Overview／ChatGPT／Perplexity）的抽取。 */}
      {a.faq.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd(a.faq)) }}
        />
      )}
    </div>
  );
}

/** 行內：粗體與連結。站內連結用相對路徑，外連才開新視窗。 */
function Spans({ spans }: { spans: Inline[] }) {
  return (
    <>
      {spans.map((s, i) => {
        // soft break 是稿子刻意的斷句，保留成 <br>
        const body = s.text.split("\n").map((t, j, arr) => (
          <span key={j}>
            {t}
            {j < arr.length - 1 && <br />}
          </span>
        ));
        if (s.href) {
          const external = /^https?:\/\//.test(s.href) && !s.href.includes("chengshisuo.com");
          return (
            <a
              key={i}
              className={css.link}
              href={s.href}
              {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              {body}
            </a>
          );
        }
        return s.bold ? <strong key={i}>{body}</strong> : <span key={i}>{body}</span>;
      })}
    </>
  );
}

function BlockView({ block: b }: { block: Block }) {
  switch (b.kind) {
    case "h2":
      return (
        <h2 className={css.h2} id={b.id}>
          {b.text}
        </h2>
      );
    case "h3":
      return (
        <h3 className={css.h3} id={b.id}>
          {b.text}
        </h3>
      );
    case "p":
      return (
        <p className={css.p}>
          <Spans spans={b.spans} />
        </p>
      );
    case "ul":
      return (
        <ul className={css.ul}>
          {b.items.map((it, i) => (
            <li key={i}>
              <Spans spans={it} />
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol className={css.ol}>
          {b.items.map((it, i) => (
            <li key={i}>
              <Spans spans={it} />
            </li>
          ))}
        </ol>
      );
    case "quote":
      return (
        <blockquote className={css.quote}>
          <Spans spans={b.spans} />
        </blockquote>
      );
    case "table":
      // 表格在窄螢幕會撐破版面，橫捲留在自己的框裡——頁面本身永遠不橫捲
      return (
        <div className={css.tableWrap}>
          <table className={css.table}>
            <thead>
              <tr>
                {b.head.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((cell, j) => (
                    <td key={j}>
                      <Spans spans={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return null;
  }
}
