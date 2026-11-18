import type { PlanId } from "./plans";
import type { Meeting } from "./types";

/**
 * 每日清理要對某一場做什麼。純函式——真正的刪除在 app/api/cron/cleanup。
 *
 * 兩條規則的優先序：整筆刪 > 銷毀音檔（整筆刪的時候音檔一起走，不必分兩步）。
 * 付費用戶的記錄頁永久保留，但到期日是「落庫當下」寫死的——免費時期存的場次
 * 帶著 30 天的到期日，升級後不追認的話會在使用者眼前消失。所以這裡不是「跳過」
 * 而是 make-permanent：掃到就把到期日清掉，之後也不必再判斷一次。
 */

/**
 * 音檔留存時長。這是對外的承諾數字（GLOSSARY.md「音檔銷毀」），
 * 產品裡每一處算音檔還在不在的地方都從這裡讀，別再各自寫一份。
 */
export const AUDIO_TTL_MS = 72 * 3600_000;

/** 給文案用的同一個數字——承諾寫在畫面上，別讓它跟真正的銷毀時間走散。 */
export const AUDIO_TTL_HOURS = AUDIO_TTL_MS / 3600_000;

export type CleanupAction =
  | "delete-page"
  | "make-permanent"
  | "make-expiring"
  | "delete-audio"
  | "keep";

export function cleanupAction(m: Meeting, plan: PlanId, now: number): CleanupAction {
  if (m.expiresAt && Date.parse(m.expiresAt) < now) {
    return plan === "free" ? "delete-page" : "make-permanent";
  }
  // 音檔銷毀排在補到期日之前：72 小時真刪是對所有人的承諾（GLOSSARY.md「音檔銷毀」），
  // 一次只做一件事的話，該被延到明天的是補到期日，不是它。
  if (m.audioKey && Date.parse(m.createdAt) + AUDIO_TTL_MS < now) return "delete-audio";
  if (m.expiresAt === null && plan === "free") {
    // 付費期間存的頁沒有到期日；人退回免費檔後不重新上鎖的話，不付錢也永久保留。
    // 上的是「從現在起 30 天」而不是「建立起 30 天」：後者會在取消的隔天把幾個月的
    // 記錄一次抹掉，等於用刪資料懲罰退訂。給滿一個免費檔的保留期，要留的自己匯出。
    return "make-expiring";
  }
  return "keep";
}
