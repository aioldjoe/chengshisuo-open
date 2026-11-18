import crypto from "node:crypto";

import { audioDurationSeconds } from "../audio/duration";
import { AUDIO_TTL_HOURS } from "../cleanup";
import { standingFor, upsellLinks, verdictFor } from "../billing";
import { meetingReadyFlex, paymentCardFlex, taipeiDateLabel } from "../flex";
import { getMessageContent, pushFlexOrText, pushText } from "../line";
import { PLANS } from "../plans";
import { recordEvent } from "../store/events";
import { getRepo } from "../store/meetings";
import { hasR2, putObject } from "../store/r2";
import { transcribe } from "../stt/scribe";
import { failureText, quotaBlockedLead, quotaBlockedText } from "../upsell";
import { meetingPageUrl } from "../urls";
import { correctTurns } from "./correct";
import { extractSummary } from "./extract";
import type { Meeting, MeetingSummary, TranscriptTurn } from "../types";

/**
 * 主 pipeline：下載 → 存音檔（R2）→ 轉寫（Scribe）→ LLM 校正 → 重點抽取 → 落庫 → push 連結。
 * 由 webhook 以 after() 呼叫（先 reply 再慢慢做）；失敗時 push 道歉訊息，不留無聲黑洞。
 */

/**
 * 轉寫之後的兩段（LLM 校正 → 重點抽取），LINE 主線與首頁試用（issue #19）共用。
 * 兩端的閘門與收尾各自不同，但這段必須同一份——之後加步驟（新的校正 pass 之類）
 * 才不會只有一條路跟上。
 */
export async function summarizeTurns(
  turns: TranscriptTurn[],
): Promise<{ turns: TranscriptTurn[]; summary: MeetingSummary }> {
  const corrected = await correctTurns(turns);
  const summary = await extractSummary(corrected.turns);
  return { turns: corrected.turns, summary };
}

export async function processMeeting(input: {
  userId: string;
  messageId: string;
  filename: string;
}): Promise<void> {
  const { userId, messageId, filename } = input;
  try {
    // LINE 不承諾內容保留期——第一步就是把音檔抓下來
    const { data, contentType } = await getMessageContent(messageId);

    // 額度閘門第二遍：webhook 那遍只有原生語音量得到時長，分享進來的檔案要下載後才知道。
    // 擋在這裡就停——不存 R2、不進 Scribe，一毛轉寫費都不花。
    const standing = await standingFor(userId);
    const durationS = audioDurationSeconds(data);
    const verdict = verdictFor(standing, durationS);
    if (!verdict.ok) {
      const links = await upsellLinks(standing, userId);
      const periodEnd = standing.subscription?.currentPeriodEnd ?? null;
      const fallback = quotaBlockedText(standing.plan, verdict.reason, durationS, links, periodEnd);
      const card = paymentCardFlex(standing.plan, links);
      await pushFlexOrText(
        userId,
        card
          ? [{ type: "text", text: quotaBlockedLead(standing.plan, verdict.reason, durationS, periodEnd) }, card]
          : null,
        fallback,
      );
      return;
    }

    const id = crypto.randomUUID();
    let audioKey: string | null = null;
    if (hasR2()) {
      audioKey = `audio/${id}/${filename}`;
      await putObject(audioKey, data, contentType);
    }

    const { turns, language, durationLabel, durationSeconds } = await transcribe(
      data,
      filename,
      contentType,
    );
    const { turns: correctedTurns, summary } = await summarizeTurns(turns);

    const now = new Date();
    // 記錄頁保留天數由方案決定；付費是永久（expiresAt null，cron 掃不到它）。
    // 之後降回免費檔的話，cron 會用 pageDays 追認到期日（見 app/api/cron/cleanup）。
    const pageDays = PLANS[standing.plan].pageDays;
    const meeting: Meeting = {
      id,
      userId,
      createdAt: now.toISOString(),
      filename,
      language,
      durationLabel,
      // 轉寫回來的時長最準（涵蓋所有格式）；容器解析不出來時退回下載時量到的
      durationSeconds: durationSeconds ?? durationS,
      turns: correctedTurns,
      summary,
      speakerNames: {},
      audioKey,
      expiresAt: pageDays === null ? null : new Date(now.getTime() + pageDays * 86400_000).toISOString(),
      shareToken: null,
    };
    await getRepo().save(meeting);
    // 量測事件與內容分家：會議 30 天後真刪，這筆留著回答留存（lib/store/events.ts）。
    // 帶場次 id 是為了「刪除全部資料」認得回來——事件表不存內容，id 不是內容。
    await recordEvent("meeting_created", userId, id);

    // 完成通知是產品的高光時刻、也最會被截圖轉傳——出卡不出裸連結（issue #17）
    await pushFlexOrText(
      userId,
      [
        meetingReadyFlex({
          title: summary.title,
          dateLabel: taipeiDateLabel(meeting.createdAt),
          durationSeconds: meeting.durationSeconds ?? null,
          highlights: summary.highlights,
          url: meetingPageUrl(id),
          pageDays,
        }),
      ],
      `「${summary.title}」整理好了 ✦\n${meetingPageUrl(id)}\n\n${
        pageDays === null ? "記錄頁永久保留" : `記錄頁保留 ${pageDays} 天`
      }；錄音檔 ${AUDIO_TTL_HOURS} 小時後自動銷毀。`,
    );
  } catch (e) {
    console.error("[pipeline] 處理失敗", { messageId, filename }, e);
    await pushText(userId, [failureText(e)]).catch(() => {});
  }
}
