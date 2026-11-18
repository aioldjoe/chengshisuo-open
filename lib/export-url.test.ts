import { beforeAll, describe, expect, it } from "vitest";

import { EXPORT_TTL_MS, signedExportQuery, verifyExportQuery } from "./export-url";

const NOW = Date.parse("2026-08-23T10:00:00.000Z");

beforeAll(() => {
  process.env.LINE_CHANNEL_SECRET = "test-channel-secret";
});

const parse = (q: string) => new URLSearchParams(q);

describe("signedExportQuery / verifyExportQuery", () => {
  it("自己簽的自己驗得過", () => {
    const q = signedExportQuery("meeting-1", "docx", NOW);
    expect(verifyExportQuery("meeting-1", "docx", parse(q), NOW)).toBe(true);
  });

  it("過期就不認——網址外流也只有幾分鐘的窗", () => {
    const q = parse(signedExportQuery("meeting-1", "docx", NOW));
    expect(verifyExportQuery("meeting-1", "docx", q, NOW + EXPORT_TTL_MS - 1000)).toBe(true);
    expect(verifyExportQuery("meeting-1", "docx", q, NOW + EXPORT_TTL_MS + 1000)).toBe(false);
  });

  it("換一場會議的 id 不能沿用同一條簽章", () => {
    const q = parse(signedExportQuery("meeting-1", "docx", NOW));
    expect(verifyExportQuery("meeting-2", "docx", q, NOW)).toBe(false);
  });

  it("改簽章、改到期時間都驗不過", () => {
    const q = parse(signedExportQuery("meeting-1", "docx", NOW));
    const tamperedSig = new URLSearchParams(q);
    tamperedSig.set("s", "0".repeat(64));
    expect(verifyExportQuery("meeting-1", "docx", tamperedSig, NOW)).toBe(false);

    // 把到期時間往後改，簽章卻沒跟著換——這是最直覺的偽造手法
    const tamperedExp = new URLSearchParams(q);
    tamperedExp.set("e", String(Number(q.get("e")) + 3600_000));
    expect(verifyExportQuery("meeting-1", "docx", tamperedExp, NOW)).toBe(false);
  });

  it("用途不同就不通用——下載檔案的網址不能拿去換渲染用的頁面", () => {
    const q = parse(signedExportQuery("meeting-1", "docx", NOW));
    expect(verifyExportQuery("meeting-1", "page", q, NOW)).toBe(false);
    expect(verifyExportQuery("meeting-1", "pdf", q, NOW)).toBe(false);
    expect(verifyExportQuery("meeting-1", "docx", q, NOW)).toBe(true);
  });

  it("trial 用途可以指定較長的效期——試用頁要活 24 小時，不是按一下就好", () => {
    const DAY = 24 * 3600_000;
    const q = parse(signedExportQuery("meeting-1", "trial", NOW, DAY));
    expect(verifyExportQuery("meeting-1", "trial", q, NOW + DAY - 60_000)).toBe(true);
    expect(verifyExportQuery("meeting-1", "trial", q, NOW + DAY + 60_000)).toBe(false);
  });

  it("trial 的簽章換不到匯出，匯出的也換不到 trial——試用唯讀不給匯出", () => {
    const trial = parse(signedExportQuery("meeting-1", "trial", NOW, 24 * 3600_000));
    expect(verifyExportQuery("meeting-1", "docx", trial, NOW)).toBe(false);
    expect(verifyExportQuery("meeting-1", "page", trial, NOW)).toBe(false);
    const docx = parse(signedExportQuery("meeting-1", "docx", NOW));
    expect(verifyExportQuery("meeting-1", "trial", docx, NOW)).toBe(false);
  });

  it("不帶 ttl 的既有呼叫行為不變（兩分鐘）", () => {
    const q = parse(signedExportQuery("meeting-1", "pdf", NOW));
    expect(verifyExportQuery("meeting-1", "pdf", q, NOW + EXPORT_TTL_MS - 1000)).toBe(true);
    expect(verifyExportQuery("meeting-1", "pdf", q, NOW + EXPORT_TTL_MS + 1000)).toBe(false);
  });

  it("參數缺漏或不成形一律不過，不丟例外", () => {
    for (const q of ["", "e=abc&s=xx", `e=${NOW + 60_000}`, "s=deadbeef"]) {
      expect(verifyExportQuery("meeting-1", "docx", parse(q), NOW)).toBe(false);
    }
    // 長度不同的簽章不能讓比對炸掉（timingSafeEqual 對長度很敏感）
    expect(verifyExportQuery("meeting-1", "docx", parse(`e=${NOW + 60_000}&s=ab`), NOW)).toBe(false);
  });
});
