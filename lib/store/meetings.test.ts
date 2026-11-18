import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getRepo, resetRepoForTest } from "./meetings";
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
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "meetings-"));
  process.env.MEETINGS_DIR = dir;
  resetRepoForTest();
});

afterEach(async () => {
  delete process.env.MEETINGS_DIR;
  resetRepoForTest();
  await fs.rm(dir, { recursive: true, force: true });
});

describe("FsMeetingsRepo", () => {
  it("save → get 往返", async () => {
    const m = meeting({});
    await getRepo().save(m);
    expect(await getRepo().get(m.id)).toEqual(m);
  });

  it("非 UUID id 回 null（擋 path traversal）", async () => {
    expect(await getRepo().get("../../etc/passwd")).toBeNull();
  });

  it("listSince 只給同人、且在起算點之後的場次", async () => {
    await getRepo().save(meeting({ id: "11111111-2222-4333-8444-555555555551" }));
    await getRepo().save(meeting({ id: "11111111-2222-4333-8444-555555555552" }));
    await getRepo().save(
      meeting({ id: "11111111-2222-4333-8444-555555555553", createdAt: "2026-07-31T00:00:00.000Z" }),
    );
    await getRepo().save(meeting({ id: "11111111-2222-4333-8444-555555555554", userId: "U2" }));
    expect((await getRepo().listSince("U1", new Date("2026-08-01"))).length).toBe(2);
  });

  it("listForUser 只回同人的會議", async () => {
    await getRepo().save(meeting({ id: "11111111-2222-4333-8444-555555555551" }));
    await getRepo().save(meeting({ id: "11111111-2222-4333-8444-555555555552", userId: "U2" }));
    await getRepo().save(meeting({ id: "11111111-2222-4333-8444-555555555553" }));
    const mine = await getRepo().listForUser("U1");
    expect(mine.map((m) => m.id).sort()).toEqual([
      "11111111-2222-4333-8444-555555555551",
      "11111111-2222-4333-8444-555555555553",
    ]);
  });

  it("delete 冪等", async () => {
    const m = meeting({});
    await getRepo().save(m);
    await getRepo().delete(m.id);
    await getRepo().delete(m.id);
    expect(await getRepo().get(m.id)).toBeNull();
  });

  it("setUnlimited 後 isUnlimited 為真；沒標過為假；重複標冪等", async () => {
    expect(await getRepo().isUnlimited("U1")).toBe(false);
    await getRepo().setUnlimited("U1");
    await getRepo().setUnlimited("U1");
    expect(await getRepo().isUnlimited("U1")).toBe(true);
    expect(await getRepo().isUnlimited("U2")).toBe(false);
  });
});
