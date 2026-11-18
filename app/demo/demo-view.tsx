"use client";

import { AUDIO_TTL_HOURS } from "@/lib/cleanup";
import { DEMO_MEETING } from "@/lib/demo-meeting";
import { DEMO_REF, joinHref } from "@/lib/join";

import css from "../m/[id]/meeting.module.css";
import { useTextScale } from "../m/[id]/meeting-view";
import { ReadOnlyMeetingBody } from "../m/[id]/read-only-body";

/**
 * 示範記錄頁的畫面。骨架共用 ReadOnlyMeetingBody（issue #21），但資料編譯在
 * 程式裡，沒有載入態、沒有 404 態——這頁永遠開得起來。
 *
 * 沒有匯出區是 issue #14 的「不做」：匯出是加好友之後的事，
 * 這頁唯一想要人做的動作就是頁尾那顆加好友 CTA（ref=demo，跟分享頁分開算）。
 */

export default function DemoView() {
  const textScale = useTextScale();

  return (
    <ReadOnlyMeetingBody
      meeting={DEMO_MEETING}
      textScale={textScale}
      badge="示範記錄頁——你丟一段錄音回來的，就是這樣一頁"
      headerNote={
        /* 只陳述規則、不假裝這頁曾有錄音——示範內容是手寫的（見 lib/demo-meeting.ts） */
        <p className={css.audioGone}>
          這裡不會有錄音檔：所有錄音只保留 {AUDIO_TTL_HOURS} 小時，時間到就真的刪掉。
        </p>
      }
      joinBlock={
        <div className={css.joinBlock}>
          <p className={css.joinLead}>這樣的一頁，是把錄音丟進 LINE 換來的。</p>
          <a className={css.joinCta} href={joinHref(DEMO_REF)}>
            把你的會議也丟給成事所
          </a>
          <p className={css.joinNote}>加 LINE 好友就開始，不用註冊也不用記密碼。</p>
        </div>
      }
    />
  );
}
