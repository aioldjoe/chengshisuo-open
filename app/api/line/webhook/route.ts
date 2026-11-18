import { after } from "next/server";

import { portalUrlFor, standingFor, upsellLinks, verdictFor } from "@/lib/billing";
import { withExternalBrowser } from "@/lib/browser";
import { paymentCardFlex, usageCardFlex } from "@/lib/flex";
import {
  verifySignature,
  replyFlex,
  replyFlexOrText,
  replyText,
  type LineWebhookEvent,
  type OutgoingMessage,
} from "@/lib/line";
import { HOWTO_GUIDE, welcomeMessages } from "@/lib/onboarding";
import { processMeeting } from "@/lib/pipeline";
import { PLANS } from "@/lib/plans";
import { DELETE_ALL_CONFIRM_PHRASE, route } from "@/lib/routing";
import { getRepo } from "@/lib/store/meetings";
import { purgeAllForUser } from "@/lib/store/purge";
import { quotaBlockedLead, quotaBlockedText, upgradeText, usageText } from "@/lib/upsell";
import { demoPageUrl } from "@/lib/urls";

/**
 * LINE webhook。收到錄音先 reply「收到」（免費、即時），
 * 重活丟給 after()（回應送出後才跑）；完成由 pipeline push 連結。
 * 佇列服務（Inngest/QStash 類）等音檔時長撐爆 maxDuration 再上，介面不變。
 *
 * 額度閘門在這裡跑第一遍：原生語音自帶時長，超限連下載都省了。
 * 分享進來的檔案量不到時長，pipeline 下載後會用真時長再驗一次（見 lib/pipeline）。
 */

export const runtime = "nodejs";
export const maxDuration = 300;

const TEXT_GUIDE =
  "把會議錄音傳給我（iPhone 語音備忘錄分享到 LINE、或直接按住麥克風錄），幾分鐘後我把整理好的會議記錄頁連結傳給你 ✦";
