// 測試專用的 ZIP 讀取器（不進 production code path）。刻意照 spec 的 offset 硬讀、
// 不共用 lib/zip.ts 的常數——共用了就變成「用同一套邏輯驗自己」。只認 store（method 0）。

const dec = new TextDecoder();

export type ReadEntry = { name: string; crc: number; method: number; data: Uint8Array };

export function readZip(bytes: Uint8Array): ReadEntry[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22; // 不放註解，所以 EOCD 固定在最後 22 bytes
  if (dv.getUint32(eocd, true) !== 0x06054b50) throw new Error("EOCD 不見了，這不是合法 ZIP");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);

  const out: ReadEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error(`central header ${i} 壞了`);
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const local = dv.getUint32(p + 42, true);

    if (dv.getUint32(local, true) !== 0x04034b50) throw new Error(`${name} 的 local header 壞了`);
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    out.push({ name, crc, method, data: bytes.subarray(start, start + size) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** 檔名 → 內容（UTF-8 文字）。 */
export function readZipText(bytes: Uint8Array): Map<string, string> {
  return new Map(readZip(bytes).map((e) => [e.name, dec.decode(e.data)]));
}
