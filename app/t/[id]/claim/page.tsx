import type { Metadata } from "next";
import { liffIdForRequest } from "@/lib/auth";

import ClaimView from "./claim-view";

/**
 * 認領試用場次的落點（issue #19）。試用頁的第二步把人帶進 LIFF 到這裡：
 * LIFF 給身分、網址上的 trial 簽章給資格，POST /api/trial/[id]/claim 換 userId。
 */

export const dynamic = "force-dynamic";

/**
 * 不給搜尋引擎收錄。用 noindex meta 而不是 robots.txt 的 disallow：
 * disallow 只擋爬，擋不住「有外連時把網址本身列進索引」——見 app/robots.ts。
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };


export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClaimView id={id} liffId={liffIdForRequest()} />;
}
