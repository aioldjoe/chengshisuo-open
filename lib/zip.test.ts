import { describe, expect, it } from "vitest";

import { zipStore } from "./zip";
import { readZip } from "./zip.testutil";

const enc = new TextEncoder();
const dec = new TextDecoder();

const AT = new Date("2026-08-22T10:30:00Z");

describe("zipStore", () => {
  it("每個項目都讀得回原本的名字與內容", () => {
    const zip = zipStore(
      [
        { name: "hello.txt", data: enc.encode("哈囉") },
        { name: "a/b.xml", data: enc.encode("<x/>") },
      ],
      AT,
    );
    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(["hello.txt", "a/b.xml"]);
    expect(entries.map((e) => e.method)).toEqual([0, 0]); // store，不壓縮
    expect(dec.decode(entries[0].data)).toBe("哈囉");
    expect(dec.decode(entries[1].data)).toBe("<x/>");
  });

  it("CRC32 用標準測試向量對得上", () => {
    // 「123456789」的 CRC-32 是 0xCBF43926（IEEE 802.3 標準向量）
    const zip = zipStore([{ name: "v", data: enc.encode("123456789") }], AT);
    expect(readZip(zip)[0].crc).toBe(0xcbf43926);
  });

  it("空內容也是合法項目", () => {
    const entries = readZip(zipStore([{ name: "empty", data: new Uint8Array(0) }], AT));
    expect(entries[0].data.length).toBe(0);
    expect(entries[0].crc).toBe(0);
  });
});