const DECLINE = "我只聽得懂錄音 🙏 把會議的音檔傳給我，其他的檔案和圖片我都不收。";

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-line-signature"))) {
    return new Response("bad signature", { status: 401 });
  }

  const body = JSON.parse(raw) as { events?: LineWebhookEvent[] };
  for (const ev of body.events ?? []) {
    // 加好友（含解除封鎖）→ 歡迎訊息＋Quick Reply（issue #18）。
    // 前提：LINE OA 後台的預設歡迎訊息要關掉，不然新朋友會收到兩份（見 setup-deploy.sh）。
    if (ev.type === "follow") {
      if (ev.source.type === "user" && ev.source.userId) {
        await replyFlex(ev.replyToken, welcomeMessages());
      }
      continue;
    }
    if (ev.type !== "message") continue;
    const r = route(ev, { unlockCode: process.env.QUOTA_UNLOCK_CODE });
    switch (r.kind) {
      case "meeting-audio": {
        const userId = ev.source.userId!;
        const standing = await standingFor(userId);
        const verdict = verdictFor(standing, r.durationSeconds);
        if (!verdict.ok) {
          // 撞牆一律給出路（付款連結／恢復時間），不做靜默拒收——見 lib/upsell.ts
          const links = await upsellLinks(standing, userId);
          const periodEnd = standing.subscription?.currentPeriodEnd ?? null;
          const card = paymentCardFlex(standing.plan, links);
          const fallback = quotaBlockedText(
            standing.plan,
            verdict.reason,
            r.durationSeconds,
            links,
            periodEnd,
          );
          // 說明段用文字、付款用卡——連結只出現在卡的按鈕上，不再是裸的 URL
          const lead = quotaBlockedLead(standing.plan, verdict.reason, r.durationSeconds, periodEnd);
          await replyFlexOrText(
            ev.replyToken,
            card ? [{ type: "text", text: lead }, card] : null,
            fallback,
          );
          break;
        }
        await replyText(ev.replyToken, [
          "收到！正在整理這場會議，完成後把記錄頁連結傳給你（通常幾分鐘內）⏳",
        ]);
        const job = { userId, messageId: r.messageId, filename: r.filename };
        after(() => processMeeting(job));
        break;
      }
      case "upgrade": {
        const userId = ev.source.userId!;
        const standing = await standingFor(userId);
        const [links, portal] = await Promise.all([
          upsellLinks(standing, userId),
          portalUrlFor(standing),
        ]);
        // 卡出不了（標準檔沒得升、Stripe 沒接好）就走純文字——那版本來就把這兩種情況講清楚了。
        // portal 也逼外部瀏覽器：換卡可能觸發 3DS，跟 Checkout 同一個 WKWebView 的坑
        const card = paymentCardFlex(standing.plan, links, r.want);
        const messages: OutgoingMessage[] | null = card
          ? [
              card,
              ...(portal
                ? [
                    {
                      type: "text" as const,
                      text: `管理訂閱（換檔／換卡／取消）：\n${withExternalBrowser(portal)}`,
                    },
                  ]
                : []),
            ]
          : null;
        await replyFlexOrText(ev.replyToken, messages, upgradeText(standing.plan, links, portal, r.want));
        break;
      }
      case "usage": {
        const userId = ev.source.userId!;
        const standing = await standingFor(userId);
        const [links, portal] = await Promise.all([
          upsellLinks(standing, userId),
          portalUrlFor(standing),
        ]);
        if (standing.unlimited) {
          await replyText(ev.replyToken, ["你的帳號目前不受每月額度限制 ✦ 錄音直接傳過來就行。"]);
          break;
        }
        const periodEnd = standing.subscription?.currentPeriodEnd ?? null;
        await replyFlexOrText(
          ev.replyToken,
          [usageCardFlex(standing.plan, standing.usage, periodEnd, portal)],
          usageText(standing.plan, standing.usage, links, portal, periodEnd),
        );
        break;
      }
      case "demo":
        // 首頁 QR 預填「看範例」就落在這裡（issue #15）：掃碼加好友後的第一次
        // 互動，回的是產品本身——一份真的記錄頁，順手教下一步怎麼開工
        await replyText(ev.replyToken, [
          `這是一份真的記錄頁，開完會你收到的就長這樣：\n${demoPageUrl()}\n\n想要自己的：把會議錄音傳給我（iPhone 語音備忘錄分享進來、或按住麥克風直接錄），幾分鐘後記錄頁連結就送到 ✦`,
        ]);
        break;
      case "howto":
        // 圖文選單「怎麼傳錄音」那格落在這裡——回教學，不只回一句通用說明
        await replyText(ev.replyToken, [HOWTO_GUIDE]);
        break;
      case "unlock":
        // 解鎖碼對了：這個 LINE 帳號從此不受每月額度限制（落庫，換機重登也算）
        await getRepo().setUnlimited(ev.source.userId!);
        await replyText(ev.replyToken, [
          `解鎖了 ✦ 這個帳號之後不受每月 ${PLANS.free.monthlyMeetings} 場的限制，錄音直接傳過來就行。`,
        ]);
        break;
      case "delete-all-request": {
        // 無狀態二次確認：這裡只說明後果，打出確認短語（完全一致）才真的執行
        const n = (await getRepo().listForUser(ev.source.userId!)).length;
        await replyText(ev.replyToken, [
          n === 0
            ? "你目前沒有任何資料——沒有會議記錄，也沒有音檔。"
            : `你目前有 ${n} 場會議記錄。要全部刪除的話，請回覆「${DELETE_ALL_CONFIRM_PHRASE}」四個字——刪除是真刪，記錄頁與音檔都會立刻消失、無法復原。`,
        ]);
        break;
      }
      case "delete-all-confirm": {
        const n = await purgeAllForUser(ev.source.userId!);
        await replyText(ev.replyToken, [
          n === 0
            ? "你目前沒有任何資料，不用刪 🙂"
            : `已刪除你的全部資料（${n} 場會議的記錄頁與音檔）。需要時隨時再把錄音傳給我。`,
        ]);
        break;
      }
      case "text":
        await replyText(ev.replyToken, [TEXT_GUIDE]);
        break;
      case "decline":
        await replyText(ev.replyToken, [DECLINE]);
        break;
      case "ignore":
        break;
    }
  }

  return Response.json({ ok: true });
}
