import {
  PLANS,
  planLabel,
  type PaidPlanId,
  type PlanId,
  type QuotaReason,
  type QuotaUsage,
} from "./plans";

/**
 * 撞牆時說的話。
 *
 * 唯一的規則：**不做靜默拒收**。撞到額度是這個產品少數會讓人失望的時刻，
 * 而會撞牆的人正是最想用它的人——訊息要同時回答「為什麼不行」「什麼時候好」
 * 「現在想繼續要怎麼辦」。付款連結是答案的一部分，不是廣告。
 *
 * 純字串組裝，沒有 I/O：連結由呼叫端先開好再傳進來（Stripe 沒接好時傳空物件，
 * 這裡自動退回沒有連結的說法，不會吐半截訊息）。
 */

/** 付款連結；沒接 Stripe 或開連結失敗時可以是空的。 */
export type UpsellLinks = { lite?: string; standard?: string };

/** 秒數講成人話：不足一小時講分鐘，否則講小時（一位小數）。 */
export function fmtHoursZh(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分鐘`;
  const h = Math.floor((seconds / 3600) * 10) / 10;
  return `${h} 小時`;
}

/**
 * 額度什麼時候回來。免費檔看日曆月、付費檔看帳單週期（見 quotaWindowStart）——
 * 對付費用戶說「下個月 1 號」是錯的，他的額度是刷卡日那天回來。
 * export 是給 lib/flex.ts 的額度卡用同一句——恢復時間的說法只能有一份。
 */
export function quotaResetLine(plan: PlanId, periodEnd: string | null): string {
  if (plan === "free") return "下個月 1 號自動恢復。";
  const d = periodEnd ? new Date(periodEnd) : null;
  if (!d || Number.isNaN(d.getTime())) return "下次扣款日自動恢復。";
  // 台北時間（使用者在台灣，UTC 日期會差一天）
  const tpe = new Date(d.getTime() + 8 * 3600_000);
  return `下次扣款日（${tpe.getUTCMonth() + 1} 月 ${tpe.getUTCDate()} 日）自動恢復。`;
}

/** 付費檔的權益句。文字訊息與 Flex 卡（lib/flex.ts）共用——改權益文案只改這裡。 */
export const PAID_PERKS = "單場不限長、記錄頁永久保留、PDF 匯出與分享";

/** 一檔的推銷句。數字一律從方案表推——價格改一個地方，訊息、首頁、記錄頁一起跟上。 */
function pitch(id: PaidPlanId, links: UpsellLinks): string | null {
  const url = links[id];
  if (!url) return null;
  const p = PLANS[id];
  const perks = id === "lite" ? `、${PAID_PERKS}` : "，其餘同輕量";
  return `・${planLabel(id)}：每月 ${p.monthlyHours} 小時${perks}\n${url}`;
}

/** 沒有任何連結可給時的收尾——別讓人以為自己被句點了。 */
const NO_LINKS = "（付費方案正在開通中，想先聊聊需求可以直接回我一句話。）";

function pitchBlock(from: PlanId, links: UpsellLinks): string {
  // 只往上賣：已經在輕量檔的人不該收到「要不要買輕量檔」
  const parts =
    from === "free"
      ? [pitch("lite", links), pitch("standard", links)]
      : from === "lite"
        ? [pitch("standard", links)]
        : [];
  const usable = parts.filter((x): x is string => x !== null);
  if (usable.length === 0) return from === "standard" ? "" : NO_LINKS;
  return `想現在繼續的話：\n${usable.join("\n")}`;
}

function paragraphs(lines: (string | null)[]): string {
  return lines.filter((x): x is string => !!x).join("\n\n");
}

/**
 * 撞牆訊息的說明段（為什麼不行、什麼時候好）——不含付款連結。
 * 拆出來是給 Flex 路徑用：付款卡跟在後面時，連結由卡的按鈕出，文字再列一次 URL 就重複了。
 */
export function quotaBlockedLead(
  plan: PlanId,
  reason: QuotaReason,
  incomingSeconds: number | null,
  periodEnd: string | null = null,
): string {
  if (reason === "too-long") {
    const about = incomingSeconds !== null ? `這段錄音約 ${fmtHoursZh(incomingSeconds)}，` : "";
    return paragraphs([
      `${about}超過免費版單場 ${fmtHoursZh(PLANS.free.maxMeetingSeconds!)}的上限了 🙏`,
      "升級後單場不限長——額度按小時扣，多長的會議都收得下。也可以分段錄、分段傳，每段我都會整理成一份記錄頁。",
    ]);
  }
  if (reason === "monthly-meetings") {
    return `這個月的 ${PLANS.free.monthlyMeetings} 場免費額度用完了 🙏 ${quotaResetLine("free", null)}`;
  }
  return `這一期的 ${PLANS[plan].monthlyHours} 小時額度用完了 🙏 ${quotaResetLine(plan, periodEnd)}`;
}

/** 撞額度時回的話（純文字整句版，Flex 不可用時的 fallback）。reason 決定第一句，方案決定要往上賣什麼。 */
export function quotaBlockedText(
  plan: PlanId,
  reason: QuotaReason,
  incomingSeconds: number | null,
  links: UpsellLinks,
  periodEnd: string | null = null,
): string {
  const tail =
    reason === "monthly-hours" && plan === "standard"
      ? `如果每個月固定超過 ${PLANS.standard.monthlyHours} 小時，回我一句話，我們幫你算一個合適的方案。`
      : pitchBlock(plan, links);
  return paragraphs([quotaBlockedLead(plan, reason, incomingSeconds, periodEnd), tail]);
}

/** 問額度時回的話。順便把升級與管理訂閱的入口放在同一則裡。 */
export function usageText(
  plan: PlanId,
  usage: QuotaUsage,
  links: UpsellLinks,
  portalUrl: string | null,
  periodEnd: string | null = null,
): string {
  if (plan === "free") {
    return paragraphs([
      `這個月你用了 ${usage.meetings} / ${PLANS.free.monthlyMeetings} 場（免費版，單場上限 ${fmtHoursZh(PLANS.free.maxMeetingSeconds!)}、記錄頁保留 ${PLANS.free.pageDays} 天）。`,
      pitchBlock("free", links),
    ]);
  }
  const p = PLANS[plan];
  return paragraphs([
    `這一期你用了 ${fmtHoursZh(usage.seconds)} / ${p.monthlyHours} 小時，共 ${usage.meetings} 場（${p.name}檔，單場不限長、記錄頁永久保留）。${quotaResetLine(plan, periodEnd)}`,
    portalUrl ? `管理訂閱（換檔／換卡／取消）：\n${portalUrl}` : null,
    plan === "lite" ? pitchBlock("lite", links) : null,
  ]);
}

/** 檔次高低。指名升級只在真的往上時成立——判斷用它，不散寫一堆 if。 */
const PLAN_RANK: Record<PlanId, number> = { free: 0, lite: 1, standard: 2 };

/**
 * 主動問方案／想付錢時回的話。want 是指名的檔次（定價卡按鈕預填「升級○○檔」，
 * 見 routing 的 UPGRADE_PREFILL_MESSAGES）：指名了就只回那一檔的付款卡，少一次選擇；
 * 指名的不比現在高（輕量用戶點輕量卡）就當沒指名，照舊只往上賣。
 */
export function upgradeText(
  plan: PlanId,
  links: UpsellLinks,
  portalUrl: string | null,
  want: PaidPlanId | null = null,
): string {
  if (want && PLAN_RANK[want] > PLAN_RANK[plan]) {
    const url = links[want];
    return paragraphs([
      url
        ? `好的！${planLabel(want)}——每月 ${PLANS[want].monthlyHours} 小時、${PAID_PERKS}。付款走這裡，完成後馬上生效：\n${url}`
        : NO_LINKS,
      portalUrl ? `管理訂閱：\n${portalUrl}` : null,
    ]);
  }
  if (plan === "standard") {
    return paragraphs([
      `你目前在標準檔（每月 ${PLANS.standard.monthlyHours} 小時、${PAID_PERKS}）——這是目前最大的一檔。`,
      portalUrl ? `管理訂閱：\n${portalUrl}` : null,
    ]);
  }
  const head =
    plan === "free"
      ? `成事所的方案是這樣：\n・免費：每月 ${PLANS.free.monthlyMeetings} 場、單場上限 ${fmtHoursZh(PLANS.free.maxMeetingSeconds!)}、記錄頁保留 ${PLANS.free.pageDays} 天`
      : `你目前在輕量檔（每月 ${PLANS.lite.monthlyHours} 小時）。`;
  return paragraphs([head, pitchBlock(plan, links), portalUrl ? `管理訂閱：\n${portalUrl}` : null]);
}

/**
 * 處理失敗時說的話。付費檔沒有單場上限，所以超長音檔遲早會撞到工程極限
 * （函式逾時、LINE 下載大小、Scribe 單檔上限）——票上寫明那是工程約束，
 * 要用**明確的錯誤訊息**處理，不是偷偷把產品上限加回來。
 * 認得出的原因就講原因、給出路；認不出的才回泛用道歉，不亂猜。
 */
export function failureText(e: unknown): string {
  const msg = e instanceof Error ? `${e.message}` : String(e ?? "");

  if (/timed out|timeout|ETIMEDOUT|FUNCTION_INVOCATION_TIMEOUT/i.test(msg) && !/LINE content/.test(msg)) {
    return "這段錄音太長，處理到一半就超過單次的時間上限了 🙏 先分成兩三段傳給我，每段都會是一份完整的記錄頁——額度按實際時長扣，分段不會多扣。";
  }
  if (/413|too large|file size|entity too large/i.test(msg)) {
    return "這個檔案超過轉寫服務的單檔上限了 🙏 用錄音 app 分段輸出、或轉成 .m4a（同樣長度小很多）再傳一次。";
  }
  if (/LINE content/.test(msg)) {
    return "這個檔案沒收完——LINE 那邊一直沒把它交給我 🙏 檔案很大時容易這樣，換個 Wi-Fi 或分段傳都會好很多。";
  }
  return "抱歉，這段錄音處理失敗了 🙏 請再傳一次；若一直失敗，換個格式（如 .m4a）試試。";
}
