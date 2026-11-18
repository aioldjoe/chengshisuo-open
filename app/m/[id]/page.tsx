import type { Metadata } from "next";
import { liffIdForRequest } from "@/lib/auth";

import MeetingView from "./meeting-view";

/**
 * 記錄頁殼。資料與授權全在 GET /api/m/[id]（LIFF id token 驗證），
 * 這裡只把 id 與 LIFF ID 交給 client 閘門元件——server 端不再直讀 repo，
 * 沒有身分就什麼都看不到。本機開發的 LIFF 直通規則見 lib/auth.ts liffIdForRequest。
 */

export const dynamic = "force-dynamic";

/**
 * 不給搜尋引擎收錄。用 noindex meta 而不是 robots.txt 的 disallow：
 * disallow 只擋爬，擋不住「有外連時把網址本身列進索引」——見 app/robots.ts。
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };


export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MeetingView id={id} liffId={liffIdForRequest()} />;
}
