import { describe, expect, it } from "vitest";

import { checkoutOrPortal, parsePlanParam, subscribePath, upgradeHref } from "./subscribe";

const NOW = Date.parse("2026-08-29T00:00:00.000Z");

/** checkoutOrPortal 只看這幾個欄位；其餘訂閱欄位與判定無關。 */
function sub(p: {
  status: string;
  customerId?: string | null;
  periodEnd?: string | null;
}) {
  return {
    plan: "lite" as const,
    status: p.status,
    currentPeriodEnd: p.periodEnd ?? null,
    stripeCustomerId: p.customerId ?? null,
  };
}

describe("parsePlanParam", () => {
  it("認得兩個付費檔", () => {
    expect(parsePlanParam("lite")).toBe("lite");
    expect(parsePlanParam("standard")).toBe("standard");
  });

  it("free 不是可訂閱的檔；其餘一律 null", () => {
    expect(parsePlanParam("free")).toBeNull();
    expect(parsePlanParam("pro")).toBeNull();
    expect(parsePlanParam(undefined)).toBeNull();
    expect(parsePlanParam(["lite"])).toBeNull();
  });
});

describe("subscribePath", () => {
  it("plan 進 query，跟 parsePlanParam 對得起來", () => {
    expect(parsePlanParam(new URL(subscribePath("lite"), "https://x").searchParams.get("plan"))).toBe("lite");
    expect(parsePlanParam(new URL(subscribePath("standard"), "https://x").searchParams.get("plan"))).toBe("standard");
  });
});

describe("checkoutOrPortal", () => {
  it("沒訂閱過 → 開新 Checkout，沒有舊 customer 可帶", () => {
    expect(checkoutOrPortal(null, NOW)).toEqual({ kind: "checkout", customerId: null });
  });

  it("訂閱有效 → 導去 Portal，不重複開一筆", () => {
    expect(checkoutOrPortal(sub({ status: "active", customerId: "cus_1" }), NOW)).toEqual({
      kind: "portal",
      customerId: "cus_1",
    });
  });

  it("已取消但本期未滿（權益還在）→ 也是 Portal——要恢復訂閱去那裡，不是再刷一筆", () => {
    expect(
      checkoutOrPortal(
        sub({ status: "canceled", customerId: "cus_1", periodEnd: "2026-09-10T00:00:00.000Z" }),
        NOW,
      ),
    ).toEqual({ kind: "portal", customerId: "cus_1" });
  });

  it("取消且過期（權益已失效）→ 開新 Checkout，帶舊 customerId 免得同一人生兩個 customer", () => {
    expect(
      checkoutOrPortal(
        sub({ status: "canceled", customerId: "cus_1", periodEnd: "2026-08-01T00:00:00.000Z" }),
        NOW,
      ),
    ).toEqual({ kind: "checkout", customerId: "cus_1" });
  });

  it("有效但沒有 customerId（不該發生）→ Portal 開不了，退回 Checkout", () => {
    expect(checkoutOrPortal(sub({ status: "active" }), NOW)).toEqual({
      kind: "checkout",
      customerId: null,
    });
  });

  it("incomplete（沒付成）→ Checkout", () => {
    expect(checkoutOrPortal(sub({ status: "incomplete", customerId: "cus_1" }), NOW)).toEqual({
      kind: "checkout",
      customerId: "cus_1",
    });
  });
});

describe("upgradeHref", () => {
  it("web 訂閱就緒 → /subscribe", () => {
    expect(upgradeHref("lite", { webReady: true, prefillUrl: "https://line.me/x" })).toBe(
      subscribePath("lite"),
    );
  });

  it("沒就緒 → 退回 #16 的預填訊息深連結", () => {
    expect(upgradeHref("lite", { webReady: false, prefillUrl: "https://line.me/x" })).toBe(
      "https://line.me/x",
    );
  });

  it("連預填連結都組不出來（沒設 OA ID）→ null，呼叫端自己決定退路", () => {
    expect(upgradeHref("lite", { webReady: false, prefillUrl: null })).toBeNull();
  });
});
