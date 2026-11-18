import crypto from "node:crypto";

/**
 * 試用（issue #19）的 server-only 純函式。跟 lib/trial.ts 分家的理由：
 * 這裡用 node:crypto，client（首頁上傳區）不能 import。
 */

/**
 * IP 的假名。IPv4 空間小，裸 sha256 擋不住彩虹表——用 channel secret 推導的
 * 金鑰做 HMAC（同 lib/export-url.ts 的手法，用途字串隔離）。這個值只當
 * 「一天一場」的鑰匙，跟著會議 24 小時後真刪，不進事件表。
 */
export function ipHash(ip: string): string {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) throw new Error("缺 LINE_CHANNEL_SECRET，無法建立試用場次");
  const key = crypto.createHmac("sha256", secret).update("chengshisuo:trial-ip").digest();
  return crypto.createHmac("sha256", key).update(ip).digest("hex");
}

/** Vercel 把真實來源放 x-forwarded-for 第一段；本機開發沒有這些頭，統一算一個人。 */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}

/** R2 key 用的檔名：只留副檔名，其餘丟掉——原始檔名是使用者給的，不進 key。 */
export function safeExt(filename: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(filename);
  return m ? `.${m[1].toLowerCase()}` : "";
}
