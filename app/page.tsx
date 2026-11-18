import { redirect } from "next/navigation";

import { AUDIO_TTL_HOURS } from "@/lib/cleanup";
import { webIdentityAvailable } from "@/lib/auth";
import { joinTargetUrl, oaMessageUrl, upgradeTargetUrl } from "@/lib/join";
import { resolveLiffState } from "@/lib/liff-state";
import { PLANS, type PaidPlanId } from "@/lib/plans";
import { qrEncode, qrSvgPath } from "@/lib/qr";
import { DEMO_PREFILL_MESSAGE } from "@/lib/routing";
import { hasStripe } from "@/lib/stripe";
import { upgradeHref } from "@/lib/subscribe";

import css from "./home.module.css";
import { ThemeToggle } from "./theme-toggle";
import TrialUpload from "./trial-upload";

/**
 * 首頁落地頁。它是加好友前的第一印象，也是敲門磚的門面。
 * 結構：hero（一句話＋記錄頁縮影當證據）→ 三步 → 隱私 → 定價；敲門磚只剩頁尾一行。
 * 唯一的動作是「加 LINE 好友」——零註冊的產品，首頁也只該有一件事要做。
 *
 * 它同時是 LIFF 的 Endpoint URL：LINE 開深連結會先落到這裡並帶 ?liff.state=/m/{id}，
 * 伺服器端直接轉走（見 lib/liff-state.ts），一般人開首頁不受影響。
 */

// 加好友網址只有一種組法（lib/join.ts）；首頁不帶來源標記，直接跳，不繞 /join
const ADD_FRIEND_URL = joinTargetUrl(null);

// 桌機 QR（issue #15）：掃完進聊天室、輸入框預填「看範例」，按送出就有回應。
// 網址與圖都從 env 長出來（lib/join.ts ＋ lib/qr.ts），換 OA 帳號不用換圖；
// 沒設 OA ID 就整塊不渲染，跟上面 ctaNote 的退路一致
const QR_TARGET = oaMessageUrl(DEMO_PREFILL_MESSAGE);
const QR = QR_TARGET ? qrEncode(QR_TARGET) : null;

/**
 * 定價卡的文案。數字一律讀 PLANS（lib/plans.ts）——改價格只改方案表，
 * 這裡只放「表格說不出來的那句話」。
 *
 * 三張卡各一顆按鈕（issue #16）。付費按鈕的去向分兩層退路（issue #20）：
 * LIFF 與 Stripe 都就緒時指 /subscribe——LINE Login 拿身分直達 Checkout，
 * 先收錢再加好友；沒就緒退回 oaMessage 深連結（進聊天室、「升級○○檔」已預填）；
 * 連 OA ID 都沒設就只剩 fallback 那行敘述文字，跟 hero 的 ctaNote 同一個退路。
 */
const WEB_SUBSCRIBE_READY = hasStripe() && webIdentityAvailable();

/** 付費卡的按鈕去向與說明。href 為 null 時退回 fallback 文字。 */
function payButton(plan: PaidPlanId, note: { web: string; prefill: string }) {
  return {
    href: upgradeHref(plan, { webReady: WEB_SUBSCRIBE_READY, prefillUrl: upgradeTargetUrl(plan) }),
    note: WEB_SUBSCRIBE_READY ? note.web : note.prefill,
  };
}

