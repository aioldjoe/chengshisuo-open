import { beforeAll, describe, expect, it } from "vitest";

import { clientIp, ipHash, safeExt } from "./trial-server";

beforeAll(() => {
  process.env.LINE_CHANNEL_SECRET = "test-channel-secret";
});

describe("ipHash", () => {
  it("同 IP 同雜湊、不同 IP 不同雜湊——「一天一場」的鑰匙要穩定", () => {
    expect(ipHash("1.2.3.4")).toBe(ipHash("1.2.3.4"));
    expect(ipHash("1.2.3.4")).not.toBe(ipHash("1.2.3.5"));
  });

  it("不是裸 sha256(ip)——IPv4 空間小，裸雜湊擋不住彩虹表", () => {
    const bare = "6694f83c9f476da31f5df6bcc520034e7e57d421d247b9d34f49edbfc84a764c"; // sha256("1.2.3.4")
    expect(ipHash("1.2.3.4")).not.toBe(bare);
  });
});

describe("clientIp", () => {
  const req = (headers: Record<string, string>) =>
    new Request("http://x/", { headers });

  it("x-forwarded-for 取第一段——Vercel 把真實來源放最前面", () => {
    expect(clientIp(req({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("9.9.9.9");
  });

  it("沒有 x-forwarded-for 退 x-real-ip，再沒有就統一算一個人（本機開發）", () => {
    expect(clientIp(req({ "x-real-ip": "8.8.8.8" }))).toBe("8.8.8.8");
    expect(clientIp(req({}))).toBe("local");
  });
});

describe("safeExt", () => {
  it("只留副檔名，原始檔名不進 R2 key", () => {
    expect(safeExt("會議 2026/08.m4a")).toBe(".m4a");
    expect(safeExt("REC.MP3")).toBe(".mp3");
  });

  it("沒有副檔名或太長的尾巴就不給", () => {
    expect(safeExt("noext")).toBe("");
    expect(safeExt("x.verylongext")).toBe("");
  });
});
