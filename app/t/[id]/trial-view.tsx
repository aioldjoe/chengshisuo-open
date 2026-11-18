"use client";

import { useEffect, useState } from "react";

import { TRIAL_REF, joinHref } from "@/lib/join";

import css from "../../m/[id]/meeting.module.css";
import {
  Notice,
  Skeleton,
  signedQueryFromLocation,
  useTextScale,
} from "../../m/[id]/meeting-view";
import { ReadOnlyMeetingBody, type ReadOnlyMeeting } from "../../m/[id]/read-only-body";

/**
 * 試用記錄頁的畫面（issue #19）。骨架共用 ReadOnlyMeetingBody（issue #21），
 * 但比分享頁更「唯讀」：沒有匯出、沒有 SRT、沒有分享——那些是加好友之後的事，
 * 在試用頁出現就成了贈品，加好友的理由就沒了。
 *
 * 頁尾的 CTA 是這頁存在的目的：24 小時的倒數是實話也是理由，
 * 「加好友把這份存起來」讓加好友從入場費變成留住成果的動作。
 */

type State =
  | { phase: "loading" }
  | { phase: "gone" }
  | { phase: "claimed"; lineUrl: string }
  | { phase: "error"; message: string }
  | { phase: "ready"; meeting: ReadOnlyMeeting; audioUrl: string | null; query: string };

export default function TrialView({ id, liffId }: { id: string; liffId: string | null }) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const textScale = useTextScale();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 網址上的 trial 簽章就是這頁的入場憑證，原封不動轉交 API；沒有就別打了
        const query = signedQueryFromLocation();
        if (!query) return setState({ phase: "gone" });
        const res = await fetch(`/api/trial/${id}?${query}`);
        if (cancelled) return;
        if (res.status === 401 || res.status === 404) return setState({ phase: "gone" });
        if (!res.ok) return setState({ phase: "error", message: `伺服器回應 ${res.status}` });
        const body = (await res.json()) as
          | { claimed: true; lineUrl: string }
          | { claimed: false; meeting: ReadOnlyMeeting; audioUrl: string | null };
        if (body.claimed) return setState({ phase: "claimed", lineUrl: body.lineUrl });
        setState({ phase: "ready", meeting: body.meeting, audioUrl: body.audioUrl, query });
      } catch (e) {
        if (!cancelled) setState({ phase: "error", message: e instanceof Error ? e.message : "未知錯誤" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state.phase === "loading") return <Skeleton />;
  if (state.phase === "gone")
    return (
      <Notice text="這份試用記錄找不到了——試用頁只保留 24 小時。想留得住的記錄，加 LINE 好友傳一場，免費額度每月都有。" />
    );
  if (state.phase === "claimed")
    return (
      <main className={css.page}>
        <div className={css.joinBlock}>
          <p className={css.joinLead}>這份已經存進 LINE 了。</p>
          <a className={css.joinCta} href={state.lineUrl}>
            到 LINE 打開記錄頁
          </a>
          <p className={css.joinNote}>認領後的記錄頁只有本人打得開，這條試用連結功成身退。</p>
        </div>
      </main>
    );
  if (state.phase === "error") return <Notice text={`載入失敗（${state.message}）。重新整理再試。`} />;

  // 認領要有 LINE 身分：正式環境把簽章帶進 LIFF 深連結；本機開發直接走站內路徑
  const claimHref = liffId
    ? `https://liff.line.me/${liffId}/t/${id}/claim?${state.query}`
    : `/t/${id}/claim?${state.query}`;

  return (
    <ReadOnlyMeetingBody
      meeting={state.meeting}
      audioUrl={state.audioUrl}
      textScale={textScale}
      badge="試用記錄頁——24 小時後自動刪除，存進 LINE 就照正式規則保留"
      joinBlock={
        <div className={css.joinBlock}>
          <p className={css.joinLead}>這份記錄 24 小時後會自動刪除。加好友，把它存起來。</p>
          <div className={css.trialSteps}>
            <a className={css.joinCta} href={joinHref(TRIAL_REF)} target="_blank" rel="noreferrer">
              1︎ 加 LINE 好友
            </a>
            <a className={css.trialClaimCta} href={claimHref}>
              2︎ 把這份存進我的 LINE
            </a>
          </div>
          <p className={css.joinNote}>
            存起來就照正式規則保留；之後完整長度的會議，直接傳進同一個聊天室。
          </p>
        </div>
      }
    />
  );
}
