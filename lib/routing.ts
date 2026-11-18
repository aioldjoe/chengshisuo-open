import type { LineMessageEvent } from "./line";
import type { PaidPlanId } from "./plans";

/**
 * 訊息分流。成事所只說一件事：收錄音、回記錄頁。
 * 個人版規則：只服務一對一（不進群組）；音檔＝開工，文字＝說明，其他＝禮貌拒收。
 */

/** 當成錄音收的副檔名（iPhone 語音備忘錄分享進 LINE 是 .m4a 檔案訊息）。 */
const AUDIO_EXT = /\.(m4a|mp3|wav|aac|ogg|flac|amr)$/i;

export type Route =
  | {
      kind: "meeting-audio";
      messageId: string;
      filename: string;
      /** 原生語音自帶的時長（秒）；檔案訊息量不到，要下載後才知道，為 null。 */
      durationSeconds: number | null;
    }
  | {
      kind: "upgrade";
      /** 指名的檔次；null＝沒指名，回覆會兩檔都列。定價卡按鈕預填的訊息會帶檔次。 */
      want: PaidPlanId | null;
    }
  | { kind: "usage" }
  | { kind: "demo" }
  | { kind: "howto" }
  | { kind: "delete-all-request" }
  | { kind: "delete-all-confirm" }
  | { kind: "unlock" }
  | { kind: "text"; text: string }
  | { kind: "decline" }
  | { kind: "ignore" };

/** 想付錢的說法。命中就發付款連結——問價的人是最好回的訊息，別讓他撲空。 */
const UPGRADE_WORDS = ["升級", "訂閱", "方案", "付費", "收費", "價格", "多少錢"];

/** 想知道自己用了多少的說法。 */
const USAGE_WORDS = ["額度", "用量", "用了多少", "還剩"];

/** 想看範例的說法。命中就回示範記錄頁連結——加好友後最快的「先給看」。 */
const DEMO_WORDS = ["範例", "示範"];

/**
 * 問怎麼用的說法（issue #18）。圖文選單「怎麼傳錄音」那格送出的就是「怎麼用」，
 * 所以這組詞跟選單綁在一起——見 onboarding.test.ts 的綁定測試。
 * 排在 UPGRADE_WORDS 之後：「怎麼收費」問的是價，不是用法。
 */
const HOWTO_WORDS = ["怎麼用", "怎麼傳", "教學", "使用說明"];

/**
 * 首頁 QR 掃完預填在輸入框的那句話（issue #15）。它必須命中 DEMO_WORDS 的分流，
 * 否則掃碼的人按下送出只會拿到一句通用說明——第一次互動就撲空。
 * 改這句前先看 routing.test.ts 裡把兩者綁在一起的那條測試。
 */
export const DEMO_PREFILL_MESSAGE = "看範例";

/**
 * 定價卡按鈕預填在輸入框的那句話（issue #16）。跟 DEMO_PREFILL_MESSAGE 同一個道理：
 * 它必須命中 UPGRADE_WORDS 且被認出檔次，按鈕的人送出才會直接拿到那一檔的付款卡。
 * 改這句前先看 routing.test.ts 裡把兩者綁在一起的那條測試。
 */
export const UPGRADE_PREFILL_MESSAGES = {
  lite: "升級輕量檔",
  standard: "升級標準檔",
} as const satisfies Record<PaidPlanId, string>;

/** 刪除全部的確認短語。無狀態二次確認：第一句只說明，打出這句才執行。 */
export const DELETE_ALL_CONFIRM_PHRASE = "確認刪除全部";

export type RouteOptions = {
  /** 額度解鎖碼（env QUOTA_UNLOCK_CODE）。空／未設＝功能關閉，什麼文字都解不了。 */
  unlockCode?: string | null;
};

export function route(ev: LineMessageEvent, opts: RouteOptions = {}): Route {
  // 不進群組：非一對一來源一律安靜略過（bot 被拉進群也不回話）。
  if (ev.source.type !== "user" || !ev.source.userId) return { kind: "ignore" };

  const m = ev.message;
  switch (m.type) {
    case "audio":
      // 原生語音事件自帶時長——單場上限（免費檔才有）在 webhook 就擋得掉，連下載都省了。
      // 分流本身不知道誰付了錢，所以只負責把時長帶出去，不下判斷。
      // LINE 原生語音訊息沒有檔名，用事件時間造一個。
      return {
        kind: "meeting-audio",
        messageId: m.id,
        filename: audioFilename(ev.timestamp),
        durationSeconds: m.duration != null ? Math.round(m.duration / 1000) : null,
      };
    case "file":
      if (AUDIO_EXT.test(m.fileName)) {
        return { kind: "meeting-audio", messageId: m.id, filename: m.fileName, durationSeconds: null };
      }
      return { kind: "decline" };
    case "text": {
      const t = m.text.trim();
      // 確認短語要求完全一致（比意圖判定嚴），先比對才不會被下面的 contains 吃掉
      if (t === DELETE_ALL_CONFIRM_PHRASE) return { kind: "delete-all-confirm" };
      // 解鎖碼：完全一致才算（不做 contains，免得夾在句子裡誤觸）
      if (opts.unlockCode && t === opts.unlockCode) return { kind: "unlock" };
      if (t.includes("刪除") && (t.includes("全部") || t.includes("所有"))) {
        return { kind: "delete-all-request" };
      }
      // 升級擺在用量之前：「額度用完了怎麼升級」問的是怎麼付錢，
      // 而用量的回覆本來就會附上付款連結，兩邊都不會漏掉想升級的人。
      if (UPGRADE_WORDS.some((w) => t.includes(w))) {
        // 檔次認「輕量」但只認「標準檔」不認「標準」——「收費標準」是在問價，
        // 認成指名標準檔的話，免費用戶會少看到輕量那一檔
        const want = t.includes("輕量") ? "lite" : t.includes("標準檔") ? "standard" : null;
        return { kind: "upgrade", want };
      }
      if (USAGE_WORDS.some((w) => t.includes(w))) return { kind: "usage" };
      if (DEMO_WORDS.some((w) => t.includes(w))) return { kind: "demo" };
      if (HOWTO_WORDS.some((w) => t.includes(w))) return { kind: "howto" };
      return { kind: "text", text: m.text };
    }
    default:
      return { kind: "decline" };
  }
}

/** 原生語音訊息的檔名：錄音-YYYYMMDD-HHmm.m4a（台北時間）。 */
export function audioFilename(timestampMs?: number): string {
  const d = new Date((timestampMs ?? Date.now()) + 8 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `錄音-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}.m4a`;
}
