import fs from "node:fs/promises";
import path from "node:path";

import { TursoMeetingsRepo } from "./turso";
import type { Meeting } from "../types";

/**
 * 會議儲存層。正式實作 Turso（lib/store/turso.ts，2026-08-13 定案）；
 * 未設 TURSO_DATABASE_URL 時退回檔案系統（本機開發、不裝任何東西就能跑）。
 */

export interface MeetingsRepo {
  save(meeting: Meeting): Promise<void>;
  /** 找不到（或 id 非法）回 null。 */
  get(id: string): Promise<Meeting | null>;
  /** 唯讀分享連結用；token 找不到或未開分享回 null。 */
  getByShareToken(token: string): Promise<Meeting | null>;
  /**
   * 該 userId 在 since 之後建立的全部會議（額度檢查用）。
   * 回整份而不是回數字，是因為兩檔的計量單位不同——免費按場、付費按小時，
   * 換算交給純函式 usageOf（lib/plans.ts），儲存層不必知道方案表。
   * 起算點也不在這裡決定（月初還是開通時刻是方案的事，見 quotaWindowStart）。
   */
  listSince(userId: string, since: Date): Promise<Meeting[]>;
  /** 該 userId 的全部會議（刪除全部、場次清單用）。 */
  listForUser(userId: string): Promise<Meeting[]>;
  list(): Promise<Meeting[]>;
  delete(id: string): Promise<void>;
  /** 標記該 userId 不受免費額度限制（傳解鎖碼後）。冪等、目前沒有撤銷。 */
  setUnlimited(userId: string): Promise<void>;
  isUnlimited(userId: string): Promise<boolean>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 會議目錄裡不是會議的 JSON（本機開發後端才會有）。 */
const NON_MEETING_FILES = new Set(["unlimited.json", "subscriptions.json"]);

class FsMeetingsRepo implements MeetingsRepo {
  constructor(private dir: string) {}

  private file(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  async save(meeting: Meeting): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.file(meeting.id), JSON.stringify(meeting, null, 2));
  }

  async get(id: string): Promise<Meeting | null> {
    // id 直接來自 URL——非 UUID 一律當不存在，順帶擋 path traversal。
    if (!UUID_RE.test(id)) return null;
    try {
      return JSON.parse(await fs.readFile(this.file(id), "utf8")) as Meeting;
    } catch {
      return null;
    }
  }

  async getByShareToken(token: string): Promise<Meeting | null> {
    if (!token) return null;
    const all = await this.list();
    return all.find((m) => m.shareToken === token) ?? null;
  }

  async listSince(userId: string, since: Date): Promise<Meeting[]> {
    const from = since.toISOString();
    const all = await this.list();
    return all.filter((m) => m.userId === userId && m.createdAt >= from);
  }

  async listForUser(userId: string): Promise<Meeting[]> {
    return (await this.list()).filter((m) => m.userId === userId);
  }

  async list(): Promise<Meeting[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.dir);
    } catch {
      return [];
    }
    const out: Meeting[] = [];
    for (const n of names) {
      // unlimited.json／subscriptions.json 同目錄但不是會議——parse 得過，
      // 會混進 list 變成沒有 id 的鬼會議
      if (!n.endsWith(".json") || NON_MEETING_FILES.has(n)) continue;
      try {
        out.push(JSON.parse(await fs.readFile(path.join(this.dir, n), "utf8")) as Meeting);
      } catch {
        // 壞檔跳過，不擋整體
      }
    }
    return out;
  }

  async delete(id: string): Promise<void> {
    if (!UUID_RE.test(id)) return;
    await fs.rm(this.file(id), { force: true });
  }

  // 不限額名單放同目錄下一個 JSON 陣列檔（本機開發用，量不會大）
  private unlimitedFile(): string {
    return path.join(this.dir, "unlimited.json");
  }

  private async readUnlimited(): Promise<string[]> {
    try {
      return JSON.parse(await fs.readFile(this.unlimitedFile(), "utf8")) as string[];
    } catch {
      return [];
    }
  }

  async setUnlimited(userId: string): Promise<void> {
    const ids = await this.readUnlimited();
    if (ids.includes(userId)) return;
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.unlimitedFile(), JSON.stringify([...ids, userId], null, 2));
  }

  async isUnlimited(userId: string): Promise<boolean> {
    return (await this.readUnlimited()).includes(userId);
  }
}

let cached: MeetingsRepo | null = null;

export function getRepo(): MeetingsRepo {
  if (!cached) {
    const tursoUrl = process.env.TURSO_DATABASE_URL;
    if (tursoUrl) {
      cached = new TursoMeetingsRepo(tursoUrl, process.env.TURSO_AUTH_TOKEN);
    } else {
      const dir = process.env.MEETINGS_DIR || path.join(process.cwd(), ".data", "meetings");
      cached = new FsMeetingsRepo(dir);
    }
  }
  return cached;
}

/** 測試用：清掉 singleton，讓下一次 getRepo 重讀 env。 */
export function resetRepoForTest(): void {
  cached = null;
}
