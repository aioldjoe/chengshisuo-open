import crypto from "node:crypto";

/**
 * LINE 水管層（zero know-how）。移植自 littleboss-line-bot，
 * 個人版裁剪：不進群組，砍掉 group/room 的名稱與成員查詢。
 */

const LINE_API = "https://api.line.me/v2/bot";
const LINE_DATA_API = "https://api-data.line.me/v2/bot";

/** 驗證 webhook 簽章：HMAC-SHA256(channelSecret, rawBody) 的 base64 === X-Line-Signature。 */
export function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  // 兩者長度需一致才能 timingSafeEqual
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export type LineEventSource = {
  type?: "user" | "group" | "room";
  userId?: string;
};

export type LineMessage =
  | { type: "text"; id?: string; text: string }
  | { type: "audio"; id: string; duration?: number }
  | { type: "file"; id: string; fileName: string; fileSize?: number }
  | { type: "image"; id: string }
  | { type: "video"; id: string }
  | { type: "sticker"; id?: string };

export type LineMessageEvent = {
  type: "message";
  replyToken: string;
  /** 事件時間（ms epoch）。 */
  timestamp?: number;
  message: LineMessage;
  source: LineEventSource;
};

/** 加好友（或解除封鎖）事件——歡迎訊息的觸發點（issue #18）。 */
export type LineFollowEvent = {
  type: "follow";
  replyToken: string;
  timestamp?: number;
  source: LineEventSource;
};

/**
 * webhook 一包裡我們認得的事件。實際還會混進 unfollow 等沒列的型別——
 * 它們的 type 兩個分支都對不上，會被 webhook 的 type 檢查安靜略過。
 */
export type LineWebhookEvent = LineMessageEvent | LineFollowEvent;

/**
 * 下載訊息夾帶的內容（錄音檔／原生語音訊息）。
 * LINE 不承諾內容保留期——webhook 一進來就要呼叫這支落地。
 * 音訊可能還在轉檔（202），小退避重試幾次。
 */
export async function getMessageContent(
  messageId: string,
): Promise<{ data: Buffer; contentType: string }> {
  for (let attempt = 0; ; attempt++) {
    const res = await lineFetch(`${LINE_DATA_API}/message/${messageId}/content`, {}, [200, 202]);
    if (res.status === 200) {
      const contentType = res.headers.get("content-type") ?? "application/octet-stream";
      return { data: Buffer.from(await res.arrayBuffer()), contentType };
    }
    if (attempt >= 4) throw new Error(`LINE content ${messageId} 轉檔逾時（202 x${attempt + 1}）`);
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
}

async function lineFetch(
  url: string,
  init: RequestInit = {},
  okStatuses: number[] = [200],
): Promise<Response> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKEN 未設定");
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}` },
  });
  if (!okStatuses.includes(res.status)) {
    const body = await res.text();
    throw new Error(`LINE API failed ${res.status} ${url}: ${body.slice(0, 300)}`);
  }
  return res;
}

/**
 * Flex 訊息。contents 的組裝一律在 lib/flex.ts（純函式、可測）——這裡是水管，
 * 只認得「一包 JSON」。altText 是通知列與不支援環境唯一看得到的字，必須是一句完整的話。
 */
export type FlexMessage = { type: "flex"; altText: string; contents: unknown; quickReply?: QuickReply };

/** Quick reply：貼在一則訊息下面的一排按鈕，使用者回過任何話就消失——適合「下一步」提示。 */
export type QuickReply = {
  items: { type: "action"; action: { type: "message"; label: string; text: string } }[];
};

export type OutgoingMessage = { type: "text"; text: string; quickReply?: QuickReply } | FlexMessage;

/**
 * LINE 單次上限 5 則；文字截在 5000 字元限制內、altText 截在 400 字元限制內——
 * altText 會內插 LLM 產的會議標題，超長會讓整包被打回 400。
 */
function clampMessages(messages: OutgoingMessage[]): OutgoingMessage[] {
  return messages
    .slice(0, 5)
    .map((m) =>
      m.type === "text"
        ? { ...m, text: m.text.slice(0, 4900) }
        : { ...m, altText: m.altText.slice(0, 400) },
    );
}

/** 用 replyToken 回覆（免費，不吃 push 額度）。文字與 Flex 可以混在同一次。 */
export async function replyFlex(replyToken: string, messages: OutgoingMessage[]): Promise<void> {
  await lineFetch(`${LINE_API}/message/reply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ replyToken, messages: clampMessages(messages) }),
  });
}

