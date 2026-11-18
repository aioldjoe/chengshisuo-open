import { after } from "next/server";

import { joinRedirect } from "@/lib/join";
import { recordEvent } from "@/lib/store/events";

/**
 * 加好友的中繼跳轉（issue #8）：記一筆點擊再 302 到 LINE 加好友頁。
 * 存在的理由是 line.me 的加好友連結吃不下追蹤參數——不繞這一下，
 * 「從分享頁來的加好友」跟其他來源就分不開。
 *
 * 這裡只認得允許清單裡的 ref（lib/join.ts），沒有第三方 pixel、不記訪客身分：
 * 事件表裡這一列只有時間與來源字串（issue #8 的「不做」）。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { target, ref, countable } = joinRedirect(req.url);

  // 回應送出後才記，跳轉不等量測；recordEvent 自己吞錯誤
  if (countable) after(() => recordEvent("join_clicked", null, ref));

  // no-store：這條路的價值就是每次都經過我們，被快取掉就數不到了
  return new Response(null, {
    status: 302,
    headers: { Location: target, "Cache-Control": "no-store" },
  });
}
