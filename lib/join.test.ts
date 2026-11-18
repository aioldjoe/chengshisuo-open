import { afterEach, describe, expect, it } from "vitest";

import {
  BLOG_REF,
  JOIN_REFS,
  joinHref,
  joinRedirect,
  joinTargetUrl,
  normalizeRef,
  oaMessageUrl,
  upgradeTargetUrl,
} from "./join";
import { UPGRADE_PREFILL_MESSAGES } from "./routing";

afterEach(() => {
  delete process.env.NEXT_PUBLIC_LINE_OA_ID;
  delete process.env.LINE_ADD_FRIEND_URL_SHARE;
  delete process.env.LINE_ADD_FRIEND_URL_DEMO;
  delete process.env.LINE_ADD_FRIEND_URL_TRIAL;
  delete process.env.LINE_ADD_FRIEND_URL_BLOG;
});

describe("normalizeRef", () => {
  it("認得的來源原樣留下", () => {
    expect(normalizeRef("share")).toBe("share");
    expect(normalizeRef("demo")).toBe("demo");
  });

  it("trial 是認得的來源（issue #19：試用頁的加好友要單獨算）", () => {
    expect(normalizeRef("trial")).toBe("trial");
  });

  it("blog 是認得的來源——SEO 是唯一「很久以後才看得到結果」的獲客路徑，沒數字就只能憑感覺猜", () => {
    expect(normalizeRef("blog")).toBe("blog");
    expect(JOIN_REFS).toContain(BLOG_REF);
  });

  it("沒帶、空字串、不認得的都是 null——ref 會進事件表，不能讓路人自己造欄位值", () => {
    expect(normalizeRef(undefined)).toBeNull();
    expect(normalizeRef(null)).toBeNull();
    expect(normalizeRef("")).toBeNull();
    expect(normalizeRef("SHARE")).toBeNull();
    expect(normalizeRef("../../etc/passwd")).toBeNull();
  });
});

describe("blog 來源", () => {
  it("有自己的「加入好友管道」欄位，跟其他迴路分開數", () => {
    process.env.NEXT_PUBLIC_LINE_OA_ID = "@123abcd";
    process.env.LINE_ADD_FRIEND_URL_BLOG = "https://line.me/R/ti/p/%40123abcd?aid=blog";
    expect(joinTargetUrl(BLOG_REF)).toBe("https://line.me/R/ti/p/%40123abcd?aid=blog");
    // 沒設專屬管道時退回一般連結，CTA 照樣能按
    delete process.env.LINE_ADD_FRIEND_URL_BLOG;
    expect(joinTargetUrl(BLOG_REF)).toBe("https://line.me/R/ti/p/%40123abcd");
  });

  it("點擊記得到——文章頁的 CTA 走 /join?ref=blog，跳轉前先進事件表", () => {
    process.env.NEXT_PUBLIC_LINE_OA_ID = "@123abcd";
    expect(joinHref(BLOG_REF)).toBe("/join?ref=blog");
    const r = joinRedirect("https://chengshisuo.com/join?ref=blog");
    expect(r.ref).toBe("blog");
    expect(r.countable).toBe(true);
  });
});

describe("joinTargetUrl", () => {
  it("預設走 OA basic ID 的加好友連結", () => {
    process.env.NEXT_PUBLIC_LINE_OA_ID = "@123abcd";
    expect(joinTargetUrl(null)).toBe("https://line.me/R/ti/p/%40123abcd");
    expect(joinTargetUrl("share")).toBe("https://line.me/R/ti/p/%40123abcd");
  });

  it("該來源設了「加入好友管道」網址就用它——那條才數得到真的加好友", () => {
    process.env.NEXT_PUBLIC_LINE_OA_ID = "@123abcd";
    process.env.LINE_ADD_FRIEND_URL_SHARE = "https://line.me/R/ti/p/%40123abcd?oat_content=url&aid=xyz";
    expect(joinTargetUrl("share")).toBe("https://line.me/R/ti/p/%40123abcd?oat_content=url&aid=xyz");
    // 沒有來源就沒有管道可選，回一般連結
    expect(joinTargetUrl(null)).toBe("https://line.me/R/ti/p/%40123abcd");
  });

  it("demo 來源走自己的管道網址，不跟 share 混——兩條迴路的加好友要分開數", () => {
    process.env.NEXT_PUBLIC_LINE_OA_ID = "@123abcd";
    process.env.LINE_ADD_FRIEND_URL_SHARE = "https://line.me/R/ti/p/%40123abcd?aid=share";
    process.env.LINE_ADD_FRIEND_URL_DEMO = "https://line.me/R/ti/p/%40123abcd?aid=demo";
    expect(joinTargetUrl("demo")).toBe("https://line.me/R/ti/p/%40123abcd?aid=demo");
    // demo 的管道還沒開就退回一般連結，不能借用 share 的（數字會灌進錯的迴路）
    delete process.env.LINE_ADD_FRIEND_URL_DEMO;
    expect(joinTargetUrl("demo")).toBe("https://line.me/R/ti/p/%40123abcd");
  });

  it("trial 來源走自己的管道網址——試用迴路的加好友不跟 share／demo 混", () => {
    process.env.NEXT_PUBLIC_LINE_OA_ID = "@123abcd";
    process.env.LINE_ADD_FRIEND_URL_TRIAL = "https://line.me/R/ti/p/%40123abcd?aid=trial";
    expect(joinTargetUrl("trial")).toBe("https://line.me/R/ti/p/%40123abcd?aid=trial");
    delete process.env.LINE_ADD_FRIEND_URL_TRIAL;
    expect(joinTargetUrl("trial")).toBe("https://line.me/R/ti/p/%40123abcd");
  });

  it("OA ID 還沒設就沒有連結可去", () => {
    expect(joinTargetUrl("share")).toBeNull();
  });
});

