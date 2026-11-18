import { describe, expect, it } from "vitest";

import { meetingReadyFlex, paymentCardFlex, taipeiDateLabel, usageCardFlex } from "./flex";

const links = { lite: "https://pay/lite", standard: "https://pay/std" };

/** 深層找出所有符合條件的節點（Flex JSON 是巢狀 box，測結構用）。 */
function findAll(node: unknown, pred: (n: Record<string, unknown>) => boolean): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === "object") {
      const rec = n as Record<string, unknown>;
      if (pred(rec)) out.push(rec);
      Object.values(rec).forEach(walk);
    }
  };
  walk(node);
  return out;
}

function uris(card: unknown): string[] {
  return findAll(card, (n) => n.type === "uri").map((n) => String(n.uri));
}

describe("paymentCardFlex", () => {
  it("免費用戶沒指名 → 兩檔 carousel，價格與付款按鈕都在", () => {
    const card = paymentCardFlex("free", links);
    expect(card).not.toBeNull();
    expect((card!.contents as { type: string }).type).toBe("carousel");
    const s = JSON.stringify(card);
    expect(s).toContain("NT$99");
    expect(s).toContain("NT$399");
    expect(s).toContain("用信用卡訂閱");
    expect(uris(card)).toEqual([
      "https://pay/lite?openExternalBrowser=1",
      "https://pay/std?openExternalBrowser=1",
    ]);
  });

  it("altText 是一句讀得通的話——通知列與不支援環境只看得到它", () => {
    const alt = paymentCardFlex("free", links)!.altText;
    expect(alt).not.toContain("Flex");
    expect(alt).toContain("NT$99");
    expect(alt).toContain("NT$399");
    expect(alt.length).toBeGreaterThan(20);
  });

  it("指名輕量檔 → 單一 bubble，只有那一檔", () => {
    const card = paymentCardFlex("free", links, "lite")!;
    expect((card.contents as { type: string }).type).toBe("bubble");
    const s = JSON.stringify(card);
    expect(s).toContain("NT$99");
    expect(s).not.toContain("NT$399");
    expect(card.altText).toContain("輕量");
  });

  it("輕量用戶 → 只賣標準檔（不叫人買已經買了的）", () => {
    const card = paymentCardFlex("lite", links)!;
    const s = JSON.stringify(card);
    expect(s).toContain("NT$399");
    expect(s).not.toContain(links.lite);
  });

  it("輕量用戶指名輕量（不比現在高）→ 當沒指名，照舊只往上賣", () => {
    const card = paymentCardFlex("lite", links, "lite")!;
    expect(JSON.stringify(card)).toContain("NT$399");
    expect(JSON.stringify(card)).not.toContain(links.lite);
  });

  it("標準用戶沒得升 → null（呼叫端退回純文字）", () => {
    expect(paymentCardFlex("standard", links)).toBeNull();
  });

  it("Stripe 沒接好（沒連結）→ null，不出沒有按鈕的卡", () => {
    expect(paymentCardFlex("free", {})).toBeNull();
  });

  it("只開通一檔就只出那一檔", () => {
    const card = paymentCardFlex("free", { standard: "https://pay/std" })!;
    expect((card.contents as { type: string }).type).toBe("bubble");
    expect(JSON.stringify(card)).not.toContain("NT$99");
  });

  it("卡上有 Stripe 安心小字與三行權益", () => {
    const s = JSON.stringify(paymentCardFlex("free", links, "lite"));
    expect(s).toContain("由 Stripe 處理");
    expect(s).toContain("看不到你的卡號");
    expect(s).toContain("10 小時");
    expect(s).toContain("單場不限長");
    expect(s).toContain("永久保留");
  });
});

