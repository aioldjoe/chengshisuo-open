import { m4aDurationSeconds } from "./m4a";

/**
 * 音檔時長（免費檔單場 1 小時上限的檢查用）。
 *
 * 為什麼不只解 m4a：上限只擋得住量得到時長的格式，而 lib/routing.ts 收的副檔名有七種。
 * 只認 m4a 的話，一個 3 小時的 mp3 從頭到尾暢行無阻——閘門存在的理由（把免費檔的
 * 最壞成本鎖在 NT$24/人/月）就破了。
 *
 * 三種解法都只讀檔頭、不解碼：MP4 走 moov→mvhd、WAV 走 data 大小 ÷ byteRate、
 * MP3 走第一個 frame 的 CBR bitrate。VBR 的 mp3 會被高估或低估，但那是省成本的閘門
 * 不是安全邊界（同 lib/audio/m4a.ts 的立場），量得出個數量級就夠。
 * 真的認不出（amr、ogg、flac、壞檔）回 null，由呼叫端放行——月額度是最後一道底。
 */

export function audioDurationSeconds(buf: Buffer): number | null {
  // 一律照內容判、不看副檔名：LINE 上的檔名是使用者給的，內容才是事實
  return m4aDurationSeconds(buf) ?? wavDurationSeconds(buf) ?? mp3DurationSeconds(buf) ?? null;
}

/* --------------------------------- WAV --------------------------------- */

/** RIFF/WAVE：fmt chunk 給 byteRate，data chunk 給位元組數，兩者相除就是秒數。 */
export function wavDurationSeconds(buf: Buffer): number | null {
  if (buf.length < 12) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return null;

  let byteRate = 0;
  let p = 12;
  while (p + 8 <= buf.length) {
    const id = buf.toString("ascii", p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (id === "fmt " && p + 8 + 16 <= buf.length) byteRate = buf.readUInt32LE(p + 16);
    if (id === "data") return byteRate > 0 ? size / byteRate : null;
    // chunk 大小是奇數時補一個 pad byte；不補會一路錯位
    p += 8 + size + (size % 2);
    if (size <= 0) break; // 壞 size：停，不無限迴圈
  }
  return null;
}

/* --------------------------------- MP3 --------------------------------- */

/** MPEG-1 Layer III 的 bitrate 表（kbps）；index 0＝free、15＝保留，兩者都不猜。 */
const MPEG1_L3_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
/** MPEG-2／2.5 Layer III 的 bitrate 表（kbps）。 */
const MPEG2_L3_BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];

/**
 * CBR 假設下的時長：音訊位元組數 ÷ (bitrate/8)。
 * 先跳過 ID3v2 標籤（可能有幾十 KB 的封面圖，不跳的話會把它算成音訊）。
 */
export function mp3DurationSeconds(buf: Buffer): number | null {
  const start = skipId3(buf);
  const frame = findFrameHeader(buf, start);
  if (frame === null) return null;

  const b1 = buf[frame + 1];
  const b2 = buf[frame + 2];
  // version bits：11＝MPEG-1，10＝MPEG-2，00＝MPEG-2.5
  const mpeg1 = ((b1 >> 3) & 0b11) === 0b11;
  const table = mpeg1 ? MPEG1_L3_BITRATES : MPEG2_L3_BITRATES;
  const kbps = table[(b2 >> 4) & 0x0f];
  if (!kbps) return null;

  const bytesPerSecond = (kbps * 1000) / 8;
  const seconds = (buf.length - frame) / bytesPerSecond;
  return seconds > 0 ? seconds : null;
}

/** ID3v2 標頭 10 bytes ＋ 同步安全整數表示的內容長度。 */
function skipId3(buf: Buffer): number {
  if (buf.length < 10 || buf.toString("ascii", 0, 3) !== "ID3") return 0;
  const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
  const end = 10 + size;
  return end < buf.length ? end : 0;
}

/**
 * 第一個 frame sync（11 個 1）。只往前找一小段——找不到就是找不到，
 * 掃完整個幾十 MB 的 buffer 只為了確認「這不是 mp3」不划算。
 */
function findFrameHeader(buf: Buffer, from: number): number | null {
  const limit = Math.min(buf.length - 4, from + 64 * 1024);
  for (let p = from; p <= limit; p++) {
    if (buf[p] !== 0xff || (buf[p + 1] & 0xe0) !== 0xe0) continue;
    // layer bits 01＝Layer III；其餘（Layer I/II、保留）不是我們要的
    if (((buf[p + 1] >> 1) & 0b11) !== 0b01) continue;
    return p;
  }
  return null;
}
