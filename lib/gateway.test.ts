import { describe, expect, it } from "vitest";

import { gatewayBaseUrl, gatewayHeaders } from "./gateway";

describe("gatewayBaseUrl", () => {
  it("未設 CF_AI_GATEWAY_ID 時回 null（呼叫端退回直連）", () => {
    expect(gatewayBaseUrl("anthropic", { R2_ACCOUNT_ID: "acc" })).toBeNull();
  });

  it("有 gateway 名但找不到帳號 ID 時回 null", () => {
    expect(gatewayBaseUrl("anthropic", { CF_AI_GATEWAY_ID: "gw" })).toBeNull();
  });

  it("以 R2_ACCOUNT_ID ＋ CF_AI_GATEWAY_ID 組出 provider base URL", () => {
    expect(
      gatewayBaseUrl("anthropic", { R2_ACCOUNT_ID: "acc123", CF_AI_GATEWAY_ID: "gw-name" }),
    ).toBe("https://gateway.ai.cloudflare.com/v1/acc123/gw-name/anthropic");
  });

  it("CF_ACCOUNT_ID 優先於 R2_ACCOUNT_ID", () => {
    expect(
      gatewayBaseUrl("elevenlabs", {
        CF_ACCOUNT_ID: "cf-acc",
        R2_ACCOUNT_ID: "r2-acc",
        CF_AI_GATEWAY_ID: "gw",
      }),
    ).toBe("https://gateway.ai.cloudflare.com/v1/cf-acc/gw/elevenlabs");
  });
});

describe("gatewayHeaders", () => {
  it("未設 token 時回空物件", () => {
    expect(gatewayHeaders({})).toEqual({});
  });

  it("gateway 啟用＋設了 CF_AI_GATEWAY_TOKEN 時帶 cf-aig-authorization", () => {
    expect(
      gatewayHeaders({
        R2_ACCOUNT_ID: "acc",
        CF_AI_GATEWAY_ID: "gw",
        CF_AI_GATEWAY_TOKEN: "tok",
      }),
    ).toEqual({ "cf-aig-authorization": "Bearer tok" });
  });

  it("有 token 但 gateway 未啟用時回空——直連官方 API 不得外洩 gateway token", () => {
    expect(gatewayHeaders({ CF_AI_GATEWAY_TOKEN: "tok" })).toEqual({});
  });
});
