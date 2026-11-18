"use client";

import { useEffect, useState } from "react";

import { withExternalBrowser } from "@/lib/browser";
import { PLANS, type PaidPlanId } from "@/lib/plans";

import css from "../m/[id]/meeting.module.css";
import { Notice, Skeleton, loadLiffSdk } from "../m/[id]/meeting-view";

/**
 * 網頁訂閱的 client 流程：LIFF init → getIDToken → POST /api/subscribe 換 Stripe 網址
 * → 導頁。外部瀏覽器沒登入就 liff.login()，回來重跑（同 meeting-view 的守則）。
 *
 * 導頁前網址一律過 withExternalBrowser——3DS 驗證頁在 WKWebView 會卡死，
 * 跟聊天室裡的付款卡同一條規矩；參數只有 LINE 內建瀏覽器認得，其他環境無感，
 * 所以不做 UA 判斷（少一個失手的分支）。
 */

type State =
  | { phase: "working" }
  | { phase: "leaving"; url: string }
  | { phase: "error"; message: string };

export default function SubscribeView({
  plan,
  liffId,
}: {
  plan: PaidPlanId;
  liffId: string | null;
}) {
  const [state, setState] = useState<State>({ phase: "working" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let idToken: string | null = null;
        if (liffId) {
          const liff = await loadLiffSdk();
          await liff.init({ liffId });
          idToken = liff.isLoggedIn() || liff.isInClient() ? liff.getIDToken() : null;
          // 外部瀏覽器沒登入，或登入著但 id token 過期（getIDToken 回 null）——
          // 都重走 liff.login() 換新 token。帶著 code 回來還是拿不到＝登入沒被
          // SDK 接完，再 login 就是無限迴圈，寧可停下來給句話。
          if (!idToken && !liff.isInClient()) {
            if (new URLSearchParams(location.search).has("code")) {
              return setState({ phase: "error", message: "LINE 登入沒接上" });
            }
            liff.login({ redirectUri: location.href });
            return;
          }
        }

        const res = await fetch("/api/subscribe", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(idToken ? { authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ plan }),
        });
        if (cancelled) return;
        if (res.status === 401) return setState({ phase: "error", message: "LINE 登入沒接上" });
        if (!res.ok) return setState({ phase: "error", message: `伺服器回應 ${res.status}` });

        const { url } = (await res.json()) as { url: string };
        const dest = withExternalBrowser(url);
        setState({ phase: "leaving", url: dest });
        location.href = dest;
      } catch (e) {
        if (!cancelled) setState({ phase: "error", message: e instanceof Error ? e.message : "未知錯誤" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [plan, liffId]);

  if (state.phase === "working") return <Skeleton />;
  if (state.phase === "error")
    return (
      <Notice
        text={`付款頁沒開起來（${state.message}）。重新整理再試；或回 LINE 對成事所傳一句「升級」，付款連結會直接送到聊天室。`}
      />
    );

  return (
    <main className={css.page}>
      <div className={css.joinBlock}>
        <p className={css.joinLead}>正在帶你去 Stripe 付款頁——訂閱{PLANS[plan].name}檔。</p>
        <a className={css.joinCta} href={state.url}>
          沒有跳轉的話，點這裡
        </a>
        <p className={css.joinNote}>付款由 Stripe 處理，本站不經手卡號；完成後權益綁定你的 LINE 帳號。</p>
      </div>
    </main>
  );
}
