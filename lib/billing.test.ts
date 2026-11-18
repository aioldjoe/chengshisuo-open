import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { entitledPlanForUser, paidPerksResponse } from "./billing";
import { getRepo, resetRepoForTest } from "./store/meetings";
import { getSubscriptionsRepo, resetSubscriptionsRepoForTest } from "./store/subscriptions";
import { resetTursoClientForTest } from "./store/turso";

/**
 * 解鎖碼與付費權益的接縫。這裡要盯的是「兩道閘門講同一句話」——
 * 額度放行了、PDF 卻回 402 的話，被開通的人只會覺得產品壞了。
 */

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "billing-"));
  process.env.MEETINGS_DIR = dir;
  resetRepoForTest();
  resetSubscriptionsRepoForTest();
  resetTursoClientForTest();
});

afterEach(async () => {
  delete process.env.MEETINGS_DIR;
  delete process.env.TURSO_DATABASE_URL;
  resetRepoForTest();
  resetSubscriptionsRepoForTest();
  resetTursoClientForTest();
  await fs.rm(dir, { recursive: true, force: true });
});

describe("entitledPlanForUser", () => {
  it("沒訂閱也沒解鎖 → 免費檔，PDF／分享回 402", async () => {
    expect(await entitledPlanForUser("U1")).toBe("free");
    expect((await paidPerksResponse("U1"))?.status).toBe(402);
  });

  it("解了鎖 → 拿到付費權益，PDF／分享不再被擋", async () => {
    await getRepo().setUnlimited("U1");
    expect(await entitledPlanForUser("U1")).toBe("standard");
    expect(await paidPerksResponse("U1")).toBeNull();
  });

  it("解鎖只影響自己：同一個庫裡的其他人照樣是免費檔", async () => {
    await getRepo().setUnlimited("U1");
    expect(await entitledPlanForUser("U2")).toBe("free");
    expect((await paidPerksResponse("U2"))?.status).toBe(402);
  });

  it("真的有訂閱就照訂閱走（解鎖碼不是唯一的路）", async () => {
    await getSubscriptionsRepo().save({
      userId: "U3",
      plan: "lite",
      status: "active",
      currentPeriodStart: "2026-08-27T00:00:00.000Z",
      currentPeriodEnd: "2026-09-27T00:00:00.000Z",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
    });
    expect(await entitledPlanForUser("U3")).toBe("lite");
    expect(await paidPerksResponse("U3")).toBeNull();
  });
});
