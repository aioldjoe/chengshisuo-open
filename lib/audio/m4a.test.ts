import { describe, expect, it } from "vitest";

import { m4aDurationSeconds } from "./m4a";

// 依 MP4 規格手組最小容器：box = [size u32][type 4字元][payload]。
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};

const box = (type: string, payload: Buffer): Buffer =>
  Buffer.concat([u32(8 + payload.length), Buffer.from(type, "ascii"), payload]);

/** mvhd v0：version(1)+flags(3)+ctime(4)+mtime(4)+timescale(4)+duration(4)＋殘餘欄位。 */
const mvhdV0 = (timescale: number, duration: number): Buffer =>
  box(
    "mvhd",
    Buffer.concat([Buffer.alloc(4), u32(0), u32(0), u32(timescale), u32(duration), Buffer.alloc(80)]),
  );

/** mvhd v1：version(1)+flags(3)+ctime(8)+mtime(8)+timescale(4)+duration(8)。 */
const mvhdV1 = (timescale: number, duration: bigint): Buffer => {
  const dur = Buffer.alloc(8);
  dur.writeBigUInt64BE(duration);
  return box(
    "mvhd",
    Buffer.concat([
      Buffer.from([1, 0, 0, 0]),
      Buffer.alloc(16),
      u32(timescale),
      dur,
      Buffer.alloc(80),
    ]),
  );
};

const ftyp = box("ftyp", Buffer.from("M4A \0\0\0\0M4A mp42isom", "ascii"));

describe("m4aDurationSeconds", () => {
  it("mvhd v0：timescale 1000、duration 7,260,000 → 7260 秒", () => {
    const buf = Buffer.concat([ftyp, box("moov", mvhdV0(1000, 7_260_000))]);
    expect(m4aDurationSeconds(buf)).toBe(7260);
  });

  it("mvhd v1（64-bit duration）也讀得到", () => {
    const buf = Buffer.concat([ftyp, box("moov", mvhdV1(44100, BigInt(44100 * 90)))]);
    expect(m4aDurationSeconds(buf)).toBe(90);
  });

  it("moov 在檔尾（mdat 之後）也找得到", () => {
    const buf = Buffer.concat([
      ftyp,
      box("mdat", Buffer.alloc(64)),
      box("moov", mvhdV0(600, 600 * 30)),
    ]);
    expect(m4aDurationSeconds(buf)).toBe(30);
  });

  it("非 MP4 內容 → null（mp3/wav 等放行交給後段）", () => {
    expect(m4aDurationSeconds(Buffer.from("ID3\x04\x00 not an mp4 at all........"))).toBeNull();
  });

  it("timescale 為 0 的壞檔 → null 不除以零", () => {
    const buf = Buffer.concat([ftyp, box("moov", mvhdV0(0, 1000))]);
    expect(m4aDurationSeconds(buf)).toBeNull();
  });
});
