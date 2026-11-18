import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { createClient, type Client } from "@libsql/client";

import type { UsageEvent, UsageEventType } from "../types";

/**
 * 量測事件表。存在的理由只有一個：會議是真刪的（GLOSSARY.md「記錄頁保留」），
 * 刪完就沒人記得這個人上個月丟過幾場——留存與人均場次會被自己的隱私承諾抹掉。
 * 所以事件與內容分家：這裡只有「誰、何時、做了什麼」，沒有任何會議內容，
 * 而且「誰」是 sha256(userId) 不是 LINE userId——刪除全部資料之後，
 * 剩下的列回查不到本人，但同一人跨月還對得起來（留存分子的最低需求）。
 *
 * 後端跟著 meetings 走：有 TURSO_DATABASE_URL 用 Turso，否則寫本機 JSONL。
 */

export interface EventsRepo {
  record(e: UsageEvent): Promise<void>;
  /** 依時間排序的全部事件；量級是每人每月個位數場，全撈得起。 */
  list(): Promise<UsageEvent[]>;
  /** 抹掉某人的全部事件（只給「刪除全部資料」用，見 deleteEventsForUser）。 */
  deleteForUser(hash: string): Promise<void>;
  /** 抹掉指向這些場次的事件；分享開啟是無主事件，只有靠場次 id 認得出主人。 */
  deleteForSubjects(subjects: string[]): Promise<void>;
}

/** LINE userId → 事件表用的假名。userId 本身是高熵字串，直接 sha256 不必加鹽。 */
export function userHash(userId: string): string {
  return crypto.createHash("sha256").update(userId).digest("hex");
}

class FsEventsRepo implements EventsRepo {
  constructor(private file: string) {}

  async record(e: UsageEvent): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.appendFile(this.file, `${JSON.stringify(e)}\n`);
  }

  async list(): Promise<UsageEvent[]> {
    return (await this.readAll()).sort((a, b) => a.at.localeCompare(b.at));
  }

  async deleteForUser(hash: string): Promise<void> {
    await this.rewrite((e) => e.userHash !== hash);
  }

  async deleteForSubjects(subjects: string[]): Promise<void> {
    if (subjects.length === 0) return;
    const drop = new Set(subjects);
    await this.rewrite((e) => !(e.subject && drop.has(e.subject)));
  }

  private async rewrite(keep: (e: UsageEvent) => boolean): Promise<void> {
    const rows = (await this.readAll()).filter(keep);
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, rows.map((e) => `${JSON.stringify(e)}\n`).join(""));
  }

  private async readAll(): Promise<UsageEvent[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.file, "utf8");
    } catch {
      return [];
    }
    const out: UsageEvent[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        // subject 是後補欄位，舊行沒有——補成 null，讀出來的形狀才一致
        const row = JSON.parse(line) as UsageEvent;
        out.push({ ...row, subject: row.subject ?? null });
      } catch {
        // 壞行跳過，不擋整體
      }
    }
    return out;
  }
}

