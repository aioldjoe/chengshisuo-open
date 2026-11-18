import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getEventsRepo, recordEvent, resetEventsRepoForTest, userHash } from "./events";
import { getRepo, resetRepoForTest } from "./meetings";
import { purgeAllForUser, purgeMeeting } from "./purge";
import type { Meeting } from "../types";

const meeting = (over: Partial<Meeting>): Meeting => ({
  id: "11111111-2222-4333-8444-555555555555",
  userId: "U1",
  createdAt: "2026-08-12T03:00:00.000Z",
  filename: "a.m4a",
  language: "zho",
  durationLabel: "17:39",
  turns: [],
  summary: { title: "t", highlights: [], decisions: [], todos: [], commitments: [], sections: [] },
  speakerNames: {},
  audioKey: null,
  expiresAt: null,
  shareToken: null,
  ...over,
});

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "events-"));
  process.env.MEETINGS_DIR = dir;
  process.env.EVENTS_FILE = path.join(dir, "events.jsonl");
  resetEventsRepoForTest();
  resetRepoForTest();
});

afterEach(async () => {
  delete process.env.MEETINGS_DIR;
  delete process.env.EVENTS_FILE;
  delete process.env.TURSO_DATABASE_URL;
  resetEventsRepoForTest();
  resetRepoForTest();
  await fs.rm(dir, { recursive: true, force: true });
});

describe("userHash", () => {
  it("同一個 userId 永遠同一個 hash，且不是原始 id", () => {
    const h = userHash("U1234567890abcdef");
    expect(h).toBe(userHash("U1234567890abcdef"));
    expect(h).not.toContain("U1234567890abcdef");
    expect(h).toBe(crypto.createHash("sha256").update("U1234567890abcdef").digest("hex"));
  });

  it("不同人不同 hash", () => {
    expect(userHash("U1")).not.toBe(userHash("U2"));
  });
});

describe.each([
  ["檔案系統", () => {}],
  ["Turso", () => void (process.env.TURSO_DATABASE_URL = ":memory:")],
])("EventsRepo（%s）", (_name, setup) => {
  beforeEach(() => {
    setup();
    resetEventsRepoForTest();
    resetRepoForTest();
  });

  it("record → list 往返", async () => {
    await getEventsRepo().record({
      userHash: "h1",
      type: "meeting_created",
      subject: null,
      at: "2026-08-12T03:00:00.000Z",
    });
    await getEventsRepo().record({
      userHash: null,
      type: "share_opened",
      subject: "m1",
      at: "2026-08-12T04:00:00.000Z",
    });
    expect(await getEventsRepo().list()).toEqual([
      { userHash: "h1", type: "meeting_created", subject: null, at: "2026-08-12T03:00:00.000Z" },
      { userHash: null, type: "share_opened", subject: "m1", at: "2026-08-12T04:00:00.000Z" },
    ]);
  });

  it("分享頁開啟記的是場次 id，不記訪客", async () => {
    await recordEvent("share_opened", null, meeting({}).id);
    const [e] = await getEventsRepo().list();
    expect(e).toMatchObject({ userHash: null, type: "share_opened", subject: meeting({}).id });
  });

  it("recordEvent 存的是 hash，不是 LINE userId", async () => {
    await recordEvent("meeting_created", "U1");
    const [e] = await getEventsRepo().list();
    expect(e.userHash).toBe(userHash("U1"));
    expect(JSON.stringify(e)).not.toContain("U1");
  });

  it("刪掉單場會議，事件還在——留存數字不會被 30 天到期真刪抹掉", async () => {
    await getRepo().save(meeting({}));
    // 開會事件也帶場次 id（跟 pipeline 一樣）：指得回那場，但單場真刪不能把它帶走
    await recordEvent("meeting_created", "U1", meeting({}).id);

    await recordEvent("share_opened", null, meeting({}).id);

    await purgeMeeting(meeting({}));

    expect(await getRepo().get(meeting({}).id)).toBeNull();
    const events = await getEventsRepo().list();
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "meeting_created", subject: meeting({}).id });
    expect(events[0].userHash).toBe(userHash("U1"));
    // 分享開啟數也活過真刪——迴路的分子跟留存一樣不能被 30 天到期抹掉
    expect(events[1]).toMatchObject({ type: "share_opened", subject: meeting({}).id });
  });

  it("「刪除全部資料」連事件一起刪——那句承諾不打折", async () => {
    const others = meeting({ id: "99999999-2222-4333-8444-555555555555", userId: "U2" });
    await getRepo().save(meeting({}));
    await getRepo().save(others);
    await recordEvent("meeting_created", "U1", meeting({}).id);
    await recordEvent("meeting_created", "U2", others.id); // 別人的不能被連坐
    // 分享開啟是無主事件，只有靠場次 id 才能認出「這是他的會議」
    await recordEvent("share_opened", null, meeting({}).id);
    await recordEvent("share_opened", null, others.id);

    expect(await purgeAllForUser("U1")).toBe(1);

    const events = await getEventsRepo().list();
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.type)).toEqual(["meeting_created", "share_opened"]);
    expect(events[0].userHash).toBe(userHash("U2"));
    expect(events[1].subject).toBe(others.id);
  });
});

describe("事件表的舊資料", () => {
  it("subject 是後補欄位，讀舊行不會變成 undefined", async () => {
    await fs.writeFile(
      path.join(dir, "events.jsonl"),
      `${JSON.stringify({ userHash: "h1", type: "meeting_created", at: "2026-08-01T00:00:00.000Z" })}\n`,
    );
    expect(await getEventsRepo().list()).toEqual([
      { userHash: "h1", type: "meeting_created", subject: null, at: "2026-08-01T00:00:00.000Z" },
    ]);
  });
});

describe("recordEvent 的失敗處理", () => {
  it("量測壞掉不能弄壞主流程——寫不進去只吞掉", async () => {
    // 把事件檔指到一條不可能建出來的路徑（拿普通檔案當目錄）
    await fs.writeFile(path.join(dir, "blocked"), "");
    process.env.EVENTS_FILE = path.join(dir, "blocked", "events.jsonl");
    resetEventsRepoForTest();
    await expect(recordEvent("meeting_created", "U1")).resolves.toBeUndefined();
  });
});