const PLAN_CARDS = [
  {
    id: "free" as const,
    featured: false,
    quota: `每月 ${PLANS.free.monthlyMeetings} 場`,
    features: ["單場上限 1 小時", `記錄頁保留 ${PLANS.free.pageDays} 天`, "Word 匯出"],
    href: ADD_FRIEND_URL,
    cta: "免費開始用",
    note: "加好友就開始，不用留付款資料",
    fallback: "加好友就開始，不用留付款資料",
  },
  {
    id: "lite" as const,
    featured: true,
    quota: `每月 ${PLANS.lite.monthlyHours} 小時`,
    features: ["單場不限長", "記錄頁永久保留", "Word ＋ PDF 匯出、分享連結"],
    ...payButton("lite", {
      web: "用 LINE 登入後直接刷卡，先訂閱、再加好友也行",
      prefill: "點了開 LINE，訊息幫你打好——送出就收到付款連結",
    }),
    cta: "訂閱輕量檔",
    fallback: "在 LINE 傳一句「升級」，就收到付款連結",
  },
  {
    id: "standard" as const,
    featured: false,
    quota: `每月 ${PLANS.standard.monthlyHours} 小時`,
    features: ["單場不限長", "記錄頁永久保留", "Word ＋ PDF 匯出、分享連結"],
    ...payButton("standard", {
      web: "同一條路——LINE 登入後直接刷卡",
      prefill: "同一條路——送出後收到的是標準檔的連結",
    }),
    cta: "訂閱標準檔",
    fallback: "一樣在 LINE 傳「升級」，挑標準檔那條連結",
  },
];
const CONTACT = "mailto:hello@chengshisuo.com";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const target = resolveLiffState(await searchParams);
  if (target) redirect(target);

  return (
    <div className={css.wrap}>
      <header className={css.topbar}>
        <div className={css.brand}>
          <span className={css.seal} aria-hidden>
            成
          </span>
          <span className={css.wordmark}>成事所</span>
        </div>
        <div className={css.topActions}>
          <ThemeToggle />
          <a className={css.topLink} href={CONTACT}>
            找我們聊聊
          </a>
        </div>
      </header>

      <section className={css.hero}>
        <div>
          <h1 className={css.h1}>
            開完的會，
            <br />
            別讓決議跟著散掉。
          </h1>
          <p className={css.sub}>
            把錄音丟進 LINE，幾分鐘後回你一份記錄頁：摘要、決議、待辦——誰、做什麼、什麼時候，連誰答應了什麼都列出來。不用註冊，加個好友就開始。
          </p>
          <div className={css.ctaRow}>
            {ADD_FRIEND_URL ? (
              <a className={css.cta} href={ADD_FRIEND_URL}>
                加 LINE 好友開始用
              </a>
            ) : (
              <span className={css.ctaNote}>LINE 官方帳號籌備中</span>
            )}
            {/* 次要 CTA（issue #14）：與其說我們做得好，不如給看。旁邊的縮影就是這場會議的節錄 */}
            <a className={css.ctaGhost} href="/demo">
              看一份真的記錄頁 →
            </a>
            <span className={css.ctaNote}>
              免費每月 {PLANS.free.monthlyMeetings} 場，不用註冊也不用記密碼
            </span>
          </div>
          {/* 試用上傳（issue #19）：整頁原本唯一的出口是「加好友」——承諾最高的動作。
              這一塊給一條零承諾的路先摸到產品，加好友改在試用記錄頁上談 */}
          <TrialUpload />
          {QR && (
            <div className={css.qrCard}>
              <span className={css.qrBox}>
                <svg
                  className={css.qrSvg}
                  viewBox={`0 0 ${QR.size} ${QR.size}`}
                  role="img"
                  aria-label="加 LINE 好友的 QR code"
                  shapeRendering="crispEdges"
                >
                  <path d={qrSvgPath(QR)} />
                </svg>
              </span>
              <span className={css.qrText}>
                <strong>手機掃這裡，直接開始</strong>
                <span>掃完進聊天室，第一句話都幫你打好了——按送出就有回應</span>
              </span>
            </div>
          )}
        </div>
        <Preview />
      </section>

      <section className={css.section}>
        <h2 className={css.sectionTitle}>怎麼用</h2>
        <div className={css.steps}>
          <div>
            <div className={css.stepNum}>01</div>
            <h3 className={css.stepTitle}>錄音丟進 LINE</h3>
            <p className={css.stepBody}>iPhone 語音備忘錄直接分享進來就行，LINE 的語音訊息也收。</p>
          </div>
          <div>
            <div className={css.stepNum}>02</div>
            <h3 className={css.stepTitle}>等幾分鐘</h3>
            <p className={css.stepBody}>轉寫、校正、抽重點，自動跑完。開下一場會的空檔就處理好了。</p>
          </div>
          <div>
            <div className={css.stepNum}>03</div>
            <h3 className={css.stepTitle}>收到記錄頁</h3>
            <p className={css.stepBody}>重點可改可補、講者改成真名，整份直接轉給該看的人。</p>
          </div>
        </div>
      </section>

      <section className={css.section}>
        <h2 className={css.sectionTitle}>隱私是規矩，不是條款</h2>
        <ul className={css.privacyList}>
          <li>錄音在 {AUDIO_TTL_HOURS} 小時內真的刪掉。不是標記刪除，是檔案不見了。付費的也一樣。</li>
          <li>記錄頁只有你本人打得開。</li>
          <li>在 LINE 說一句話，就能刪掉你的全部資料。</li>
          <li>記錄頁上永遠不放第三方廣告。</li>
        </ul>
      </section>

      <section className={css.section}>
        <h2 className={css.sectionTitle}>定價</h2>
        <div className={css.plans}>
          {PLAN_CARDS.map((p) => (
            <div key={p.id} className={`${css.plan}${p.featured ? ` ${css.planFeatured}` : ""}`}>
              <div className={css.planHead}>
                <h3 className={css.planName}>{PLANS[p.id].name}</h3>
                {p.featured && <span className={css.planTag}>推薦</span>}
              </div>
              {/* 免費那張也照樣寫 NT$0——標題已經叫「免費」，價格再寫一次「免費」是重複，
                  而且三張卡的數字對不齊，眼睛要重新找一次基準線 */}
              <p className={css.planPrice}>
                <span className={css.planCurrency}>NT$</span>
                {PLANS[p.id].priceTwd}
                <span className={css.planPer}>/月</span>
              </p>
              <p className={css.planQuota}>{p.quota}</p>
              <ul className={css.planFeatures}>
                {p.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {p.href ? (
                <div className={css.planFoot}>
                  <a className={css.planCta} href={p.href}>
                    {p.cta}
                  </a>
                  <p className={css.planNote}>{p.note}</p>
                </div>
              ) : (
                <p className={css.planAction}>{p.fallback}</p>
              )}
            </div>
          ))}
        </div>
        <p className={css.priceNote}>
          額度用完就先停，不會自動加購、不會多扣一毛。免費的每月 1 號回滿，付費的在你刷卡日回滿。
        </p>
      </section>

      <footer className={css.footer}>
        <div className={css.footBrand}>
          <div className={css.brand}>
            <span className={css.seal} aria-hidden>
              成
            </span>
            <span className={css.wordmark}>成事所</span>
          </div>
          <span>用程式助你成事</span>
          {/* 教學／筆記的入口只放頁尾：首頁要做的事只有一件（加好友），
              上面多一個導覽連結就是多一個分岔。會往下捲到這裡的人，才是想多讀一點的人 */}
          <a className={css.footLink} href="/blog">
            筆記
          </a>
        </div>
        {/* 敲門磚只剩這一行：來的人是為了會議記錄，顧問生意放在頁尾就好 */}
        <span className={css.footNote}>
          成事所也替中小企業做 AI 導入。
          <a className={css.footLink} href={CONTACT}>
            找我們聊聊
          </a>
        </span>
      </footer>
    </div>
  );
}

