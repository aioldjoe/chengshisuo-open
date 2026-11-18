/**
 * 首頁直接試傳一場（issue #19）的純邏輯。client 也會 import
 * （首頁上傳區要在送出前先擋大小），勿放 server-only import。
 *
 * 試用的立場：加好友從「入場費」變成「留住成果的動作」。所以試用不看月額度、
 * 不綁 LINE 身分，底線只有三條——單場 5 分鐘、單 IP 一天一場、頁面 24 小時。
 */

export const TRIAL_MAX_SECONDS = 5 * 60;

/** Vercel 函式的請求上限 4.5MB——留頭寸給 multipart 邊界，超過的檔在平台層就會被斷掉。 */
export const TRIAL_MAX_BYTES = 4 * 1024 * 1024;

export const TRIAL_PAGE_TTL_MS = 24 * 3600_000;

/**
 * 試用場次的 userId 前綴。試用不綁 LINE userId（身分即 LINE userId 的原則不妥協），
 * 但 Meeting.userId 又是儲存層的主鍵之一——放 `trial:<sha256(ip)>` 一石二鳥：
 * 跟 LINE userId（U 開頭）永不相撞，而且「同 IP 一天一場」直接用
 * repo.listSince(trialUserId, 24h前) 查，不加欄位也不掃全表。
 * IP 雜湊跟著會議走，24 小時後隨頁面真刪。
 */
const TRIAL_PREFIX = "trial:";

export function trialUserId(ipHash: string): string {
  return `${TRIAL_PREFIX}${ipHash}`;
}

export function isTrialMeeting(userId: string): boolean {
  return userId.startsWith(TRIAL_PREFIX);
}

export type TrialRejection = "ip-limit" | "too-large" | "unknown-duration" | "too-long";

export type TrialVerdict = { ok: true } | { ok: false; reason: TrialRejection };

/**
 * 收不收這場試用。IP 限制排最前面：今天沒名額的話，講檔案哪裡不對只是噪音。
 * 讀不出時長一律拒收——正式管線放行靠月額度兜底（lib/audio/duration.ts 檔頭），
 * 試用沒有那道底，IP 限制才是唯一的牆，所以量不到的不賭。
 */
export function trialVerdict(input: {
  bytes: number;
  durationSeconds: number | null;
  usedToday: boolean;
}): TrialVerdict {
  if (input.usedToday) return { ok: false, reason: "ip-limit" };
  if (input.bytes > TRIAL_MAX_BYTES) return { ok: false, reason: "too-large" };
  if (input.durationSeconds === null) return { ok: false, reason: "unknown-duration" };
  if (input.durationSeconds > TRIAL_MAX_SECONDS) return { ok: false, reason: "too-long" };
  return { ok: true };
}

/**
 * 轉寫回來的真時長複驗。5 分鐘上限進門時只驗得了檔頭（lib/audio/duration.ts），
 * 而檔頭可偽造、CBR 估法也會失真——低位元率的 mp3 在 4MB 裡裝得下幾十分鐘。
 * 寬限 1.25 倍：估錯不冤枉真人，偽造檔頭塞長音檔的一定超過。
 * 超過就整場拒收（轉寫費已花，但不給成品，繞過就沒有意義）。
 */
export const TRIAL_TRANSCRIBED_MAX_SECONDS = TRIAL_MAX_SECONDS * 1.25;

export function transcribedTooLong(seconds: number | null): boolean {
  return seconds !== null && seconds > TRIAL_TRANSCRIBED_MAX_SECONDS;
}

/**
 * 拒收的話怎麼說。規矩同 lib/upsell.ts：不做靜默拒收——每一句都給出路，
 * 而試用的出路永遠是同一條：加 LINE 好友，用正式的額度傳。
 */
export function trialRejectionText(reason: TrialRejection): string {
  switch (reason) {
    case "ip-limit":
      return "試用一天一場，今天這裡的名額用過了。想現在就處理：加 LINE 好友，免費檔每月都有額度，不用等明天。";
    case "too-large":
      return "檔案超過 4MB，試用先收 5 分鐘內的小檔。完整長度的會議，加 LINE 好友傳進聊天室就行。";
    case "unknown-duration":
      return "讀不出這個檔的長度，試用先不收。換成 m4a、mp3 或 wav 再試一次，或加 LINE 好友直接傳。";
    case "too-long":
      return "錄音超過 5 分鐘。試用先讓你看 5 分鐘內的效果；完整長度的會議，加 LINE 好友傳進來。";
  }
}
