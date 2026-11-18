import { cleanupAction } from "@/lib/cleanup";
import { PLANS, type PlanId } from "@/lib/plans";
import { getRepo } from "@/lib/store/meetings";
import { deleteObject, hasR2 } from "@/lib/store/r2";
import { entitledPlanForUser } from "@/lib/billing";

/**
 * 每日清理（vercel.json cron）：
 * 1. 音檔銷毀——建立超過 72 小時的音檔從 R2 真刪（所有方案一律如此，隱私賣點）。
 * 2. 記錄頁到期——過了 expiresAt（免費 30 天）的會議整筆刪除；付費用戶的改成永久保留，
 *    降回免費檔的則重新上到期日（不然不付錢也永久保留）。
 *
 * 決策本身是純函式（lib/cleanup.ts），這裡只負責執行與 I/O。
 */

export const runtime = "nodejs";

export async function GET(req: Request) {
  // Vercel cron 會帶 authorization: Bearer $CRON_SECRET；設了就驗，沒設（本機）放行。
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }

  const repo = getRepo();
  const now = Date.now();
  let audioDeleted = 0;
  let pagesDeleted = 0;
  let pagesKept = 0;
  let pagesReExpired = 0;

  // 一次掃過通常涵蓋同一批人的多場會議——方案查一次就好
  const plans = new Map<string, PlanId>();
  const planOf = async (userId: string): Promise<PlanId> => {
    let p = plans.get(userId);
    if (!p) {
      p = await entitledPlanForUser(userId);
      plans.set(userId, p);
    }
    return p;
  };

  for (const m of await repo.list()) {
    switch (cleanupAction(m, await planOf(m.userId), now)) {
      case "delete-page":
        if (m.audioKey && hasR2()) await deleteObject(m.audioKey).catch(console.error);
        await repo.delete(m.id);
        pagesDeleted++;
        break;
      case "make-permanent":
        await repo.save({ ...m, expiresAt: null });
        pagesKept++;
        break;
      case "make-expiring":
        await repo.save({
          ...m,
          expiresAt: new Date(now + PLANS.free.pageDays! * 86400_000).toISOString(),
        });
        pagesReExpired++;
        break;
      case "delete-audio":
        if (hasR2()) await deleteObject(m.audioKey!).catch(console.error);
        await repo.save({ ...m, audioKey: null });
        audioDeleted++;
        break;
      case "keep":
        break;
    }
  }

  return Response.json({ ok: true, audioDeleted, pagesDeleted, pagesKept, pagesReExpired });
}
