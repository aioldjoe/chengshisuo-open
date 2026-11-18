import fs from "node:fs/promises";
import path from "node:path";

import type { Client } from "@libsql/client";

import { planFromSubscription, type PlanId } from "../plans";
import type { SubscriptionUpdate } from "../stripe";
import { tursoClient } from "./turso";

/**
 * 訂閱表。後端跟著 meetings 走：有 TURSO_DATABASE_URL 用 Turso，否則寫本機 JSON。
 * 一人一列（主鍵是 LINE userId）——升降級、取消都是覆蓋同一列，不留歷史；
 * 歷史在 Stripe 那邊是完整的，這裡只要回答「現在該給誰什麼權益」。
 *
 * 一樣只用標準 SQLite 方言（將來搬 D1 只換連線層，見 lib/store/turso.ts）。
 */

export type Subscription = SubscriptionUpdate & {
  /** 這列最後一次被 Stripe 事件更新的時間（ISO）。對帳用。 */
  updatedAt: string;
};

export interface SubscriptionsRepo {
  save(sub: SubscriptionUpdate): Promise<void>;
  get(userId: string): Promise<Subscription | null>;
}

function stamp(sub: SubscriptionUpdate): Subscription {
  return { ...sub, updatedAt: new Date().toISOString() };
}

class FsSubscriptionsRepo implements SubscriptionsRepo {
  constructor(private file: string) {}

  private async readAll(): Promise<Record<string, Subscription>> {
    try {
      return JSON.parse(await fs.readFile(this.file, "utf8")) as Record<string, Subscription>;
    } catch {
      return {};
    }
  }

  async save(sub: SubscriptionUpdate): Promise<void> {
    const all = await this.readAll();
    all[sub.userId] = stamp(sub);
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(all, null, 2));
  }

  async get(userId: string): Promise<Subscription | null> {
    return (await this.readAll())[userId] ?? null;
  }

}

const SCHEMA = `CREATE TABLE IF NOT EXISTS subscriptions (
  user_id TEXT PRIMARY KEY,
  plan TEXT NOT NULL,
  status TEXT NOT NULL,
  current_period_start TEXT,
  current_period_end TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  updated_at TEXT NOT NULL
)`;

class TursoSubscriptionsRepo implements SubscriptionsRepo {
  private client: Client;
  private ready: Promise<void> | null = null;

  constructor(url: string, authToken?: string) {
    this.client = tursoClient(url, authToken);
  }

  private ensure(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        await this.client.execute(SCHEMA);
        await this.migrateColumns();
      })();
    }
    return this.ready;
  }

  /**
   * 後補欄位。CREATE TABLE IF NOT EXISTS 不會幫既有的表補欄位——先上線過的環境
   * 那張表就是沒有它，每一筆 INSERT 都會失敗（＝錢收得到、權益不開通，而且沒有人會發現）。
   * SQLite 沒有 ADD COLUMN IF NOT EXISTS，欄位已存在時的錯誤直接吞掉，同 lib/store/turso.ts。
   *
   * activated_at 是 2026-08-27 短命的一版（額度改依帳單週期後就不需要了）；
   * 既有的庫還留著那一欄，不用管它，SQLite 也不好刪。
   */
  private async migrateColumns(): Promise<void> {
    for (const col of ["current_period_start TEXT"]) {
      try {
        await this.client.execute(`ALTER TABLE subscriptions ADD COLUMN ${col}`);
      } catch (e) {
        if (!/duplicate column/i.test(String(e))) throw e;
      }
    }
  }

  async save(sub: SubscriptionUpdate): Promise<void> {
    await this.ensure();
    const s = stamp(sub);
    await this.client.execute({
      sql: `INSERT INTO subscriptions
              (user_id, plan, status, current_period_start, current_period_end, stripe_customer_id, stripe_subscription_id, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
              plan = excluded.plan, status = excluded.status,
              current_period_start = excluded.current_period_start,
              current_period_end = excluded.current_period_end,
              stripe_customer_id = excluded.stripe_customer_id,
              stripe_subscription_id = excluded.stripe_subscription_id,
              updated_at = excluded.updated_at`,
      args: [
        s.userId,
        s.plan,
        s.status,
        s.currentPeriodStart,
        s.currentPeriodEnd,
        s.stripeCustomerId,
        s.stripeSubscriptionId,
        s.updatedAt,
      ],
    });
  }

  async get(userId: string): Promise<Subscription | null> {
    await this.ensure();
    const rs = await this.client.execute({
      sql: "SELECT * FROM subscriptions WHERE user_id = ?",
      args: [userId],
    });
    const r = rs.rows[0];
    if (!r) return null;
    return {
      userId: r.user_id as string,
      plan: r.plan as PlanId,
      status: r.status as string,
      currentPeriodStart: (r.current_period_start as string | null) ?? null,
      currentPeriodEnd: (r.current_period_end as string | null) ?? null,
      stripeCustomerId: (r.stripe_customer_id as string | null) ?? null,
      stripeSubscriptionId: (r.stripe_subscription_id as string | null) ?? null,
      updatedAt: r.updated_at as string,
    };
  }

}

let cached: SubscriptionsRepo | null = null;

export function getSubscriptionsRepo(): SubscriptionsRepo {
  if (!cached) {
    const tursoUrl = process.env.TURSO_DATABASE_URL;
    if (tursoUrl) {
      cached = new TursoSubscriptionsRepo(tursoUrl, process.env.TURSO_AUTH_TOKEN);
    } else {
      const dir = process.env.MEETINGS_DIR || path.join(process.cwd(), ".data", "meetings");
      // 放 meetings 同目錄但不是會議——FsMeetingsRepo.list 只吃 .json 且排除已知的非會議檔，
      // 這個檔名也在它的排除清單裡（見 lib/store/meetings.ts）。
      cached = new FsSubscriptionsRepo(path.join(dir, "subscriptions.json"));
    }
  }
  return cached;
}

export function resetSubscriptionsRepoForTest(): void {
  cached = null;
}

/** 這個人現在該吃哪一檔的權益。cron 保留與加值閘門都問這支。 */
export async function planForUser(userId: string): Promise<PlanId> {
  return planFromSubscription(await getSubscriptionsRepo().get(userId), Date.now());
}