/** 記錄頁縮影：/demo 那場會議的節錄（lib/demo-meeting.ts）——mock 與真頁講同一個故事。 */
function Preview() {
  return (
    <div className={css.preview} aria-hidden>
      <div className={css.brand}>
        <span className={css.seal}>成</span>
        <span className={css.wordmark}>成事所</span>
      </div>
      <p className={css.pTitle}>週一業務會報</p>
      <p className={css.pMeta}>2026-08-24 / 7 分 04 秒</p>

      <div className={css.pHead}>
        重點 <span className={css.pRule} />
      </div>
      <div className={css.pRow}>
        <span className={css.pDash} />
        <span>中部三家客戶的續約都卡在報價單改版，統一延到月底再談。</span>
      </div>
      <div className={css.pRow}>
        <span className={css.pDash} />
        <span>這個月客訴多一倍，主因是出貨延遲，不是產品品質。</span>
      </div>

      <div className={css.pHead}>
        承諾追蹤 <span className={css.pRule} />
      </div>
      <div className={css.pRow}>
        <span className={css.pSeal} />
        <span>
          <strong>志豪</strong>：週五前把新報價單寄給那三家客戶。
        </span>
      </div>

      <div className={css.pHead}>
        逐字稿 <span className={css.pRule} />
      </div>
      <div className={css.pRow}>
        <span className={css.pStamp}>00:14</span>
        <span>上週報價單寄出去五家，只有兩家回，其他都說要再看看…</span>
      </div>
      <div className={css.pRow}>
        <span className={css.pStamp}>00:27</span>
        <span>是價格問題，還是規格沒講清楚？</span>
      </div>
    </div>
  );
}
