import { AUDIO_TTL_HOURS } from "./cleanup";
import { withExternalBrowser } from "./browser";
import type { FlexMessage } from "./line";
import { PLANS, type PaidPlanId, type PlanId, type QuotaUsage } from "./plans";
import { UPGRADE_PREFILL_MESSAGES } from "./routing";
import { PAID_PERKS, fmtHoursZh, quotaResetLine, type UpsellLinks } from "./upsell";

/**
 * Flex 訊息的組裝（issue #17）。全部純函式、零依賴——不引 builder 套件，
 * JSON 形狀直接寫，測試鎖住結構。發送在 lib/line.ts，文案數字一律讀 lib/plans.ts。
 *
 * 為什麼要有卡：在台灣的 LINE 語境裡，一條裸的 buy.stripe.com 連結看起來就是詐騙。
 * 要人刷卡，訊息本身得先值得信任——品牌色、方案內容、Stripe 安心小字，都是在買這個信任。
 */

// 品牌色（brand/ 手冊；記錄頁 token 在 globals.css，LINE 卡片進不了 CSS 只能寫死）
const BRICK = "#B65A4A";
const INK = "#383432";
const MUTED = "#81756D";
const TRACK = "#E2D9D3";

type Node = Record<string, unknown>;

function text(t: string, extra: Node = {}): Node {
  return { type: "text", text: t, wrap: true, ...extra };
}

/** 台北時間的日期label（使用者在台灣，UTC 日期會差一天）。 */
export function taipeiDateLabel(iso: string): string {
  const d = new Date(Date.parse(iso) + 8 * 3600_000);
  return `${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日`;
}

/** 一檔的付款 bubble：品牌色頭條、價格、三行權益、訂閱按鈕、Stripe 安心小字。 */
function paymentBubble(id: PaidPlanId, url: string): Node {
  const p = PLANS[id];
  const perk = (t: string): Node => ({
    type: "box",
    layout: "baseline",
    spacing: "sm",
    contents: [text("✓", { color: BRICK, size: "sm", flex: 0, wrap: false }), text(t, { color: INK, size: "sm" })],
  });
  return {
    type: "bubble",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: BRICK,
      paddingAll: "16px",
      contents: [
        text("成事所", { color: "#F5DDD7", size: "xs", wrap: false }),
        text(`${p.name}檔`, { color: "#FFFFFF", size: "xl", weight: "bold", wrap: false }),
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "lg",
      contents: [
        text(`NT$${p.priceTwd} / 月`, { size: "xxl", weight: "bold", color: INK, wrap: false }),
        {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          contents: [
            perk(`每月 ${p.monthlyHours} 小時額度`),
            perk("單場不限長"),
            perk("記錄頁永久保留、PDF 匯出與分享"),
          ],
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "button",
          style: "primary",
          color: BRICK,
          action: { type: "uri", label: "用信用卡訂閱", uri: withExternalBrowser(url) },
        },
        text("由 Stripe 處理，成事所看不到你的卡號", { size: "xxs", color: MUTED, align: "center" }),
      ],
    },
  };
}

/** 檔次高低；只往上賣的判斷跟 lib/upsell.ts 同一套規則。 */
const PLAN_RANK: Record<PlanId, number> = { free: 0, lite: 1, standard: 2 };

/**
 * 付款卡。指名（want）且真的比現在高就只出那一檔；否則照舊只往上賣，
 * 免費用戶看兩檔用 carousel 左右滑。一張都出不了（標準檔、或 Stripe 沒接好）回 null，
 * 呼叫端退回 lib/upsell.ts 的純文字版——那套字串是 fallback，不能刪。
 */
export function paymentCardFlex(
  plan: PlanId,
  links: UpsellLinks,
  want: PaidPlanId | null = null,
): FlexMessage | null {
  const candidates: PaidPlanId[] =
    want && PLAN_RANK[want] > PLAN_RANK[plan]
      ? [want]
      : plan === "free"
        ? ["lite", "standard"]
        : plan === "lite"
          ? ["standard"]
          : [];
  const usable = candidates.filter((id) => !!links[id]);
  if (usable.length === 0) return null;

  const bubbles = usable.map((id) => paymentBubble(id, links[id]!));
  const altText =
    usable.length === 1
      ? `升級成事所${PLANS[usable[0]].name}檔：每月 ${PLANS[usable[0]].monthlyHours} 小時、${PAID_PERKS}，NT$${PLANS[usable[0]].priceTwd}/月——點開這則訊息就能用信用卡訂閱。`
      : `成事所付費方案：${usable.map((id) => `${PLANS[id].name} NT$${PLANS[id].priceTwd}/月（每月 ${PLANS[id].monthlyHours} 小時）`).join("、")}——點開這則訊息選一檔，用信用卡訂閱。`;
  return {
    type: "flex",
    altText,
    contents: bubbles.length === 1 ? bubbles[0] : { type: "carousel", contents: bubbles },
  };
}

/**
 * 記錄頁完成卡——產品的高光時刻，也是最會被截圖轉傳的一則訊息。
 * 按鈕直連 LIFF 深連結，**不加** openExternalBrowser：身分閘門要在 LINE 內走，
 * 丟去外部瀏覽器反而拿不到身分。
 */