describe("oaMessageUrl", () => {
  it("oaMessage 深連結：點開進聊天室、輸入框已有預填訊息（issue #15）", () => {
    process.env.NEXT_PUBLIC_LINE_OA_ID = "@123abcd";
    expect(oaMessageUrl("看範例")).toBe(
      "https://line.me/R/oaMessage/%40123abcd/?%E7%9C%8B%E7%AF%84%E4%BE%8B",
    );
  });

  it("沒設 OA ID → null（首頁整塊不渲染，跟 ctaNote 的退路一致）", () => {
    expect(oaMessageUrl("看範例")).toBeNull();
  });

  it("「加入好友管道」網址不影響深連結——那種網址帶不了預填訊息", () => {
    process.env.NEXT_PUBLIC_LINE_OA_ID = "@123abcd";
    process.env.LINE_ADD_FRIEND_URL_SHARE = "https://line.me/R/ti/p/%40123abcd?aid=share";
    expect(oaMessageUrl("看範例")).toBe(
      "https://line.me/R/oaMessage/%40123abcd/?%E7%9C%8B%E7%AF%84%E4%BE%8B",
    );
  });
});

describe("upgradeTargetUrl", () => {
  it("定價卡按鈕的深連結：預填的正是分流認得檔次的那句話（issue #16）", () => {
    process.env.NEXT_PUBLIC_LINE_OA_ID = "@123abcd";
    expect(upgradeTargetUrl("lite")).toBe(
      `https://line.me/R/oaMessage/%40123abcd/?${encodeURIComponent(UPGRADE_PREFILL_MESSAGES.lite)}`,
    );
    expect(upgradeTargetUrl("standard")).toBe(
      `https://line.me/R/oaMessage/%40123abcd/?${encodeURIComponent(UPGRADE_PREFILL_MESSAGES.standard)}`,
    );
  });

  it("沒設 OA ID → null（定價卡退回敘述文字）", () => {
    expect(upgradeTargetUrl("lite")).toBeNull();
  });
});

describe("joinHref", () => {
  it("CTA 指到中繼跳轉並帶上來源", () => {
    expect(joinHref("share")).toBe("/join?ref=share");
  });
});

describe("joinRedirect", () => {
  it("認得的 ref → 送去加好友頁，並且要記一筆", () => {
    process.env.NEXT_PUBLIC_LINE_OA_ID = "@123abcd";
    expect(joinRedirect("https://chengshisuo.com/join?ref=share")).toEqual({
      target: "https://line.me/R/ti/p/%40123abcd",
      ref: "share",
      countable: true,
    });
  });

  it("沒帶 ref 也算數——人還是被送到加好友頁了，只是不知道從哪來", () => {
    process.env.NEXT_PUBLIC_LINE_OA_ID = "@123abcd";
    expect(joinRedirect("https://chengshisuo.com/join")).toEqual({
      target: "https://line.me/R/ti/p/%40123abcd",
      ref: null,
      countable: true,
    });
  });

  it("沒設 OA ID → 退回首頁，而且不記——沒送到加好友頁就不是一次轉化", () => {
    expect(joinRedirect("http://localhost:3000/join?ref=share")).toEqual({
      target: "http://localhost:3000/",
      ref: "share",
      countable: false,
    });
  });
});
