import { describe, expect, it } from "vitest";

import type { LineMessageEvent } from "./line";
import { audioFilename, DEMO_PREFILL_MESSAGE, route, UPGRADE_PREFILL_MESSAGES } from "./routing";

const base = (over: Partial<LineMessageEvent>): LineMessageEvent => ({
  type: "message",
  replyToken: "rt",
  timestamp: 1755000000000,
  source: { type: "user", userId: "U1" },
  message: { type: "text", text: "hi" },
  ...over,
});

describe("route", () => {
  it("原生語音訊息 → meeting-audio，檔名由時間造，時長帶著走（毫秒換秒）", () => {
    const r = route(base({ message: { type: "audio", id: "m1", duration: 60000 } }));
    expect(r).toMatchObject({ kind: "meeting-audio", messageId: "m1", durationSeconds: 60 });
    if (r.kind === "meeting-audio") expect(r.filename).toMatch(/^錄音-\d{8}-\d{4}\.m4a$/);
  });

  it(".m4a 檔案訊息 → meeting-audio，保留原檔名", () => {
    const r = route(base({ message: { type: "file", id: "m2", fileName: "週會 2026-08-12.M4A" } }));
    expect(r).toEqual({
      kind: "meeting-audio",
      messageId: "m2",
      filename: "週會 2026-08-12.M4A",
      durationSeconds: null,
    });
  });

  it("非音檔的檔案 → decline（只說一件事）", () => {
    expect(route(base({ message: { type: "file", id: "m3", fileName: "報價單.pdf" } }))).toEqual({
      kind: "decline",
    });
  });

  it("圖片 → decline", () => {
    expect(route(base({ message: { type: "image", id: "m4" } }))).toEqual({ kind: "decline" });
  });

  it("文字剛好等於解鎖碼 → unlock（前後空白容忍，大小寫不容忍）", () => {
    const opts = { unlockCode: "test-unlock-code" };
    expect(route(base({ message: { type: "text", text: " test-unlock-code " } }), opts)).toEqual({ kind: "unlock" });
    expect(route(base({ message: { type: "text", text: "KAIMEN-2026" } }), opts).kind).toBe("text");
  });

  it("沒設解鎖碼時，任何文字都不會 unlock（空字串也不算）", () => {
    expect(route(base({ message: { type: "text", text: "" } }), { unlockCode: "" }).kind).toBe("text");
    expect(route(base({ message: { type: "text", text: "x" } }), { unlockCode: null }).kind).toBe("text");
  });

  it("文字 → text", () => {
    expect(route(base({ message: { type: "text", text: "這是什麼？" } }))).toEqual({
      kind: "text",
      text: "這是什麼？",
    });
  });

  it("超長的原生語音照樣是 meeting-audio——收不收由方案決定，分流不知道誰付了錢", () => {
    const r = route(base({ message: { type: "audio", id: "m7", duration: 4 * 3600_000 } }));
    expect(r).toMatchObject({ kind: "meeting-audio", messageId: "m7", durationSeconds: 4 * 3600 });
  });

  it("檔案訊息沒有時長 → null（要下載才量得到）", () => {
    const r = route(base({ message: { type: "file", id: "m8", fileName: "a.m4a" } }));
    expect(r).toMatchObject({ kind: "meeting-audio", durationSeconds: null });
  });

  it("升級關鍵字 → upgrade（LINE 裡發付款連結的入口）", () => {
    for (const text of ["升級", "我要訂閱", "方案", "付費", "怎麼收費"]) {
      expect(route(base({ message: { type: "text", text } })).kind).toBe("upgrade");
    }
  });

  it("定價卡預填的訊息 → upgrade 且帶檔次——按鈕送出的那句一定要少掉一次選擇（issue #16）", () => {
    expect(route(base({ message: { type: "text", text: UPGRADE_PREFILL_MESSAGES.lite } }))).toEqual({
      kind: "upgrade",
      want: "lite",
    });
    expect(
      route(base({ message: { type: "text", text: UPGRADE_PREFILL_MESSAGES.standard } })),
    ).toEqual({ kind: "upgrade", want: "standard" });
  });

  it("沒指名檔次的升級話語 want 是 null——照舊兩檔都列", () => {
    expect(route(base({ message: { type: "text", text: "升級" } }))).toEqual({
      kind: "upgrade",
      want: null,
    });
  });

  it("「收費標準」是在問價，不是指名標準檔——want 認「標準檔」不認「標準」", () => {
    expect(route(base({ message: { type: "text", text: "收費標準是什麼" } }))).toEqual({
      kind: "upgrade",
      want: null,
    });
  });

  it("問額度／用量 → usage", () => {
    for (const text of ["額度", "我這個月用了多少", "用量"]) {
      expect(route(base({ message: { type: "text", text } })).kind).toBe("usage");
    }
  });

  it("QR 預填的那句話 → demo——掃碼後的第一次互動一定要有回應（issue #15）", () => {
    expect(route(base({ message: { type: "text", text: DEMO_PREFILL_MESSAGE } })).kind).toBe("demo");
  });

  it("問範例／示範 → demo", () => {
    for (const text of ["範例", "有示範嗎", "我想看範例"]) {
      expect(route(base({ message: { type: "text", text } })).kind).toBe("demo");
    }
  });

  it("問怎麼用／怎麼傳 → howto（圖文選單第一格送出的就是這句，issue #18）", () => {
    for (const text of ["怎麼用", "怎麼傳錄音？", "有教學嗎"]) {
      expect(route(base({ message: { type: "text", text } })).kind).toBe("howto");
    }
  });

  it("「怎麼收費」問的是價不是用法——upgrade 要壓過 howto", () => {
    expect(route(base({ message: { type: "text", text: "怎麼收費" } })).kind).toBe("upgrade");
  });

  it("升級與刪除的關鍵字都沾不上的一般文字仍是 text", () => {
    expect(route(base({ message: { type: "text", text: "今天天氣真好" } })).kind).toBe("text");
  });

  it("帶「刪除＋全部/所有」的文字 → delete-all-request（一句話刪除全部）", () => {
    expect(route(base({ message: { type: "text", text: "刪除全部資料" } }))).toEqual({
      kind: "delete-all-request",
    });
    expect(route(base({ message: { type: "text", text: "我要刪除所有資料" } }))).toEqual({
      kind: "delete-all-request",
    });
  });

  it("確認短語（完全一致）→ delete-all-confirm", () => {
    expect(route(base({ message: { type: "text", text: "確認刪除全部" } }))).toEqual({
      kind: "delete-all-confirm",
    });
    expect(route(base({ message: { type: "text", text: "  確認刪除全部\n" } }))).toEqual({
      kind: "delete-all-confirm",
    });
  });

  it("只提刪除但不是全部 → 一般文字（單場刪除在記錄頁做）", () => {
    expect(route(base({ message: { type: "text", text: "怎麼刪除一場會議？" } }))).toEqual({
      kind: "text",
      text: "怎麼刪除一場會議？",
    });
  });

  it("群組來源 → ignore（不進群組）", () => {
    const r = route(
      base({ source: { type: "group", userId: "U1" }, message: { type: "audio", id: "m5" } }),
    );
    expect(r).toEqual({ kind: "ignore" });
  });
});

describe("audioFilename", () => {
  it("用台北時間組檔名", () => {
    // 2025-08-12T12:00:00Z → 台北 20:00
    expect(audioFilename(Date.UTC(2025, 7, 12, 12, 0))).toBe("錄音-20250812-2000.m4a");
  });
});