/** 同 turso.ts：只用標準 SQLite 方言，將來搬 D1 只換連線層。 */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_hash TEXT,
    type TEXT NOT NULL,
    subject TEXT,
    at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_events_at ON events(at)`,
];

class TursoEventsRepo implements EventsRepo {
  private client: Client;
  private ready: Promise<void> | null = null;

  constructor(url: string, authToken?: string) {
    this.client = createClient(authToken ? { url, authToken } : { url });
  }

  private ensure(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        for (const sql of SCHEMA) await this.client.execute(sql);
        await this.migrateSubject();
      })();
    }
    return this.ready;
  }

  /**
   * subject 是後補欄位（issue #7），正式庫早就有 events 表——
   * SQLite 沒有 ADD COLUMN IF NOT EXISTS，欄位已存在時的錯誤直接吞掉。
   */
  private async migrateSubject(): Promise<void> {
    try {
      await this.client.execute("ALTER TABLE events ADD COLUMN subject TEXT");
    } catch (e) {
      if (!/duplicate column/i.test(String(e))) throw e;
    }
  }

  async record(e: UsageEvent): Promise<void> {
    await this.ensure();
    await this.client.execute({
      sql: "INSERT INTO events (user_hash, type, subject, at) VALUES (?, ?, ?, ?)",
      args: [e.userHash, e.type, e.subject, e.at],
    });
  }

  async deleteForUser(hash: string): Promise<void> {
    await this.ensure();
    await this.client.execute({ sql: "DELETE FROM events WHERE user_hash = ?", args: [hash] });
  }

  async deleteForSubjects(subjects: string[]): Promise<void> {
    if (subjects.length === 0) return;
    await this.ensure();
    // 分批：SQLite 的繫結參數有上限（依編譯而定，幾百起跳），
    // 而這條路是「刪除全部資料」——不能因為某人場次多就整批失敗
    for (let i = 0; i < subjects.length; i += 200) {
      const batch = subjects.slice(i, i + 200);
      await this.client.execute({
        sql: `DELETE FROM events WHERE subject IN (${batch.map(() => "?").join(", ")})`,
        args: batch,
      });
    }
  }

  async list(): Promise<UsageEvent[]> {
    await this.ensure();
    const rs = await this.client.execute("SELECT user_hash, type, subject, at FROM events ORDER BY at, id");
    return rs.rows.map((r) => ({
      userHash: (r.user_hash as string | null) ?? null,
      type: r.type as string,
      subject: (r.subject as string | null) ?? null,
      at: r.at as string,
    }));
  }
}

let cached: EventsRepo | null = null;

export function getEventsRepo(): EventsRepo {
  if (!cached) {
    const tursoUrl = process.env.TURSO_DATABASE_URL;
    cached = tursoUrl
      ? new TursoEventsRepo(tursoUrl, process.env.TURSO_AUTH_TOKEN)
      : new FsEventsRepo(process.env.EVENTS_FILE || path.join(process.cwd(), ".data", "events.jsonl"));
  }
  return cached;
}

/** 測試用：清掉 singleton，讓下一次 getEventsRepo 重讀 env。 */
export function resetEventsRepoForTest(): void {
  cached = null;
}

/**
 * 記一筆事件。呼叫端不必 try——量測失敗只留 log，
 * 絕不能把使用者的會議處理弄壞（這是「順手記一筆」，不是業務邏輯）。
 * subject 是這件事的對象（開會與分享頁開啟＝那場會議的 id，加好友＝來源標記），沒有就 null。
 */
export async function recordEvent(
  type: UsageEventType,
  userId: string | null,
  subject: string | null = null,
): Promise<void> {
  try {
    await getEventsRepo().record({
      userHash: userId ? userHash(userId) : null,
      type,
      subject,
      at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[events] 記錄失敗", { type }, e);
  }
}

/**
 * 抹掉某人的全部事件。只有 LINE「刪除全部資料」那條路走這裡——
 * 那句承諾不打折，連假名列都不留；30 天到期或單場刪除不呼叫它（事件正是為了那些場景才存在）。
 * 這裡不吞錯誤：刪不掉要讓上層知道，重試是安全的（同一人再刪一次結果相同）。
 */
export async function deleteEventsForUser(userId: string): Promise<void> {
  await getEventsRepo().deleteForUser(userHash(userId));
}

/**
 * 抹掉指向這些場次的事件。分享頁開啟不記訪客身分（issue #7），
 * userHash 是 null，deleteEventsForUser 掃不到它——「刪除全部資料」要把
 * 這些無主列一起帶走，得靠場次 id 認人。同樣不吞錯誤。
 */
export async function deleteEventsForMeetings(meetingIds: string[]): Promise<void> {
  await getEventsRepo().deleteForSubjects(meetingIds);
}
