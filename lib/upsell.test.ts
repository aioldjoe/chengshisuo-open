import { describe, expect, it } from "vitest";

import {
  failureText,
  fmtHoursZh,
  quotaBlockedLead,
  quotaBlockedText,
  upgradeText,
  usageText,
} from "./upsell";

const links = { lite: "https://pay/lite", standard: "https://pay/std" };

describe("fmtHoursZh", () => {
  it("不足一小時講分鐘，超過講小時（一位小數，整數不留 .0）", () => {
    expect(fmtHoursZh(0)).toBe("0 分鐘");
    expect(fmtHoursZh(45 * 60)).toBe("45 分鐘");
    expect(fmtHoursZh(3600)).toBe("1 小時");
    expect(fmtHoursZh(2.5 * 3600)).toBe("2.5 小時");
    expect(fmtHoursZh(2.54 * 3600)).toBe("2.5 小時");
  });
});

describe("quotaBlockedText", () => {
  it("免費撞月場次 → 講清楚何時恢復，並把兩檔付款連結遞出去（不是靜默拒收）", () => {
    const t = quotaBlockedText("free", "monthly-meetings", null, links);
    expect(t).toContain("3 場");
    expect(t).toContain("下個月");
    expect(t).toContain(links.lite);
    expect(t).toContain(links.standard);
  });

  it("免費撞單場上限 → 打升級點：升級後單場不限長", () => {
    const t = quotaBlockedText("free", "too-long", 2.5 * 3600, links);
    expect(t).toContain("2.5 小時");
    expect(t).toContain("不限長");
    expect(t).toContain(links.lite);
  });

  it("時長不明時不硬掰數字", () => {
    expect(quotaBlockedText("free", "too-long", null, links)).not.toContain("約 ");
  });

  it("輕量撞月時數 → 往上指標準檔，不往下指輕量（不會叫人買已經買了的）", () => {
    const t = quotaBlockedText("lite", "monthly-hours", null, links);
    expect(t).toContain("10 小時");
    expect(t).not.toContain("1 號"); // 付費額度不是 1 號回來的
    expect(t).toContain(links.standard);
    expect(t).not.toContain(links.lite);
  });

  it("標準撞月時數 → 沒有更上面的檔可賣，只講恢復時間", () => {
    const t = quotaBlockedText("standard", "monthly-hours", null, links);
    expect(t).toContain("40 小時");
    expect(t).toContain("扣款日");
    expect(t).not.toContain("https://pay");
  });

  it("付費撞額度會講出下次扣款的日期（台北時間）", () => {
    // UTC 9/20 20:00 = 台北 9/21 04:00，講的要是 21 日
    const t = quotaBlockedText("lite", "monthly-hours", null, links, "2026-09-20T20:00:00.000Z");
    expect(t).toContain("9 月 21 日");
  });

  it("沒有帳期資料時退回不講日期的說法，不吐 Invalid Date", () => {
    const t = quotaBlockedText("lite", "monthly-hours", null, links, "壞掉的日期");
    expect(t).toContain("下次扣款日自動恢復");
    expect(t).not.toContain("Invalid");
  });

  it("免費撞場次仍講「下個月 1 號」——免費額度確實是日曆月", () => {
    expect(quotaBlockedText("free", "monthly-meetings", null, links)).toContain("下個月 1 號");
  });

  it("Stripe 還沒接好（沒有連結）也要能說人話，不能吐半截訊息", () => {
    const t = quotaBlockedText("free", "monthly-meetings", null, {});
    expect(t).toContain("下個月");
    expect(t).not.toContain("undefined");
    expect(t).not.toContain("null");
  });
});

describe("quotaBlockedLead", () => {
  it("只有說明段（為什麼、何時恢復），沒有連結——Flex 路徑的連結由付款卡出", () => {
    const t = quotaBlockedLead("free", "monthly-meetings", null);
    expect(t).toContain("下個月 1 號");
    expect(t).not.toContain("https://");
  });

  it("是整句版的開頭——兩個版本說的是同一件事", () => {
    const lead = quotaBlockedLead("lite", "monthly-hours", null, "2026-09-20T20:00:00.000Z");
    const full = quotaBlockedText("lite", "monthly-hours", null, links, "2026-09-20T20:00:00.000Z");
    expect(full.startsWith(lead)).toBe(true);
  });

  it("撞單場上限時帶升級點（不限長）", () => {
    expect(quotaBlockedLead("free", "too-long", 2.5 * 3600)).toContain("不限長");
  });
});

