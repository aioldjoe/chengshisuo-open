import { afterEach, describe, expect, it } from "vitest";

import { demoPageUrl, meetingPageUrl } from "./urls";

afterEach(() => {
  delete process.env.NEXT_PUBLIC_LIFF_ID;
  delete process.env.APP_BASE_URL;
});

describe("meetingPageUrl", () => {
  it("有 LIFF ID → liff.line.me 深連結（在 LINE 內開啟、自動登入）", () => {
    process.env.NEXT_PUBLIC_LIFF_ID = "2011095626-Txp2jcrX";
    expect(meetingPageUrl("abc-123")).toBe("https://liff.line.me/2011095626-Txp2jcrX/m/abc-123");
  });

  it("沒有 LIFF ID → 退回 APP_BASE_URL 直連（本機開發）", () => {
    process.env.APP_BASE_URL = "http://localhost:3000";
    expect(meetingPageUrl("abc-123")).toBe("http://localhost:3000/m/abc-123");
  });
});

describe("demoPageUrl", () => {
  it("示範頁是公開頁，不走 LIFF——就算設了 LIFF ID 也直連", () => {
    process.env.NEXT_PUBLIC_LIFF_ID = "2011095626-Txp2jcrX";
    process.env.APP_BASE_URL = "https://chengshisuo.com";
    expect(demoPageUrl()).toBe("https://chengshisuo.com/demo");
  });
});
