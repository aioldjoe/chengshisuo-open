import { randomBytes } from "node:crypto";

/** 分享連結的 token：夠長猜不到，URL-safe 不用再編碼。 */
export function generateShareToken(): string {
  return randomBytes(18).toString("base64url");
}
