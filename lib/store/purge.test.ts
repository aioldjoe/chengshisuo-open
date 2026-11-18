import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "purge-"));
  process.env.MEETINGS_DIR = dir;
  resetRepoForTest();
});

afterEach(async () => {
  delete process.env.MEETINGS_DIR;
  resetRepoForTest();
  await fs.rm(dir, { recursive: true, force: true });
});

describe("purge", () => {
  it("purgeMeeting 刪掉單場（未設 R2 時跳過音檔步驟）", async () => {
    const m = meeting({});
    await getRepo().save(m);
    await purgeMeeting(m);
    expect(await getRepo().get(m.id)).toBeNull();
  });

  it("purgeAllForUser 只刪同人、回傳場數", async () => {
    await getRepo().save(meeting({ id: "11111111-2222-4333-8444-555555555551" }));
    await getRepo().save(meeting({ id: "11111111-2222-4333-8444-555555555552" }));
    const other = meeting({ id: "11111111-2222-4333-8444-555555555553", userId: "U2" });
    await getRepo().save(other);

    expect(await purgeAllForUser("U1")).toBe(2);
    expect(await getRepo().listForUser("U1")).toEqual([]);
    expect(await getRepo().get(other.id)).toEqual(other);
  });

  it("沒有資料時 purgeAllForUser 回 0", async () => {
    expect(await purgeAllForUser("U-nobody")).toBe(0);
  });
});
