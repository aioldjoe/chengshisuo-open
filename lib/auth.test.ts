import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { verifyRequestUser } from "./auth";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  delete process.env.DEV_LINE_USER_ID;
  delete process.env.LINE_LOGIN_CHANNEL_ID;
  vi.unstubAllGlobals();
});

const req = (headers: Record<string, string> = {}) =>
  new Request("http://x/api/m/1", { headers });

describe("verifyRequestUser", () => {
  it("帶 Bearer id token → 走 LINE 驗證回 sub", async () => {
    process.env.LINE_LOGIN_CHANNEL_ID = "123";
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ sub: "U-real" })));
    expect(await verifyRequestUser(req({ authorization: "Bearer tok" }))).toBe("U-real");
  });

  it("沒 token 時 DEV_LINE_USER_ID 直通（非 production 限定）", async () => {
    process.env.DEV_LINE_USER_ID = "U-dev";
    expect(await verifyRequestUser(req())).toBe("U-dev");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("production 下 DEV_LINE_USER_ID 無效 → null", async () => {
    process.env.DEV_LINE_USER_ID = "U-dev";
    vi.stubEnv("NODE_ENV", "production");
    expect(await verifyRequestUser(req())).toBeNull();
    vi.unstubAllEnvs();
  });

  it("什麼都沒有 → null", async () => {
    expect(await verifyRequestUser(req())).toBeNull();
  });
});
