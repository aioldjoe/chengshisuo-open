import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { verifyLineIdToken } from "./line-login";

const mockFetch = vi.fn();

beforeEach(() => {
  process.env.LINE_LOGIN_CHANNEL_ID = "1234567890";
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  delete process.env.LINE_LOGIN_CHANNEL_ID;
  vi.unstubAllGlobals();
});

describe("verifyLineIdToken", () => {
  it("驗證成功 → 回 sub（LINE userId）", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ iss: "https://access.line.me", sub: "U-real", aud: "1234567890" })),
    );
    expect(await verifyLineIdToken("good-token")).toBe("U-real");

    // 打的是 LINE 的 verify 端點、form-encoded、帶 client_id——不可信前端 profile（共識雷點 #1）
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.line.me/oauth2/v2.1/verify");
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("id_token=good-token");
    expect(String(init.body)).toContain("client_id=1234567890");
  });

  it("LINE 回錯誤（過期/偽造）→ null", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_request" }), { status: 400 }),
    );
    expect(await verifyLineIdToken("expired-token")).toBeNull();
  });

  it("LINE_LOGIN_CHANNEL_ID 未設定 → null（憑證未到位前一律視為未認證）", async () => {
    delete process.env.LINE_LOGIN_CHANNEL_ID;
    expect(await verifyLineIdToken("any")).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("網路錯誤 → null 不炸", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNRESET"));
    expect(await verifyLineIdToken("any")).toBeNull();
  });
});
