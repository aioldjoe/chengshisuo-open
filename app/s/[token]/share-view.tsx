"use client";

import { useEffect, useState } from "react";

import { AUDIO_TTL_HOURS } from "@/lib/cleanup";
import { SHARE_REF, joinHref } from "@/lib/join";

import css from "../../m/[id]/meeting.module.css";
import {
  DownloadSrtButton,
  ExportZone,
  Notice,
  Skeleton,
  useTextScale,
} from "../../m/[id]/meeting-view";
import { ReadOnlyMeetingBody, type ReadOnlyMeeting } from "../../m/[id]/read-only-body";

/**
 * 唯讀分享連結的畫面。骨架共用 ReadOnlyMeetingBody（issue #21），這裡只負責
 * 載入資料與這頁獨有的插槽：SRT 下載、匯出區、加好友 CTA。不掛任何編輯器、
 * 不自動存檔、沒有刪除鍵——拿到連結的人只能看。
 *
 * 頁尾落款上面多一塊加好友 CTA（issue #8）：分享頁的讀者就是下一批用戶，
 * 本人的 app/m/[id] 沒有這塊（他已經是用戶了）。
 */

type State =
  | { phase: "loading" }
  | { phase: "gone" }
  | { phase: "error"; message: string }
  | { phase: "ready"; meeting: ReadOnlyMeeting; audioUrl: string | null };

export default function ShareView({ token }: { token: string }) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const textScale = useTextScale();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/s/${token}`);
        if (cancelled) return;
        if (res.status === 404) return setState({ phase: "gone" });
        if (!res.ok) return setState({ phase: "error", message: `伺服器回應 ${res.status}` });
        const body = (await res.json()) as { meeting: ReadOnlyMeeting; audioUrl: string | null };
        setState({ phase: "ready", meeting: body.meeting, audioUrl: body.audioUrl });
      } catch (e) {
        if (!cancelled) setState({ phase: "error", message: e instanceof Error ? e.message : "未知錯誤" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.phase === "loading") return <Skeleton />;
  if (state.phase === "gone") return <Notice text="找不到這份記錄，分享連結可能已撤銷或到期。" />;
  if (state.phase === "error") return <Notice text={`載入失敗（${state.message}）。重新整理再試。`} />;

  return (
    <ShareBody token={token} meeting={state.meeting} audioUrl={state.audioUrl} textScale={textScale} />
  );
}

function ShareBody({
  token,
  meeting: m,
  audioUrl,
  textScale,
}: {
  /** 匯出網址要用它——分享頁沒有 LINE 身分，token 本身就是憑證。 */
  token: string;
  meeting: ReadOnlyMeeting;
  audioUrl: string | null;
  textScale: ReturnType<typeof useTextScale>;
}) {
  return (
    <ReadOnlyMeetingBody
      meeting={m}
      audioUrl={audioUrl}
      textScale={textScale}
      badge="唯讀分享連結，看得到但改不了"
      headerNote={
        !audioUrl && m.audioKey === null ? (
          <p className={css.audioGone}>錄音已刪除。所有錄音只保留 {AUDIO_TTL_HOURS} 小時。</p>
        ) : undefined
      }
      transcriptAction={(shown) => <DownloadSrtButton turns={shown} m={m} title={m.summary.title} />}
      joinBlock={
        <div className={css.joinBlock}>
          <p className={css.joinLead}>這份記錄，是丟一段錄音來的。</p>
          <a className={css.joinCta} href={joinHref(SHARE_REF)}>
            把你的會議也丟給成事所
          </a>
          <p className={css.joinNote}>加 LINE 好友就開始，零註冊。</p>
        </div>
      }
      footerExtra={
        /* 分享頁的訪客不是客戶：能開這條連結，代表主人已經是付費檔了（開分享本身就是加值），
           兩種匯出都給。這頁是病毒迴路的門面，在這裡上鎖只會擋到潛在客戶。 */
        <ExportZone paid fileUrl={async (format) => `/api/s/${token}/export?format=${format}`} />
      }
    />
  );
}