export function meetingReadyFlex(args: {
  title: string;
  dateLabel: string;
  durationSeconds: number | null;
  highlights: string[];
  url: string;
  pageDays: number | null;
}): FlexMessage {
  const meta = [args.dateLabel, durationZh(args.durationSeconds)].filter((x): x is string => !!x);
  const points = args.highlights.slice(0, 2).map(
    (h): Node => ({
      type: "box",
      layout: "baseline",
      spacing: "sm",
      contents: [text("・", { color: BRICK, size: "sm", flex: 0, wrap: false }), text(h, { color: INK, size: "sm" })],
    }),
  );
  const retention =
    args.pageDays === null
      ? `記錄頁永久保留；錄音檔 ${AUDIO_TTL_HOURS} 小時後自動銷毀`
      : `記錄頁保留 ${args.pageDays} 天；錄音檔 ${AUDIO_TTL_HOURS} 小時後自動銷毀`;
  return {
    type: "flex",
    altText: `「${args.title}」整理好了 ✦ 點開看會議記錄頁。`,
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          text("記錄頁整理好了 ✦", { color: BRICK, size: "xs", weight: "bold", wrap: false }),
          text(args.title, { size: "lg", weight: "bold", color: INK }),
          text(meta.join("・"), { size: "sm", color: MUTED, wrap: false }),
          ...(points.length > 0
            ? [{ type: "separator", margin: "md", color: TRACK }, ...points]
            : []),
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            color: BRICK,
            action: { type: "uri", label: "打開記錄頁", uri: args.url },
          },
          text(retention, { size: "xxs", color: MUTED, align: "center" }),
        ],
      },
    },
  };
}

/** 時長讀成人話，只講到分——lib/format.ts 的 fmtDurationZh 會帶秒數，卡上太瑣碎。 */
function durationZh(seconds: number | null): string | null {
  if (seconds === null) return null;
  const h = Math.floor(seconds / 3600);
  const min = Math.floor((seconds % 3600) / 60);
  if (h === 0 && min === 0) return "1 分內";
  return [h > 0 ? `${h} 小時` : null, min > 0 ? `${min} 分` : null].filter(Boolean).join(" ");
}

/**
 * 額度卡：一眼看到用了多少（進度條用兩個 box 的寬度比做出來）。
 * 升級入口用預填訊息按鈕（送出會命中 routing 的分流、拿到付款卡），
 * 不放裸的付款連結——連結只出現在付款卡上。
 */
export function usageCardFlex(
  plan: PlanId,
  usage: QuotaUsage,
  periodEnd: string | null,
  portalUrl: string | null,
): FlexMessage {
  const free = plan === "free";
  const used = free ? usage.meetings : Math.floor((usage.seconds / 3600) * 10) / 10;
  const total = free ? PLANS.free.monthlyMeetings! : PLANS[plan].monthlyHours!;
  const big = `${used} / ${total} ${free ? "場" : "小時"}`;
  const ratio = Math.min(1, Math.max(0, used / total));
  const reset = quotaResetLine(plan, periodEnd);
  const caption = free
    ? `免費版：單場上限 ${fmtHoursZh(PLANS.free.maxMeetingSeconds!)}、記錄頁保留 ${PLANS.free.pageDays} 天。${reset}`
    : `共 ${usage.meetings} 場。${reset}`;

  const buttons: Node[] = [];
  if (free) {
    // 「方案」會命中 routing 的 UPGRADE_WORDS——按下去等於問方案，回來的是付款卡
    buttons.push({
      type: "button",
      style: "secondary",
      action: { type: "message", label: "看付費方案", text: "方案" },
    });
  } else if (plan === "lite") {
    buttons.push({
      type: "button",
      style: "secondary",
      action: { type: "message", label: "升級標準檔", text: UPGRADE_PREFILL_MESSAGES.standard },
    });
  }
  if (!free && portalUrl) {
    buttons.push({
      type: "button",
      style: "secondary",
      action: {
        type: "uri",
        label: "管理訂閱（換檔／換卡／取消）",
        uri: withExternalBrowser(portalUrl),
      },
    });
  }

  return {
    type: "flex",
    altText: `${free ? "這個月" : "這一期"}你用了 ${big}。${reset}`,
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          text(free ? "這個月的用量" : "這一期的用量", { color: BRICK, size: "xs", weight: "bold", wrap: false }),
          text(big, { size: "xxl", weight: "bold", color: INK, wrap: false }),
          {
            type: "box",
            layout: "vertical",
            backgroundColor: TRACK,
            height: "6px",
            cornerRadius: "3px",
            contents:
              ratio > 0
                ? [
                    {
                      type: "box",
                      layout: "vertical",
                      // 有用量就至少畫 1%——四捨五入到 0% 的話條會看起來像沒動
                      width: `${Math.max(1, Math.round(ratio * 100))}%`,
                      backgroundColor: BRICK,
                      height: "6px",
                      cornerRadius: "3px",
                      contents: [{ type: "filler" }],
                    },
                  ]
                : [{ type: "filler" }],
          },
          text(caption, { size: "xs", color: MUTED }),
        ],
      },
      ...(buttons.length > 0
        ? { footer: { type: "box", layout: "vertical", spacing: "sm", contents: buttons } }
        : {}),
    },
  };
}
