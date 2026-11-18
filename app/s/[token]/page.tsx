import type { Metadata } from "next";
import ShareView from "./share-view";

/**
 * 唯讀分享連結的頁殼。不吃 LIFF，token 本身就是憑證——
 * 對照 app/m/[id]/page.tsx 的身分閘門版本。
 */

export const dynamic = "force-dynamic";

/**
 * 不給搜尋引擎收錄。用 noindex meta 而不是 robots.txt 的 disallow：
 * disallow 只擋爬，擋不住「有外連時把網址本身列進索引」——見 app/robots.ts。
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };


export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ShareView token={token} />;
}
