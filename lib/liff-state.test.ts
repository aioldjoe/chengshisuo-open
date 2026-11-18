import { describe, expect, it } from "vitest";

import { resolveLiffState } from "./liff-state";

describe("resolveLiffState", () => {
  it("沒有 liff.state 回 null（一般人開首頁）", () => {
    expect(resolveLiffState(new URLSearchParams(""))).toBeNull();
    expect(resolveLiffState({})).toBeNull();
  });

  it("LINE 內開深連結：liff.state=/m/{id} → /m/{id}", () => {
    const sp = new URLSearchParams("liff.state=%2Fm%2F3744bdad-f848-4280-8c24-3f005f5733fd");
    expect(resolveLiffState(sp)).toBe("/m/3744bdad-f848-4280-8c24-3f005f5733fd");
  });

  it("Next 的 searchParams 物件也吃", () => {
    expect(resolveLiffState({ "liff.state": "/m/abc" })).toBe("/m/abc");
    expect(resolveLiffState({ "liff.state": ["/m/abc"] })).toBe("/m/abc");
  });

  it("外部瀏覽器登入回跳：code／state 等其他參數要原樣帶到目的頁", () => {
    const sp = new URLSearchParams(
      "liff.state=%2Fm%2Fabc&code=xyz&state=st1&liffClientId=2011&liffRedirectUri=https%3A%2F%2Fx",
    );
    const out = resolveLiffState(sp)!;
    expect(out.startsWith("/m/abc?")).toBe(true);
    const q = new URLSearchParams(out.split("?")[1]);
    expect(q.get("code")).toBe("xyz");
    expect(q.get("state")).toBe("st1");
    expect(q.get("liffClientId")).toBe("2011");
    expect(q.has("liff.state")).toBe(false);
  });

  it("liff.state 自帶 query 與 fragment 也保留", () => {
    const sp = new URLSearchParams("liff.state=" + encodeURIComponent("/m/abc?tab=1#top") + "&code=c");
    expect(resolveLiffState(sp)).toBe("/m/abc?tab=1&code=c#top");
  });

  it("擋 open redirect：非站內路徑一律當沒有", () => {
    expect(resolveLiffState(new URLSearchParams("liff.state=https%3A%2F%2Fevil.com"))).toBeNull();
    expect(resolveLiffState(new URLSearchParams("liff.state=%2F%2Fevil.com"))).toBeNull();
    expect(resolveLiffState(new URLSearchParams("liff.state=m%2Fabc"))).toBeNull();
  });
});

/**
 * 2026-08-23 桌機實測（影片）打臉了上面那條假設：外部瀏覽器登入完，LINE 回跳到
 * Endpoint URL 時**不帶 liff.state**，真正的目的地在 liffRedirectUri。
 * 首頁只認 liff.state，於是人被丟在落地頁，記錄頁再也回不去。
 */
describe("resolveLiffState — 外部瀏覽器登入回跳（真實 query）", () => {
  const REAL_CALLBACK =
    "code=8MTBydCXYWuXVoNbrdrS&state=f1iWRyVUbbfz&liffClientId=2011095626" +
    "&liffRedirectUri=" +
    encodeURIComponent("https://chengshisuo.com/m/5b42242c-090e-4097-b58d-0946a7df5d34");

  it("沒有 liff.state 時，改認 liffRedirectUri 的站內路徑", () => {
    const out = resolveLiffState(new URLSearchParams(REAL_CALLBACK));
    expect(out).not.toBeNull();
    expect(out!.startsWith("/m/5b42242c-090e-4097-b58d-0946a7df5d34?")).toBe(true);
  });

  it("code／state 要原樣帶到記錄頁，liff.init() 才接得完登入", () => {
    const q = new URLSearchParams(resolveLiffState(new URLSearchParams(REAL_CALLBACK))!.split("?")[1]);
    expect(q.get("code")).toBe("8MTBydCXYWuXVoNbrdrS");
    expect(q.get("state")).toBe("f1iWRyVUbbfz");
    expect(q.get("liffClientId")).toBe("2011095626");
  });

  it("liffRedirectUri 指回根路徑就當沒有——轉去同一頁會無限迴圈", () => {
    const sp = new URLSearchParams(
      "code=c&liffRedirectUri=" + encodeURIComponent("https://chengshisuo.com/"),
    );
    expect(resolveLiffState(sp)).toBeNull();
  });

  it("擋 open redirect：liffRedirectUri 指到別站也只取路徑，不會轉出站外", () => {
    const sp = new URLSearchParams(
      "code=c&liffRedirectUri=" + encodeURIComponent("https://evil.com/m/abc"),
    );
    const out = resolveLiffState(sp);
    expect(out === null || out.startsWith("/m/abc")).toBe(true);
  });
});
