import type { Metadata } from "next";
import { liffIdForRequest } from "@/lib/auth";

import TrialView from "./trial-view";

/**
 * 試用記錄頁殼（issue #19）。不吃 LIFF——網址上的 trial 簽章（?e=&s=）
 * 就是憑證，驗章與資料都在 GET /api/trial/[id]。
 * liffId 只拿來組「認領」連結（換 userId 得有 LINE 身分，見 lib/auth.ts）。
 */

export const dynamic = "force-dynamic";

/**
 * 不給搜尋引擎收錄。用 noindex meta 而不是 robots.txt 的 disallow：
 * disallow 只擋爬，擋不住「有外連時把網址本身列進索引」——見 app/robots.ts。
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };


export default async function TrialPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TrialView id={id} liffId={liffIdForRequest()} />;
}
