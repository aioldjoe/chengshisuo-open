import { verifyLineIdToken } from "./line-login";

/**
 * API 請求的身分閘門 seam。正式路徑：LIFF 頁端把 liff.getIDToken() 放
 * Authorization: Bearer <idToken>，這裡送 LINE 驗證換 userId。
 * LINE 憑證到位前，本機開發用 DEV_LINE_USER_ID 直通——只在非 production 生效，
 * 部署環境就算誤設了這個 env 也不會開後門。
 */
/**
 * 頁殼該把哪個 LIFF ID 交給 client 閘門元件（app/m/[id]、app/t/[id] 及其 claim 共用）。
 * 本機開發（DEV_LINE_USER_ID）不走 LIFF：回 null，頁端就不帶 token，
 * 由下面 verifyRequestUser 的直通接手。兩邊都卡 NODE_ENV——正式環境誤設也不開後門。
 */
export function liffIdForRequest(): string | null {
  if (process.env.NODE_ENV !== "production" && process.env.DEV_LINE_USER_ID) return null;
  return process.env.NEXT_PUBLIC_LIFF_ID ?? null;
}

/**
 * 網頁端拿不拿得到 LINE 身分：LIFF 已設，或本機 DEV 直通。
 * 首頁定價卡靠它決定付費按鈕指 /subscribe 還是退回預填訊息連結（issue #20）——
 * 沒身分可拿的話，那條路走到一半只會卡在登入，不如不要出現。
 */
export function webIdentityAvailable(): boolean {
  if (process.env.NODE_ENV !== "production" && process.env.DEV_LINE_USER_ID) return true;
  return Boolean(process.env.NEXT_PUBLIC_LIFF_ID);
}

export async function verifyRequestUser(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return verifyLineIdToken(auth.slice(7));
  if (process.env.NODE_ENV !== "production" && process.env.DEV_LINE_USER_ID) {
    return process.env.DEV_LINE_USER_ID;
  }
  return null;
}
