/**
 * 從 MP4/M4A 容器讀出音檔時長（單場 1 小時上限的檢查用）。
 * 只解析 moov→mvhd 一條路；解析不出（mp3/wav/壞檔）回 null，由呼叫端決定放行——
 * 上限檢查是省成本用的閘門，不是安全邊界，主打格式 m4a 涵蓋即可。
 */

const HEADER = 8;

export function m4aDurationSeconds(buf: Buffer): number | null {
  const moov = findBox(buf, 0, buf.length, "moov");
  if (!moov) return null;
  const mvhd = findBox(buf, moov.start, moov.end, "mvhd");
  if (!mvhd) return null;
  return parseMvhd(buf, mvhd.start, mvhd.end);
}

/** 在 [from, to) 內走頂層 box 序列，回傳指定 type 的 payload 範圍。 */
function findBox(
  buf: Buffer,
  from: number,
  to: number,
  type: string,
): { start: number; end: number } | null {
  let p = from;
  while (p + HEADER <= to) {
    let size = buf.readUInt32BE(p);
    let payloadStart = p + HEADER;
    if (size === 1) {
      // 64-bit largesize 接在 type 後面
      if (p + 16 > to) return null;
      const large = buf.readBigUInt64BE(p + HEADER);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      size = Number(large);
      payloadStart = p + 16;
    } else if (size === 0) {
      size = to - p; // 延伸到結尾
    }
    if (size < HEADER || p + size > to) return null; // 壞 size：停，不無限迴圈
    if (buf.toString("ascii", p + 4, p + 8) === type) {
      return { start: payloadStart, end: p + size };
    }
    p += size;
  }
  return null;
}

function parseMvhd(buf: Buffer, start: number, end: number): number | null {
  if (start + 4 > end) return null;
  const version = buf.readUInt8(start);
  // v0：ctime(4)+mtime(4) 後接 timescale(4)+duration(4)；v1 前兩者各 8 bytes、duration 8 bytes
  if (version === 0) {
    if (start + 20 > end) return null;
    const timescale = buf.readUInt32BE(start + 12);
    const duration = buf.readUInt32BE(start + 16);
    return timescale > 0 && duration > 0 ? duration / timescale : null;
  }
  if (version === 1) {
    if (start + 32 > end) return null;
    const timescale = buf.readUInt32BE(start + 20);
    const duration = buf.readBigUInt64BE(start + 24);
    if (timescale <= 0 || duration <= 0n || duration > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(duration) / timescale;
  }
  return null;
}
