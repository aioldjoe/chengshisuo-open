import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { planForPrice, subscriptionFromEvent, verifyStripeSignature } from "./stripe";

const SECRET = "whsec_test";
const NOW = Date.parse("2026-08-27T00:00:00.000Z");

/** 照 Stripe 的規格造一個簽章頭：signed_payload = `${t}.${body}`。 */
function signHeader(body: string, atSeconds: number, secret = SECRET): string {
  const v1 = createHmac("sha256", secret).update(`${atSeconds}.${body}`).digest("hex");
  return `t=${atSeconds},v1=${v1}`;
}

describe("verifyStripeSignature", () => {
  const body = '{"id":"evt_1"}';

  it("簽章正確且在容忍時間內 → true", () => {
    const h = signHeader(body, NOW / 1000);
    expect(verifyStripeSignature(body, h, SECRET, NOW)).toBe(true);
  });

  it("body 被動過 → false", () => {
    const h = signHeader(body, NOW / 1000);
    expect(verifyStripeSignature('{"id":"evt_2"}', h, SECRET, NOW)).toBe(false);
  });

  it("換一把金鑰簽的 → false", () => {
    const h = signHeader(body, NOW / 1000, "whsec_other");
    expect(verifyStripeSignature(body, h, SECRET, NOW)).toBe(false);
  });

  it("超過 5 分鐘容忍 → false（重放攻擊）", () => {
    const h = signHeader(body, NOW / 1000 - 301);
    expect(verifyStripeSignature(body, h, SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(body, signHeader(body, NOW / 1000 - 299), SECRET, NOW)).toBe(true);
  });

  it("時間戳在未來太多也不收", () => {
    expect(verifyStripeSignature(body, signHeader(body, NOW / 1000 + 301), SECRET, NOW)).toBe(false);
  });

  it("多組 v1（Stripe 換金鑰期間會同時送）任一組對就算過", () => {
    const good = signHeader(body, NOW / 1000).split("v1=")[1];
    const h = `t=${NOW / 1000},v1=${"0".repeat(64)},v1=${good}`;
    expect(verifyStripeSignature(body, h, SECRET, NOW)).toBe(true);
  });

  it("頭壞掉、缺項、沒設 secret 一律 false，不丟例外", () => {
    expect(verifyStripeSignature(body, null, SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(body, "", SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(body, "t=abc,v1=xyz", SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature(body, signHeader(body, NOW / 1000), "", NOW)).toBe(false);
  });
});

describe("planForPrice", () => {
  const prices = { lite: "price_lite", standard: "price_std" };

  it("認得出兩檔的 price id", () => {
    expect(planForPrice("price_lite", prices)).toBe("lite");
    expect(planForPrice("price_std", prices)).toBe("standard");
  });

  it("不認得的 price → null（不猜，寧可不給權益）", () => {
    expect(planForPrice("price_zzz", prices)).toBeNull();
    expect(planForPrice(null, prices)).toBeNull();
    expect(planForPrice("", { lite: "", standard: "" })).toBeNull();
  });
});

describe("subscriptionFromEvent", () => {
  const prices = { lite: "price_lite", standard: "price_std" };
  const subEvent = (over: Record<string, unknown> = {}) => ({
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_1",
        customer: "cus_1",
        status: "active",
        metadata: { line_user_id: "U1" },
        current_period_start: 1790400000,
        current_period_end: 1793000000,
        items: { data: [{ price: { id: "price_lite" } }] },
        ...over,
      },
    },
  });

  it("訂閱事件 → 這個 LINE 帳號的訂閱狀態", () => {
    expect(subscriptionFromEvent(subEvent(), prices)).toEqual({
      userId: "U1",
      plan: "lite",
      status: "active",
      currentPeriodStart: new Date(1790400000_000).toISOString(),
      currentPeriodEnd: new Date(1793000000_000).toISOString(),
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
    });
  });

  it("訂閱被刪 → canceled，權益由 planFromSubscription 依期末決定", () => {
    const r = subscriptionFromEvent(
      { ...subEvent(), type: "customer.subscription.deleted" },
      prices,
    );
    expect(r).toMatchObject({ userId: "U1", status: "canceled" });
  });

  it("新版 API 把帳期欄位挪到 item 上，兩處都要讀", () => {
    const r = subscriptionFromEvent(
      subEvent({
        current_period_start: undefined,
        current_period_end: undefined,
        items: {
          data: [
            {
              price: { id: "price_std" },
              current_period_start: 1790400000,
              current_period_end: 1793000000,
            },
          ],
        },
      }),
      prices,
    );
    expect(r).toMatchObject({
      plan: "standard",
      currentPeriodStart: new Date(1790400000_000).toISOString(),
      currentPeriodEnd: new Date(1793000000_000).toISOString(),
    });
  });

  it("舊 API 版本送 plan 不送 price——也要認得，否則錢收得到卻不開通", () => {
    // 2020-08-27 之前的形狀：item 上是 plan
    expect(
      subscriptionFromEvent(
        subEvent({ items: { data: [{ plan: { id: "price_std" } }] } }),
        prices,
      ),
    ).toMatchObject({ plan: "standard" });
    // 更舊：連 items 都沒有，plan 直接掛在訂閱上
    expect(
      subscriptionFromEvent(
        subEvent({ items: undefined, plan: { id: "price_lite" } }),
        prices,
      ),
    ).toMatchObject({ plan: "lite" });
  });

  it("沒有 line_user_id 的訂閱認不出主人 → null（身分即 LINE userId）", () => {
    expect(subscriptionFromEvent(subEvent({ metadata: {} }), prices)).toBeNull();
  });

  it("price 不在方案表裡 → null", () => {
    expect(
      subscriptionFromEvent(subEvent({ items: { data: [{ price: { id: "price_x" } }] } }), prices),
    ).toBeNull();
  });

  it("不相干的事件型別 → null", () => {
    expect(subscriptionFromEvent({ ...subEvent(), type: "invoice.paid" }, prices)).toBeNull();
  });

  it("形狀不對的 payload 不丟例外", () => {
    expect(subscriptionFromEvent(null, prices)).toBeNull();
    expect(subscriptionFromEvent({ type: "customer.subscription.updated" }, prices)).toBeNull();
    expect(
      subscriptionFromEvent({ type: "customer.subscription.updated", data: { object: {} } }, prices),
    ).toBeNull();
  });
});
