"use client";

import { useEffect, useState } from "react";

import css from "../../../m/[id]/meeting.module.css";
import { Notice, Skeleton, loadLiffSdk, signedQueryFromLocation } from "../../../m/[id]/meeting-view";

/**
 * 認領試用場次的 client 流程：LIFF init → getIDToken → 帶簽章 POST claim。
 * 成功後給一顆「打開記錄頁」——不自動跳轉，LIFF 的登入回跳已經夠多驚喜了，
 * 這一步讓人親眼看到「存好了」再走。
 */

type State =
  | { phase: "working" }
  | { phase: "done" }
  | { phase: "gone" }
  | { phase: "error"; message: string };

export default function ClaimView({ id, liffId }: { id: string; liffId: string | null }) {
  const [state, setState] = useState<State>({ phase: "working" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const query = signedQueryFromLocation();
        if (!query) {
          return setState({ phase: "error", message: "連結不完整，回試用頁再點一次「存進我的 LINE」" });
        }

        let idToken: string | null = null;
        if (liffId) {
          const liff = await loadLiffSdk();
          await liff.init({ liffId });
          // 外部瀏覽器且未登入：轉去 LINE 登入，回來會重跑這段（同 meeting-view 的守則）
          if (!liff.isLoggedIn() && !liff.isInClient()) {
            if (new URLSearchParams(location.search).has("code")) {
              return setState({ phase: "error", message: "LINE 登入沒接上" });
            }
            liff.login({ redirectUri: location.href });
            return;
          }
          idToken = liff.getIDToken();
        }

        const res = await fetch(`/api/trial/${id}/claim?${query}`, {
          method: "POST",
          headers: idToken ? { authorization: `Bearer ${idToken}` } : {},
        });
        if (cancelled) return;
        if (res.status === 404) return setState({ phase: "gone" });
        if (!res.ok) return setState({ phase: "error", message: `伺服器回應 ${res.status}` });
        setState({ phase: "done" });
      } catch (e) {
        if (!cancelled) setState({ phase: "error", message: e instanceof Error ? e.message : "未知錯誤" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, liffId]);

  if (state.phase === "working") return <Skeleton />;
  if (state.phase === "gone")
    return (
      <Notice text="這份試用記錄找不到了——可能已過 24 小時，或已被別的帳號認領。想留得住的記錄，加 LINE 好友傳一場。" />
    );
  if (state.phase === "error")
    return <Notice text={`認領失敗（${state.message}）。重新整理再試。`} />;

  return (
    <main className={css.page}>
      <div className={css.joinBlock}>
        <p className={css.joinLead}>存好了。這份記錄從現在起是你的。</p>
        <a className={css.joinCta} href={`/m/${id}`}>
          打開記錄頁
        </a>
        <p className={css.joinNote}>
          聊天室也補了一張完成卡；之後完整長度的會議，直接把錄音傳給成事所就行。
        </p>
      </div>
    </main>
  );
}
