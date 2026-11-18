import { deleteEventsForMeetings, deleteEventsForUser } from "./events";
import { getRepo } from "./meetings";
import { deleteObject, hasR2 } from "./r2";
import type { Meeting } from "../types";

/**
 * 真刪（GLOSSARY.md「記錄頁保留」）：音檔（R2 物件）與會議紀錄一起消失，不是軟刪除。
 * R2 先刪再刪紀錄——反過來若中途失敗，音檔會變成沒人記得的孤兒，72h cron 也掃不到它。
 */

export async function purgeMeeting(m: Meeting): Promise<void> {
  if (m.audioKey && hasR2()) await deleteObject(m.audioKey);
  await getRepo().delete(m.id);
}

/** LINE「一句話刪除全部資料」的執行端。回傳刪掉的場數（回覆文案用）。 */
export async function purgeAllForUser(userId: string): Promise<number> {
  const mine = await getRepo().listForUser(userId);
  for (const m of mine) await purgeMeeting(m);
  // 量測事件平常刻意活過真刪（lib/store/events.ts），但「全部資料」就是全部
  await deleteEventsForUser(userId);
  // 分享開啟事件沒有主人（不記訪客），只有場次 id 指得回他——別留下孤兒列
  await deleteEventsForMeetings(mine.map((m) => m.id));
  // 訂閱列刻意留著：那是還在生效的合約，不是內容。清掉會讓人繼續被 Stripe 收錢
  // 卻掉回免費額度——要停的是訂閱本身（LINE 裡傳「訂閱」拿管理連結）。
  return mine.length;
}
