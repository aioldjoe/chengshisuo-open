import { createClient, type Client } from "@libsql/client";

import type { Meeting } from "../types";
import type { MeetingsRepo } from "./meetings";

/**
 * 同一個行程只開一條 libSQL 連線。訂閱表也接在這條上（lib/store/subscriptions.ts）——
 * 同一個資料庫開兩個 client 只是多一份連線與多一次冷啟。
 */
let shared: Client | null = null;

export function tursoClient(url: string, authToken?: string): Client {
  if (!shared) shared = createClient(authToken ? { url, authToken } : { url });
  return shared;
}

/** 測試用：換 DB（如 :memory:）前把連線丟掉，否則會沿用上一支測試的資料。 */
export function resetTursoClientForTest(): void {
  shared = null;
}

/**
 * Turso（libSQL）實作。刻意只用標準 SQLite 方言——這是「將來搬 D1 只換連線層」
 * 的逃生門（docs/db-selection.html 的選型前提），別在 SQL 裡用 libSQL 擴充。
 * 單表：查詢用的欄位（user_id/created_at/expires_at）抽出來建索引，
 * 完整 Meeting 塞 data JSON——形狀變了不用 migration，跟檔案系統版同一哲學。
 * 測試用 TURSO_DATABASE_URL=":memory:"，零外部依賴。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT,
    data TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_meetings_user ON meetings(user_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS unlimited_users (
    user_id TEXT PRIMARY KEY,
    since TEXT NOT NULL
  )`,
];

export class TursoMeetingsRepo implements MeetingsRepo {
  private client: Client;
  private ready: Promise<void> | null = null;

  constructor(url: string, authToken?: string) {
    this.client = tursoClient(url, authToken);
  }

  /** 首次使用時建表（冪等）。serverless 冷啟不保證誰先跑，所有方法都得等它。 */
  private ensure(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        for (const sql of SCHEMA) await this.client.execute(sql);
        await this.migrateShareToken();
      })();
    }
    return this.ready;
  }

  /**
   * 分享連結是後補欄位，正式庫早就有 meetings 表——SQLite 沒有
   * ADD COLUMN IF NOT EXISTS，欄位已存在時的錯誤直接吞掉。
   */
  private async migrateShareToken(): Promise<void> {
    try {
      await this.client.execute("ALTER TABLE meetings ADD COLUMN share_token TEXT");
    } catch (e) {
      if (!/duplicate column/i.test(String(e))) throw e;
    }
    await this.client.execute(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_meetings_share_token ON meetings(share_token) WHERE share_token IS NOT NULL",
    );
  }

  async save(m: Meeting): Promise<void> {
    await this.ensure();
    await this.client.execute({
      sql: `INSERT INTO meetings (id, user_id, created_at, expires_at, data, share_token)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              user_id = excluded.user_id, created_at = excluded.created_at,
              expires_at = excluded.expires_at, data = excluded.data, share_token = excluded.share_token`,
      // ?? null 不是多餘的：分享連結是後補欄位，早於它的列讀出來根本沒有這個 key，
      // 而 libSQL 綁到 undefined 會直接丟 TypeError（不是存成 NULL）。
      args: [m.id, m.userId, m.createdAt, m.expiresAt ?? null, JSON.stringify(m), m.shareToken ?? null],
    });
  }

  async get(id: string): Promise<Meeting | null> {
    if (!UUID_RE.test(id)) return null;
    await this.ensure();
    const rs = await this.client.execute({
      sql: "SELECT data FROM meetings WHERE id = ?",
      args: [id],
    });
    const row = rs.rows[0];
    return row ? (JSON.parse(row.data as string) as Meeting) : null;
  }

  async getByShareToken(token: string): Promise<Meeting | null> {
    if (!token) return null;
    await this.ensure();
    const rs = await this.client.execute({
      sql: "SELECT data FROM meetings WHERE share_token = ?",
      args: [token],
    });
    const row = rs.rows[0];
    return row ? (JSON.parse(row.data as string) as Meeting) : null;
  }

  async listSince(userId: string, since: Date): Promise<Meeting[]> {
    await this.ensure();
    // 撈整份 data 而不是在 SQL 裡加總：時長藏在 JSON 裡，而一人一月的量是個位數場。
    // created_at 存的是 ISO 字串，字典序＝時間序，所以字串比較就是時間比較。
    const rs = await this.client.execute({
      sql: "SELECT data FROM meetings WHERE user_id = ? AND created_at >= ?",
      args: [userId, since.toISOString()],
    });
    return rs.rows.map((r) => JSON.parse(r.data as string) as Meeting);
  }

  async listForUser(userId: string): Promise<Meeting[]> {
    await this.ensure();
    const rs = await this.client.execute({
      sql: "SELECT data FROM meetings WHERE user_id = ? ORDER BY created_at",
      args: [userId],
    });
    return rs.rows.map((r) => JSON.parse(r.data as string) as Meeting);
  }

  async list(): Promise<Meeting[]> {
    await this.ensure();
    const rs = await this.client.execute("SELECT data FROM meetings ORDER BY created_at");
    return rs.rows.map((r) => JSON.parse(r.data as string) as Meeting);
  }

  async delete(id: string): Promise<void> {
    if (!UUID_RE.test(id)) return;
    await this.ensure();
    await this.client.execute({ sql: "DELETE FROM meetings WHERE id = ?", args: [id] });
  }

  async setUnlimited(userId: string): Promise<void> {
    await this.ensure();
    await this.client.execute({
      sql: "INSERT INTO unlimited_users (user_id, since) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING",
      args: [userId, new Date().toISOString()],
    });
  }

  async isUnlimited(userId: string): Promise<boolean> {
    await this.ensure();
    const rs = await this.client.execute({
      sql: "SELECT 1 FROM unlimited_users WHERE user_id = ?",
      args: [userId],
    });
    return rs.rows.length > 0;
  }
}
