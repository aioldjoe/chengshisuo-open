import { describe, expect, it } from "vitest";

import { audioDurationSeconds } from "./duration";

/* --- WAV：RIFF 容器，時長＝data chunk 大小 / byteRate --- */

const wav = (byteRate: number, dataBytes: number): Buffer => {
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0); // PCM
  fmt.writeUInt16LE(1, 2); // 單聲道
  fmt.writeUInt32LE(16000, 4); // sample rate
  fmt.writeUInt32LE(byteRate, 8);
  const head = Buffer.alloc(12);
  head.write("RIFF", 0, "ascii");
  head.writeUInt32LE(36 + dataBytes, 4);
  head.write("WAVE", 8, "ascii");
  const fmtChunk = Buffer.alloc(8);
  fmtChunk.write("fmt ", 0, "ascii");
  fmtChunk.writeUInt32LE(16, 4);
  const dataChunk = Buffer.alloc(8);
  dataChunk.write("data", 0, "ascii");
  dataChunk.writeUInt32LE(dataBytes, 4);
  return Buffer.concat([head, fmtChunk, fmt, dataChunk, Buffer.alloc(Math.min(dataBytes, 64))]);
};

/* --- MP3：CBR frame header，時長＝檔案大小 / (bitrate/8) --- */

/**
 * MPEG-1 Layer III frame header：0xFF 0xFB 後接 bitrate index(4)+sample rate index(2)。
 * 0x90 = bitrate index 9（128 kbps）、sample rate index 0（44100）。
 */
const mp3 = (totalBytes: number, lead: Buffer<ArrayBuffer> = Buffer.alloc(0)): Buffer =>
  Buffer.concat([
    lead,
    Buffer.from([0xff, 0xfb, 0x90, 0x00]),
    Buffer.alloc(Math.max(0, totalBytes - lead.length - 4)),
  ]);

/** ID3v2 標頭：'ID3' + 版本(2) + flags(1) + 同步安全大小(4)。 */
const id3 = (payload: number): Buffer<ArrayBuffer> => {
  const b = Buffer.alloc(10 + payload);
  b.write("ID3", 0, "ascii");
  b[3] = 3;
  // 同步安全整數：每 byte 只用低 7 bits
  b[6] = (payload >> 21) & 0x7f;
  b[7] = (payload >> 14) & 0x7f;
  b[8] = (payload >> 7) & 0x7f;
  b[9] = payload & 0x7f;
  return b;
};

describe("audioDurationSeconds - WAV", () => {
  it("byteRate 與 data 大小算得出時長", () => {
    // 32000 B/s（16kHz、16-bit 單聲道）跑 90 秒
    expect(audioDurationSeconds(wav(32000, 32000 * 90))).toBeCloseTo(90, 1);
  });

  it("超過一小時的 wav 量得出來——免費檔的單場上限才擋得住它", () => {
    const d = audioDurationSeconds(wav(32000, 32000 * 4000));
    expect(d).not.toBeNull();
    expect(d!).toBeGreaterThan(3600);
  });

  it("byteRate 為 0 的壞檔 → null，不除以零", () => {
    expect(audioDurationSeconds(wav(0, 1000))).toBeNull();
  });
});

describe("audioDurationSeconds - MP3", () => {
  it("CBR 128kbps：時長＝大小 /（bitrate/8）", () => {
    // 128 kbps = 16000 B/s；60 秒 ≈ 960000 bytes
    expect(audioDurationSeconds(mp3(960_000))).toBeCloseTo(60, 0);
  });

  it("前面掛著 ID3v2 標籤也找得到第一個 frame", () => {
    const tag = id3(2048);
    const d = audioDurationSeconds(mp3(960_000 + tag.length, tag));
    expect(d).toBeCloseTo(60, 0);
  });

  it("三小時的 mp3 量得出來（這正是 m4a 解析器漏掉的那條路）", () => {
    const d = audioDurationSeconds(mp3(16_000 * 3 * 3600));
    expect(d).not.toBeNull();
    expect(d!).toBeGreaterThan(3 * 3600 - 60);
  });

  it("找不到 frame header 的垃圾 → null", () => {
    expect(audioDurationSeconds(Buffer.alloc(4096))).toBeNull();
  });

  it("free bitrate（index 0）與保留值（index 15）不猜 → null", () => {
    const free = Buffer.concat([Buffer.from([0xff, 0xfb, 0x00, 0x00]), Buffer.alloc(1000)]);
    const bad = Buffer.concat([Buffer.from([0xff, 0xfb, 0xf0, 0x00]), Buffer.alloc(1000)]);
    expect(audioDurationSeconds(free)).toBeNull();
    expect(audioDurationSeconds(bad)).toBeNull();
  });
});

describe("audioDurationSeconds - 派工", () => {
  it("m4a 仍走 MP4 容器解析", () => {
    // 手組最小 moov/mvhd：timescale 1000、duration 5000 → 5 秒
    const u32 = (n: number) => {
      const b = Buffer.alloc(4);
      b.writeUInt32BE(n);
      return b;
    };
    const box = (type: string, payload: Buffer) =>
      Buffer.concat([u32(8 + payload.length), Buffer.from(type, "ascii"), payload]);
    const mvhd = box(
      "mvhd",
      Buffer.concat([Buffer.alloc(4), u32(0), u32(0), u32(1000), u32(5000), Buffer.alloc(80)]),
    );
    expect(audioDurationSeconds(box("moov", mvhd))).toBeCloseTo(5, 3);
  });

  it("三種容器都不認得 → null", () => {
    expect(audioDurationSeconds(Buffer.alloc(100))).toBeNull();
  });

  it("不看副檔名，只看內容", () => {
    const u32 = (n: number) => {
      const b = Buffer.alloc(4);
      b.writeUInt32BE(n);
      return b;
    };
    const box = (type: string, payload: Buffer) =>
      Buffer.concat([u32(8 + payload.length), Buffer.from(type, "ascii"), payload]);
    const mvhd = box(
      "mvhd",
      Buffer.concat([Buffer.alloc(4), u32(0), u32(0), u32(1000), u32(9000), Buffer.alloc(80)]),
    );
    expect(audioDurationSeconds(box("moov", mvhd))).toBeCloseTo(9, 3);
  });
});
