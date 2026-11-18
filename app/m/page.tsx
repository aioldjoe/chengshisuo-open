import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { resolveLiffState } from "@/lib/liff-state";

/**
 * /m 本身沒有內容——它存在是為了 LIFF Endpoint URL 填成 …/m 也能通：
 * LINE 會先開 /m?liff.state=/m/{id}，這裡直接轉去 /m/{id}。
 * 沒帶 liff.state 就回首頁，不留一個 404。
 */
export const dynamic = "force-dynamic";

/**
 * 不給搜尋引擎收錄。用 noindex meta 而不是 robots.txt 的 disallow：
 * disallow 只擋爬，擋不住「有外連時把網址本身列進索引」——見 app/robots.ts。
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };


export default async function MeetingIndex({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const target = resolveLiffState(await searchParams);
  redirect(target ?? "/");
}
