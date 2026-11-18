/**
 * 加好友連結的來源標記（issue #8）。分享頁的讀者就是下一批用戶，
 * 「新用戶幾成來自轉傳」要有分母也要有分子——CTA 的點擊走 /join?ref=share，
 * 記一筆事件再 302 到 LINE 加好友頁。
 *
 * 這裡量到的是「點擊」不是「真的加好友」。真的加好友只有 LINE OA 後台的
 * 「加入好友管道」數得到；那條網址一旦開好，填進 LINE_ADD_FRIEND_URL_<REF>，
 * 同一顆按鈕就兩邊都有數字，程式不用改。
 */

import { UPGRADE_PREFILL_MESSAGES } from "./routing";

/** 認得的來源。允許清單是刻意的：ref 直接進事件表，開放輸入等於讓路人自己造欄位值。 */
export const JOIN_REFS = ["share", "demo", "trial", "blog"] as const;

export type JoinRef = (typeof JOIN_REFS)[number];

/** 分享頁那顆 CTA 的來源標記。轉化率算的就是它，別在別處寫字面值。 */
export const SHARE_REF: JoinRef = "share";

/** 首頁示範記錄頁那顆 CTA 的來源標記（issue #14）。跟 share 分開，兩條迴路各自算。 */
export const DEMO_REF: JoinRef = "demo";

/** 試用記錄頁那顆 CTA 的來源標記（issue #19）。試用迴路值不值得做，就看這條的數字。 */
export const TRIAL_REF: JoinRef = "trial";

/**
 * 部落格文章頁那顆 CTA 的來源標記。SEO 是唯一一條「先花時間、很久以後才看得到結果」的
 * 獲客路徑——沒有這個數字，兩篇文上線之後就只能憑感覺猜它有沒有用。
 */
export const BLOG_REF: JoinRef = "blog";

export function normalizeRef(raw: string | null | undefined): JoinRef | null {
  return JOIN_REFS.includes(raw as JoinRef) ? (raw as JoinRef) : null;
}

/** CTA 的 href。從型別長出來，ref 改名時畫面那端會編不過。 */
export function joinHref(ref: JoinRef): string {
  return `/join?ref=${ref}`;
}

/**
 * 這次點擊該落在哪個加好友網址。沒設 OA basic ID 就沒有連結可去（回 null，
 * 呼叫端自己決定退路）——本機沒填 LINE 值時不該噴錯。
 */
export function joinTargetUrl(ref: JoinRef | null): string | null {
  // 逐條列出而不是拼變數名——env 名字要 grep 得到，才不會改名時漏掉這裡
  const channels: Record<JoinRef, string | undefined> = {
    share: process.env.LINE_ADD_FRIEND_URL_SHARE,
    demo: process.env.LINE_ADD_FRIEND_URL_DEMO,
    trial: process.env.LINE_ADD_FRIEND_URL_TRIAL,
    blog: process.env.LINE_ADD_FRIEND_URL_BLOG,
  };
  const channel = ref ? channels[ref] : undefined;
  if (channel) return channel;

  const oaId = process.env.NEXT_PUBLIC_LINE_OA_ID;
  return oaId ? `https://line.me/R/ti/p/${encodeURIComponent(oaId)}` : null;
}

/**
 * oaMessage 深連結（issue #15 的 QR、issue #16 的定價卡按鈕都走這裡）：
 * 點開進成事所聊天室、輸入框已預填 prefill 那句話——互動從「我要打什麼」變成「按一下」。
 * 沒加好友的人 LINE 會先跳加好友，加完訊息還在，所以這條同時也是加好友入口。
 *
 * 只認 OA basic ID：「加入好友管道」那種網址（LINE_ADD_FRIEND_URL_*）帶不了
 * 預填訊息，這裡刻意不看它。沒設 OA ID 回 null，呼叫端自己決定退路。
 */
export function oaMessageUrl(prefill: string): string | null {
  const oaId = process.env.NEXT_PUBLIC_LINE_OA_ID;
  if (!oaId) return null;
  return `https://line.me/R/oaMessage/${encodeURIComponent(oaId)}/?${encodeURIComponent(prefill)}`;
}

/**
 * 定價卡按鈕的目標網址（issue #16）：預填「升級○○檔」，送出就收到那一檔的付款卡。
 * 預填句從 routing 拿——連結組法與分流認得的話綁在同一個常數上，才不會各改各的。
 */
export function upgradeTargetUrl(plan: keyof typeof UPGRADE_PREFILL_MESSAGES): string | null {
  return oaMessageUrl(UPGRADE_PREFILL_MESSAGES[plan]);
}

/** 一次跳轉的決定。路由只負責把它翻成 HTTP，邏輯都在這裡（才測得到）。 */
export type JoinRedirect = {
  target: string;
  ref: JoinRef | null;
  /**
   * 這一下該不該進事件表。只有真的把人送到加好友頁才算——
   * 沒設 OA ID 時我們送他回首頁，那不是一次轉化，記了會灌水驗收數字。
   */
  countable: boolean;
};

export function joinRedirect(requestUrl: string): JoinRedirect {
  const url = new URL(requestUrl);
  const ref = normalizeRef(url.searchParams.get("ref"));
  const target = joinTargetUrl(ref);
  return target === null
    ? { target: new URL("/", url).toString(), ref, countable: false }
    : { target, ref, countable: true };
}
