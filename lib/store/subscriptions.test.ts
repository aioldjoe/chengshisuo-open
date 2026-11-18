import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getSubscriptionsRepo,
  planForUser,
  resetSubscriptionsRepoForTest,
} from "./subscriptions";
import { resetTursoClientForTest } from "./turso";
import type { SubscriptionUpdate } from "../stripe";

const update = (over: Partial<SubscriptionUpdate> = {}): SubscriptionUpdate => ({
  userId: "U1",
  plan: "lite",
  status: "active",
  currentPeriodStart: "2026-08-27T00:00:00.000Z",
  currentPeriodEnd: "2026-09-27T00:00:00.000Z",
  stripeCustomerId: "cus_1",
  stripeSubscriptionId: "sub_1",
  ...over,
});

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "subs-"));
  process.env.MEETINGS_DIR = dir;
  resetSubscriptionsRepoForTest();
  resetTursoClientForTest();
});

afterEach(async () => {
  delete process.env.MEETINGS_DIR;
  delete process.env.TURSO_DATABASE_URL;
  resetSubscriptionsRepoForTest();
  resetTursoClientForTest();
  await fs.rm(dir, { recursive: true, force: true });
});

for (const backend of ["fs", "turso"] as const) {
  describe(`SubscriptionsRepo (${backend})`, () => {
    beforeEach(() => {
      if (backend === "turso") process.env.TURSO_DATABASE_URL = ":memory:";
      resetSubscriptionsRepoForTest();
  resetTursoClientForTest();
    });

    it("表已存在但沒有 current_period_start 欄位時會自動補上（先上線過的環境就是這樣）", async () => {
      if (backend !== "turso") return;
      // 一定要拿共用的那條連線：:memory: 是每條連線各自一個 DB，
      // 另開一條就變成在別的資料庫上建表，這個測試會假過。
      const { tursoClient } = await import("./turso");
      const c = tursoClient(process.env.TURSO_DATABASE_URL!);
      // 模擬舊版 schema：沒有 current_period_start
      await c.execute(`CREATE TABLE IF NOT EXISTS subscriptions (
        user_id TEXT PRIMARY KEY, plan TEXT NOT NULL, status TEXT NOT NULL,
        current_period_end TEXT, stripe_customer_id TEXT, stripe_subscription_id TEXT,
        updated_at TEXT NOT NULL)`);
      await getSubscriptionsRepo().save(update());
      expect((await getSubscriptionsRepo().get("U1"))?.currentPeriodStart).toBe(
        "2026-08-27T00:00:00.000Z",
      );
    });

    it("save → get 往返", async () => {
      const repo = getSubscriptionsRepo();
      await repo.save(update());
      const got = await repo.get("U1");
      expect(got).toMatchObject({ userId: "U1", plan: "lite", status: "active" });
      expect(got?.updatedAt).toMatch(/^\d{4}-/);
      expect(got?.currentPeriodStart).toBe("2026-08-27T00:00:00.000Z");
    });

    it("沒訂閱過的人 → null", async () => {
      expect(await getSubscriptionsRepo().get("U-nobody")).toBeNull();
    });

    it("同一人再存就是覆蓋（升降級、取消都走同一列）", async () => {
      const repo = getSubscriptionsRepo();
      await repo.save(update());
      await repo.save(update({ plan: "standard", status: "canceled" }));
      const got = await repo.get("U1");
      expect(got).toMatchObject({ plan: "standard", status: "canceled" });
    });

    it("planForUser 把訂閱翻成權益：沒訂閱是免費、active 是該檔", async () => {
      expect(await planForUser("U1")).toBe("free");
      await getSubscriptionsRepo().save(update({ plan: "standard" }));
      expect(await planForUser("U1")).toBe("standard");
    });

    it("取消且過了期末 → 回免費", async () => {
      await getSubscriptionsRepo().save(
        update({ status: "canceled", currentPeriodEnd: "2020-01-01T00:00:00.000Z" }),
      );
      expect(await planForUser("U1")).toBe("free");
    });
  });
}
