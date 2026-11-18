import { describe, expect, it } from "vitest";

import type { LineMessageEvent } from "./line";
import { HOWTO_GUIDE, RICH_MENU, richMenuObject, welcomeMessages } from "./onboarding";
import { route } from "./routing";

const textEvent = (text: string): LineMessageEvent => ({
  type: "message",
  replyToken: "rt",
  source: { type: "user", userId: "U1" },
  message: { type: "text", text },
});

describe("RICH_MENU 四格與 routing 的綁定", () => {
  // 選單按下去送出的是文字訊息，走的是跟打字一模一樣的分流——
  // 這條測試把「格子」跟「分流」綁死：改任何一邊，這裡會先叫。
  it("四格送出的文字各自命中正確的分流", () => {
    const expected = ["howto", "demo", "usage", "upgrade"] as const;
    expect(RICH_MENU.items).toHaveLength(4);
    RICH_MENU.items.forEach((item, i) => {
      expect(route(textEvent(item.text)).kind).toBe(expected[i]);
    });
  });

  it("方案格不指名檔次——兩檔都要列出來讓人選", () => {
    const planItem = RICH_MENU.items[3];
    expect(route(textEvent(planItem.text))).toEqual({ kind: "upgrade", want: null });
  });

  it("label 不超過 LINE 上限（rich menu 與 quick reply 都是 20 字）", () => {
    for (const item of RICH_MENU.items) {
      expect(item.label.length).toBeLessThanOrEqual(20);
      expect(item.text.length).toBeLessThanOrEqual(300);
    }
  });
});

describe("richMenuObject", () => {
  const menu = richMenuObject();

  it("尺寸是 LINE 認的 2500×1686，chatBarText 在 14 字內", () => {
    expect(menu.size).toEqual({ width: 2500, height: 1686 });
    expect(menu.chatBarText.length).toBeLessThanOrEqual(14);
    expect(menu.name.length).toBeGreaterThan(0);
  });

  it("四個區域不重疊地鋪滿整張圖——留縫的話點下去沒反應，使用者只會怪自己", () => {
    expect(menu.areas).toHaveLength(4);
    let covered = 0;
    for (const a of menu.areas) {
      expect(a.bounds.x).toBeGreaterThanOrEqual(0);
      expect(a.bounds.y).toBeGreaterThanOrEqual(0);
      expect(a.bounds.x + a.bounds.width).toBeLessThanOrEqual(2500);
      expect(a.bounds.y + a.bounds.height).toBeLessThanOrEqual(1686);
      covered += a.bounds.width * a.bounds.height;
    }
    expect(covered).toBe(2500 * 1686);
  });

  it("每格都是 message action，label 與文字照 RICH_MENU 的定義", () => {
    menu.areas.forEach((a, i) => {
      expect(a.action).toEqual({
        type: "message",
        label: RICH_MENU.items[i].label,
        text: RICH_MENU.items[i].text,
      });
    });
  });
});

describe("welcomeMessages（follow 事件的歡迎訊息）", () => {
  const messages = welcomeMessages();

  it("是一則文字訊息，帶四顆 quick reply——第一次互動不該是一片空白", () => {
    expect(messages).toHaveLength(1);
    const m = messages[0];
    expect(m.type).toBe("text");
    expect(m.quickReply?.items).toHaveLength(4);
  });

  it("quick reply 四顆跟圖文選單四格是同一組動作", () => {
    const items = messages[0].quickReply!.items;
    items.forEach((qr, i) => {
      expect(qr).toEqual({
        type: "action",
        action: {
          type: "message",
          label: RICH_MENU.items[i].label,
          text: RICH_MENU.items[i].text,
        },
      });
    });
  });

  it("歡迎詞講清楚唯一要做的事：傳錄音", () => {
    const m = messages[0];
    expect(m.type === "text" && m.text).toContain("錄音");
  });
});

describe("HOWTO_GUIDE（怎麼傳錄音的教學）", () => {
  it("涵蓋兩條路：LINE 直接錄、iPhone 語音備忘錄分享進來", () => {
    expect(HOWTO_GUIDE).toContain("麥克風");
    expect(HOWTO_GUIDE).toContain("語音備忘錄");
    expect(HOWTO_GUIDE).toContain("分享");
  });
});