describe("meetingReadyFlex", () => {
  const args = {
    title: "週會：Q3 產品線",
    dateLabel: "8 月 29 日",
    durationSeconds: 45 * 60,
    highlights: ["定價改月費制", "9 月上線", "第三點不該出現"],
    url: "https://liff.line.me/123/m/abc",
    pageDays: 30 as number | null,
  };

  it("altText 帶會議標題、讀得通", () => {
    const alt = meetingReadyFlex(args).altText;
    expect(alt).toContain("週會：Q3 產品線");
    expect(alt).toContain("整理好了");
  });

  it("卡上有標題、日期、時長（讀成人話）與前兩條重點——第三條不擠進來", () => {
    const s = JSON.stringify(meetingReadyFlex(args));
    expect(s).toContain("週會：Q3 產品線");
    expect(s).toContain("8 月 29 日");
    expect(s).toContain("45 分"); // 秒數要讀成人話，不能是「45:00」這種會被讀成時刻的字
    expect(s).toContain("定價改月費制");
    expect(s).toContain("9 月上線");
    expect(s).not.toContain("第三點不該出現");
  });

  it("打開記錄頁按鈕直連 LIFF——不加 openExternalBrowser（身分閘門要在 LINE 內走）", () => {
    expect(uris(meetingReadyFlex(args))).toEqual(["https://liff.line.me/123/m/abc"]);
  });

  it("免費講保留天數，付費講永久；銷毀規則都在", () => {
    const free = JSON.stringify(meetingReadyFlex(args));
    expect(free).toContain("保留 30 天");
    expect(free).toContain("72 小時");
    const paid = JSON.stringify(meetingReadyFlex({ ...args, pageDays: null }));
    expect(paid).toContain("永久保留");
  });

  it("沒有時長、沒有重點也出得了卡（轉寫欄位可能缺）", () => {
    const s = JSON.stringify(
      meetingReadyFlex({ ...args, durationSeconds: null, highlights: [] }),
    );
    expect(s).toContain("週會：Q3 產品線");
    expect(s).not.toContain("null");
  });
});

describe("usageCardFlex", () => {
  it("付費檔講小時＋進度條寬度按比例", () => {
    const card = usageCardFlex("lite", { meetings: 5, seconds: 7.2 * 3600 }, null, null);
    const s = JSON.stringify(card);
    expect(s).toContain("7.2 / 10 小時");
    const bars = findAll(card, (n) => typeof n.width === "string" && String(n.width).endsWith("%"));
    expect(bars.length).toBe(1);
    expect(bars[0].width).toBe("72%");
  });

  it("免費檔講場數", () => {
    const s = JSON.stringify(usageCardFlex("free", { meetings: 2, seconds: 0 }, null, null));
    expect(s).toContain("2 / 3 場");
  });

  it("用超過額度進度條停在 100%（付費單場照收可能超扣）", () => {
    const card = usageCardFlex("lite", { meetings: 9, seconds: 12 * 3600 }, null, null);
    const bars = findAll(card, (n) => typeof n.width === "string" && String(n.width).endsWith("%"));
    expect(bars[0].width).toBe("100%");
  });

  it("altText 讀得通、帶恢復時間", () => {
    const alt = usageCardFlex("lite", { meetings: 1, seconds: 3600 }, "2026-09-20T00:00:00.000Z", null).altText;
    expect(alt).toContain("1 / 10 小時");
    expect(alt).toContain("9 月 20 日");
  });

  it("免費卡的升級按鈕是預填訊息（送出會命中分流），不是裸連結", () => {
    const actions = findAll(
      usageCardFlex("free", { meetings: 0, seconds: 0 }, null, null),
      (n) => n.type === "message",
    );
    expect(actions.length).toBe(1);
    expect(String(actions[0].text)).toContain("方案");
  });

  it("輕量卡：升級按鈕預填「升級標準檔」＋管理訂閱走外部瀏覽器", () => {
    const card = usageCardFlex("lite", { meetings: 1, seconds: 0 }, null, "https://portal");
    const msgs = findAll(card, (n) => n.type === "message");
    expect(msgs.length).toBe(1);
    expect(msgs[0].text).toBe("升級標準檔");
    expect(uris(card)).toEqual(["https://portal?openExternalBrowser=1"]);
  });

  it("標準卡：沒有升級按鈕，只有管理訂閱", () => {
    const card = usageCardFlex("standard", { meetings: 1, seconds: 0 }, null, "https://portal");
    expect(findAll(card, (n) => n.type === "message").length).toBe(0);
    expect(uris(card).length).toBe(1);
  });
});

describe("taipeiDateLabel", () => {
  it("UTC 傍晚已是台北隔天", () => {
    expect(taipeiDateLabel("2026-08-29T20:00:00.000Z")).toBe("8 月 30 日");
    expect(taipeiDateLabel("2026-08-29T02:00:00.000Z")).toBe("8 月 29 日");
  });
});
