import { describe, expect, it } from "vitest";

import { isIos, isLineInAppBrowser, withExternalBrowser } from "./browser";

// 真的抓來的 UA 字串——這個判斷只要錯一次，匯出鈕在主要通路上就是靜默失效
const LINE_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1 Line/14.11.0/IAB";
const LINE_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 Line/14.10.1";
const SAFARI_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

describe("isLineInAppBrowser", () => {
  it("LINE 內建瀏覽器（iOS／Android）認得出來", () => {
    expect(isLineInAppBrowser(LINE_IOS)).toBe(true);
    expect(isLineInAppBrowser(LINE_ANDROID)).toBe(true);
  });

  it("一般瀏覽器不誤判", () => {
    expect(isLineInAppBrowser(SAFARI_IOS)).toBe(false);
    expect(isLineInAppBrowser(CHROME_MAC)).toBe(false);
    expect(isLineInAppBrowser("")).toBe(false);
  });

  it("不被字串裡剛好含 line 的產品名騙到", () => {
    expect(isLineInAppBrowser("Mozilla/5.0 Outline/2.1 Skyline/3 Safari/604.1")).toBe(false);
  });
});

describe("isIos", () => {
  it("iPhone 認得出來（LINE 內建與 Safari 都是）", () => {
    expect(isIos(LINE_IOS)).toBe(true);
    expect(isIos(SAFARI_IOS)).toBe(true);
  });

  it("Android 與桌機不誤判", () => {
    expect(isIos(LINE_ANDROID)).toBe(false);
    expect(isIos(CHROME_MAC)).toBe(false);
    expect(isIos("")).toBe(false);
  });
});

describe("withExternalBrowser", () => {
  it("加上 openExternalBrowser=1——3DS 驗證頁在 WKWebView 會卡死，得逼外部瀏覽器", () => {
    expect(withExternalBrowser("https://buy.stripe.com/abc")).toBe(
      "https://buy.stripe.com/abc?openExternalBrowser=1",
    );
  });

  it("已有 query 用 & 接", () => {
    expect(withExternalBrowser("https://x/y?a=1")).toBe("https://x/y?a=1&openExternalBrowser=1");
  });

  it("有 fragment 時參數插在 # 前（Stripe checkout URL 帶長 fragment）", () => {
    expect(withExternalBrowser("https://checkout.stripe.com/c/pay/cs_123#frag")).toBe(
      "https://checkout.stripe.com/c/pay/cs_123?openExternalBrowser=1#frag",
    );
  });
});