describe("usageText", () => {
  it("免費檔講場數與單場上限", () => {
    const t = usageText("free", { meetings: 2, seconds: 4000 }, links, null);
    expect(t).toContain("2 / 3 場");
    expect(t).toContain("1 小時");
  });

  it("付費檔講時數，並提記錄頁永久保留與下次恢復時間", () => {
    const t = usageText("lite", { meetings: 9, seconds: 3.5 * 3600 }, links, null, "2026-09-20T00:00:00.000Z");
    expect(t).toContain("3.5 小時 / 10 小時");
    expect(t).toContain("永久");
    expect(t).toContain("9 月 20 日");
    expect(t).not.toContain("這個月"); // 付費是「這一期」，不是日曆月
  });

  it("有訂閱管理連結就附上（換檔、取消、換卡都在那裡）", () => {
    const t = usageText("lite", { meetings: 1, seconds: 0 }, links, "https://portal");
    expect(t).toContain("https://portal");
  });
});

describe("upgradeText", () => {
  it("免費用戶問方案 → 兩檔都報，含價格與額度", () => {
    const t = upgradeText("free", links, null);
    expect(t).toContain("NT$99");
    expect(t).toContain("NT$399");
    expect(t).toContain(links.lite);
    expect(t).toContain(links.standard);
  });

  it("已在輕量檔 → 只報升級到標準，另附管理訂閱", () => {
    const t = upgradeText("lite", links, "https://portal");
    expect(t).toContain("NT$399");
    expect(t).toContain("https://portal");
    expect(t).not.toContain(links.lite);
  });

  it("已在標準檔 → 沒得升，講現況與管理入口", () => {
    const t = upgradeText("standard", links, "https://portal");
    expect(t).toContain("標準");
    expect(t).toContain("https://portal");
    expect(t).not.toContain("https://pay");
  });

  it("Stripe 沒接好 → 告訴使用者稍後再試，不是丟一段空白", () => {
    const t = upgradeText("free", {}, null);
    expect(t.length).toBeGreaterThan(10);
    expect(t).not.toContain("undefined");
  });

  it("指名輕量檔（定價卡按鈕預填）→ 只回那一檔的付款卡，少一次選擇（issue #16）", () => {
    const t = upgradeText("free", links, null, "lite");
    expect(t).toContain("NT$99");
    expect(t).toContain(links.lite);
    expect(t).not.toContain(links.standard);
  });

  it("指名標準檔 → 只回標準", () => {
    const t = upgradeText("free", links, null, "standard");
    expect(t).toContain("NT$399");
    expect(t).toContain(links.standard);
    expect(t).not.toContain(links.lite);
  });

  it("輕量用戶指名輕量檔——已經有了，退回一般說法（只往上賣標準）", () => {
    const t = upgradeText("lite", links, "https://portal", "lite");
    expect(t).toContain(links.standard);
    expect(t).not.toContain(links.lite);
    expect(t).toContain("https://portal");
  });

  it("指名檔次但 Stripe 沒接好 → 退回 NO_LINKS 說法，不吐半截訊息", () => {
    const t = upgradeText("free", {}, null, "lite");
    expect(t).toContain("開通中");
    expect(t).not.toContain("undefined");
  });
});

describe("failureText", () => {
  it("Scribe 嫌檔案太大 → 講明是檔案大小，不是泛用道歉", () => {
    const t = failureText(new Error("ElevenLabs STT 413: file too large"));
    expect(t).toContain("單檔上限");
    expect(t).not.toContain("處理失敗了");
  });

  it("函式逾時 → 講明是太長，給分段的出路", () => {
    expect(failureText(new Error("Task timed out after 300 seconds"))).toContain("分段");
  });

  it("LINE 下載不回來 → 講明是檔案沒收完", () => {
    expect(failureText(new Error("LINE content m1 轉檔逾時（202 x5）"))).toContain("沒收完");
  });

  it("認不出的錯誤 → 回原本那句泛用道歉（不亂猜原因）", () => {
    const t = failureText(new Error("something odd"));
    expect(t).toContain("再傳一次");
  });

  it("不是 Error 的東西也不會炸", () => {
    expect(failureText("boom").length).toBeGreaterThan(10);
    expect(failureText(null).length).toBeGreaterThan(10);
  });
});