/**
 * 主動推播（計入每月訊息額度——免費方案 200 則/月）。
 * 只用在「記錄頁整理完成」這一刻；其他一律走 reply。
 */
export async function pushFlex(to: string, messages: OutgoingMessage[]): Promise<void> {
  await lineFetch(`${LINE_API}/message/push`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to, messages: clampMessages(messages) }),
  });
}

/** 純文字版收窄。 */
export async function replyText(replyToken: string, texts: string[]): Promise<void> {
  await replyFlex(replyToken, texts.map((text) => ({ type: "text", text })));
}

export async function pushText(to: string, texts: string[]): Promise<void> {
  await pushFlex(to, texts.map((text) => ({ type: "text", text })));
}

/**
 * Flex 發不出去（payload 被 LINE 打回等）就退回純文字——lib/upsell.ts 的字串版
 * 說的是同一件事，是 issue #17 指名要保留的 fallback。reply 失敗時 token 沒被消耗，重送得了。
 * messages 為 null 表示卡本來就出不了（如 Stripe 沒接好），直接走文字。
 */
async function sendFlexOrText(
  send: (messages: OutgoingMessage[]) => Promise<void>,
  messages: OutgoingMessage[] | null,
  fallbackText: string,
): Promise<void> {
  if (messages) {
    try {
      await send(messages);
      return;
    } catch (e) {
      console.error("[line] Flex 發送失敗，退回純文字", e);
    }
  }
  await send([{ type: "text", text: fallbackText }]);
}

export async function replyFlexOrText(
  replyToken: string,
  messages: OutgoingMessage[] | null,
  fallbackText: string,
): Promise<void> {
  await sendFlexOrText((m) => replyFlex(replyToken, m), messages, fallbackText);
}

export async function pushFlexOrText(
  to: string,
  messages: OutgoingMessage[] | null,
  fallbackText: string,
): Promise<void> {
  await sendFlexOrText((m) => pushFlex(to, m), messages, fallbackText);
}

/**
 * 圖文選單（rich menu）的水管（issue #18）。選單長什麼樣、四格做什麼在
 * lib/onboarding.ts；這裡只負責跟 LINE API 的四步：建、上圖、設預設、刪。
 * 只有 scripts/setup-richmenu.ts 會呼叫——選單是部署期一次性設定，不在 runtime 動。
 */
export async function createRichMenu(menu: unknown): Promise<string> {
  const res = await lineFetch(`${LINE_API}/richmenu`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(menu),
  });
  const { richMenuId } = (await res.json()) as { richMenuId: string };
  return richMenuId;
}

export async function uploadRichMenuImage(richMenuId: string, png: Buffer): Promise<void> {
  // 上圖走 api-data（跟下載訊息內容同一個 host），不是 api.line.me
  await lineFetch(`${LINE_DATA_API}/richmenu/${richMenuId}/content`, {
    method: "POST",
    headers: { "content-type": "image/png" },
    body: new Uint8Array(png),
  });
}

/** 設成所有人的預設選單（沒個別綁定的人都看這張）。 */
export async function setDefaultRichMenu(richMenuId: string): Promise<void> {
  await lineFetch(`${LINE_API}/user/all/richmenu/${richMenuId}`, { method: "POST" });
}

export async function listRichMenus(): Promise<{ richMenuId: string; name: string }[]> {
  const res = await lineFetch(`${LINE_API}/richmenu/list`);
  const { richmenus } = (await res.json()) as {
    richmenus?: { richMenuId: string; name: string }[];
  };
  return richmenus ?? [];
}

export async function deleteRichMenu(richMenuId: string): Promise<void> {
  await lineFetch(`${LINE_API}/richmenu/${richMenuId}`, { method: "DELETE" });
}
