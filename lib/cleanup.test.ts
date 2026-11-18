import { describe, expect, it } from "vitest";

import { AUDIO_TTL_MS, cleanupAction } from "./cleanup";
import type { Meeting } from "./types";

const NOW = Date.parse("2026-08-27T00:00:00.000Z");
const m = (over: Partial<Meeting>): Meeting =>
  ({
    id: "x",
    userId: "U1",
    createdAt: new Date(NOW - 3600_000).toISOString(),
    audioKey: "audio/x/a.m4a",
    expiresAt: null,
    ...over,
  }) as Meeting;

describe("cleanupAction", () => {
  it("音檔超過 72 小時 → 銷毀音檔（所有方案一律如此，付費也不例外）", () => {
    const old = { createdAt: new Date(NOW - AUDIO_TTL_MS - 1).toISOString() };
    expect(cleanupAction(m(old), "free", NOW)).toBe("delete-audio");
    expect(cleanupAction(m(old), "standard", NOW)).toBe("delete-audio");
  });

  it("音檔還在 72 小時內、記錄頁沒到期 → 什麼都不做", () => {
    expect(cleanupAction(m({ expiresAt: new Date(NOW + 86400_000).toISOString() }), "free", NOW)).toBe("keep");
  });

  it("永久頁的主人退回免費檔 → 重新上到期日，不然不付錢也永久保留", () => {
    expect(cleanupAction(m({ expiresAt: null }), "free", NOW)).toBe("make-expiring");
  });

  it("永久頁的主人還在付費 → 不動它", () => {
    expect(cleanupAction(m({ expiresAt: null }), "lite", NOW)).toBe("keep");
  });

  it("音檔已經銷毀過就不用再銷毀一次", () => {
    expect(
      cleanupAction(
        m({
          audioKey: null,
          createdAt: new Date(NOW - AUDIO_TTL_MS - 1).toISOString(),
          expiresAt: new Date(NOW + 86400_000).toISOString(),
        }),
        "free",
        NOW,
      ),
    ).toBe("keep");
  });

  it("音檔到期與補到期日同時成立時先銷毀音檔——72 小時真刪不能被延", () => {
    expect(
      cleanupAction(
        m({ expiresAt: null, createdAt: new Date(NOW - AUDIO_TTL_MS - 1).toISOString() }),
        "free",
        NOW,
      ),
    ).toBe("delete-audio");
  });

  it("記錄頁過期且是免費用戶 → 整筆刪", () => {
    const expired = { expiresAt: new Date(NOW - 1).toISOString() };
    expect(cleanupAction(m(expired), "free", NOW)).toBe("delete-page");
  });

  it("記錄頁過期但人已經付費了 → 不刪，改成永久保留", () => {
    // 到期日是落庫當下寫死的；免費時期存的那些場次，升級後也該跟著永久
    const expired = { expiresAt: new Date(NOW - 1).toISOString() };
    expect(cleanupAction(m(expired), "lite", NOW)).toBe("make-permanent");
    expect(cleanupAction(m(expired), "standard", NOW)).toBe("make-permanent");
  });

  it("還沒到期的免費記錄頁不會被提前刪", () => {
    expect(cleanupAction(m({ expiresAt: new Date(NOW + 1).toISOString() }), "free", NOW)).toBe("keep");
  });

  it("刪整筆優先於銷毀音檔——整筆刪的時候音檔也一起走", () => {
    expect(
      cleanupAction(
        m({
          expiresAt: new Date(NOW - 1).toISOString(),
          createdAt: new Date(NOW - AUDIO_TTL_MS - 1).toISOString(),
        }),
        "free",
        NOW,
      ),
    ).toBe("delete-page");
  });
});
