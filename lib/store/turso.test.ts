import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getRepo, resetRepoForTest } from "./meetings";
import { resetTursoClientForTest } from "./turso";
import { TursoMeetingsRepo } from "./turso";
import type { Meeting } from "../types";

const meeting = (over: Partial<Meeting>): Meeting => ({
  id: "11111111-2222-4333-8444-555555555555",
  userId: "U1",
  createdAt: "2026-08-12T03:00:00.000Z",
  filename: "a.m4a",
  language: "zho",
  durationLabel: "17:39",
  turns: [{ speaker: "講者 A", start: 0, text: "hi" }],
  summary: { title: "t", highlights: [], decisions: [], todos: [], commitments: [], sections: [] },
  speakerNames: {},
  audioKey: null,
  expiresAt: null,
  shareToken: null,
  ...over,
});

beforeEach(() => {
  process.env.TURSO_DATABASE_URL = ":memory:";
  resetRepoForTest();
  resetTursoClientForTest();
});

afterEach(() => {
  delete process.env.TURSO_DATABASE_URL;
  resetRepoForTest();
  resetTursoClientForTest();
});

describe("TursoMeetingsRepo", () => {
  it("設了 TURSO_DATABASE_URL 時 getRepo 選 Turso 實作", () => {
    expect(getRepo()).toBeInstanceOf(TursoMeetingsRepo);
  });

  it("舊資料缺 shareToken 欄位也存得回去（libSQL 綁 undefined 會丟例外）", async () => {
    const old = meeting({}) as Partial<Meeting>;
    delete old.shareToken;
    await expect(getRepo().save(old as Meeting)).resolves.toBeUndefined();
  });

  it("save → get 往返（JSON 完整還原）", async () => {
    const m = meeting({});
    await getRepo().save(m);
    expect(await getRepo().get(m.id)).toEqual(m);
  });

  it("save 同 id 覆寫（編輯的落盤路徑）", async () => {
    await getRepo().save(meeting({}));
    await getRepo().save(meeting({ speakerNames: { "講者 A": "王協理" } }));
    expect((await getRepo().get(meeting({}).id))?.speakerNames).toEqual({ "講者 A": "王協理" });
  });

  it("非 UUID id 回 null", async () => {
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
    const mine = await getRepo().listForUser("U1");
    expect(mine.map((m) => m.id)).toEqual(["11111111-2222-4333-8444-555555555551"]);
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
