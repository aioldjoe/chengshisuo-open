import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { liffIdForRequest, webIdentityAvailable } from "@/lib/auth";
import { upgradeTargetUrl } from "@/lib/join";
import { hasStripe } from "@/lib/stripe";
import { parsePlanParam } from "@/lib/subscribe";

import SubscribeView from "./subscribe-view";

/**
 * 網頁直接訂閱的入口（issue #20）：LINE Login 拿身分 → Stripe Checkout，
 * 先收錢再加好友。這頁只是過場——真正的工作在 client（subscribe-view）與
 * /api/subscribe；人最後落在 Stripe，付完回 /billing/done?via=web。
 *
 * 沒就緒（LIFF 或 Stripe 缺一）就把人轉去 #16 的預填訊息連結——
 * 首頁的按鈕這時本來就不會指過來，這裡擋的是書籤與舊連結，不要出現壞掉的路。
 */

export const dynamic = "force-dynamic";

/**
 * 不給搜尋引擎收錄。用 noindex meta 而不是 robots.txt 的 disallow：
 * disallow 只擋爬，擋不住「有外連時把網址本身列進索引」——見 app/robots.ts。
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };


export default async function SubscribePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const plan = parsePlanParam((await searchParams).plan);
  if (!plan) redirect("/");
  if (!webIdentityAvailable() || !hasStripe()) redirect(upgradeTargetUrl(plan) ?? "/");

  return <SubscribeView plan={plan} liffId={liffIdForRequest()} />;
}
