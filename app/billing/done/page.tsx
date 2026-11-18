import type { Metadata } from "next";
import { joinTargetUrl } from "@/lib/join";

import css from "../../home.module.css";

/**
 * 付款流程的回跳頁。Stripe Checkout 開在外部瀏覽器，付完人會落在這裡——
 * 這頁的唯一任務是把人送回 LINE，權益的開通由 webhook 負責（見 app/api/stripe/webhook）。
 *
 * 刻意不在這裡查訂閱狀態：回跳的當下 webhook 可能還沒到，查了只會顯示「還沒開通」
 * 嚇到剛付完錢的人。回 LINE 傳一句「額度」就看得到，而且開通時我們會主動推播。
 *
 * ?via=web 是網頁直接訂閱那條路（issue #20）來的：先收錢、再加好友——
 * 這裡的人可能還不是好友，「回到聊天室」對他是一扇不存在的門，
 * 加好友才是此刻該做的事（權益已綁定 LINE 帳號，加了通知才進得來）。
 */

export const dynamic = "force-dynamic";

/**
 * 不給搜尋引擎收錄。用 noindex meta 而不是 robots.txt 的 disallow：
 * disallow 只擋爬，擋不住「有外連時把網址本身列進索引」——見 app/robots.ts。
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };


const BACK_TO_LINE = joinTargetUrl(null);

export default async function BillingDone({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const ok = params.ok !== "0";
  const viaWeb = params.via === "web";

  // ok × via 的四種結局一次算齊——文案與 CTA 綁在一起，不會改了文案漏了按鈕
  const line = BACK_TO_LINE ? { href: BACK_TO_LINE } : null;
  const view = ok
    ? viaWeb
      ? {
          sub: "訂閱已綁定你的 LINE 帳號。最後一步：加成事所好友——開通通知會發到聊天室（通常幾秒內），之後錄音也是從那裡傳進來。",
          cta: line && { ...line, label: "加 LINE 好友" },
        }
      : {
          sub: "訂閱開通後我會在 LINE 通知你（通常幾秒內）。回到聊天室，把錄音傳進來就行——想確認用量隨時傳一句「額度」。",
          cta: line && { ...line, label: "回到 LINE" },
        }
    : viaWeb
      ? {
          sub: "沒有扣款，也沒有任何改變。想再試一次的話，回定價頁重新點一次就行。",
          cta: { href: "/", label: "回定價頁" },
        }
      : {
          sub: "沒有扣款，也沒有任何改變。想再試一次的話，回 LINE 傳一句「升級」，我會再發一次付款連結。",
          cta: line && { ...line, label: "回到 LINE" },
        };

  return (
    <div className={css.wrap}>
      <section className={css.hero}>
        <div>
          <h1 className={css.h1}>{ok ? "收到了，謝謝 ✦" : "沒有完成付款"}</h1>
          <p className={css.sub}>{view.sub}</p>
          {view.cta && (
            <div className={css.ctaRow}>
              <a className={css.cta} href={view.cta.href}>
                {view.cta.label}
              </a>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
