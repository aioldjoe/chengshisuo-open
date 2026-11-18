// 極簡 ZIP 寫入器。存在的理由只有一個：.docx 就是一包 ZIP，
// 而這個專案不為了打包一份文件裝一整套壓縮函式庫（見 CLAUDE.md 的零重依賴）。
//
// 只做 store（不壓縮）：Word／Pages／Google Docs 都吃，省掉 deflate 那一整塊。
// 代價是檔案大約是壓縮版的兩三倍——一場會議的文字量下，那還是幾十 KB 的事。

export type ZipEntry = { name: string; data: Uint8Array };

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
/** bit 11：檔名是 UTF-8。我們的檔名都是 ASCII，但標了才不用擔心以後放中文。 */
const FLAG_UTF8 = 0x800;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** DOS 時間戳：秒只有 2 秒精度，年份從 1980 起跳——ZIP 就是這麼老。 */
function dosDateTime(at: Date): { time: number; date: number } {
  const y = Math.max(1980, at.getFullYear());
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1),
    date: ((y - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  };
}

/** 依序寫入 entries，回傳整包 ZIP 的位元組。名字重複與否不管，由呼叫端負責。 */
export function zipStore(entries: ZipEntry[], at: Date): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(at);

  const prepared = entries.map((e) => ({
    name: enc.encode(e.name),
    data: e.data,
    crc: crc32(e.data),
  }));

  const localSize = prepared.reduce((n, e) => n + 30 + e.name.length + e.data.length, 0);
  const centralSize = prepared.reduce((n, e) => n + 46 + e.name.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const dv = new DataView(out.buffer);

  let p = 0;
  const offsets: number[] = [];
  for (const e of prepared) {
    offsets.push(p);
    dv.setUint32(p, LOCAL_SIG, true);
    dv.setUint16(p + 4, 20, true); // 解壓需要的版本
    dv.setUint16(p + 6, FLAG_UTF8, true);
    dv.setUint16(p + 8, 0, true); // method: store
    dv.setUint16(p + 10, time, true);
    dv.setUint16(p + 12, date, true);
    dv.setUint32(p + 14, e.crc, true);
    dv.setUint32(p + 18, e.data.length, true); // 壓縮後
    dv.setUint32(p + 22, e.data.length, true); // 原始
    dv.setUint16(p + 26, e.name.length, true);
    dv.setUint16(p + 28, 0, true); // extra
    out.set(e.name, p + 30);
    out.set(e.data, p + 30 + e.name.length);
    p += 30 + e.name.length + e.data.length;
  }

  const centralStart = p;
  prepared.forEach((e, i) => {
    dv.setUint32(p, CENTRAL_SIG, true);
    dv.setUint16(p + 4, 20, true); // 產生者版本
    dv.setUint16(p + 6, 20, true);
    dv.setUint16(p + 8, FLAG_UTF8, true);
    dv.setUint16(p + 10, 0, true);
    dv.setUint16(p + 12, time, true);
    dv.setUint16(p + 14, date, true);
    dv.setUint32(p + 16, e.crc, true);
    dv.setUint32(p + 20, e.data.length, true);
    dv.setUint32(p + 24, e.data.length, true);
    dv.setUint16(p + 28, e.name.length, true);
    // extra / comment / disk / 屬性全部 0，位元組已預先歸零
    dv.setUint32(p + 42, offsets[i], true);
    out.set(e.name, p + 46);
    p += 46 + e.name.length;
  });

  dv.setUint32(p, EOCD_SIG, true);
  dv.setUint16(p + 8, prepared.length, true);
  dv.setUint16(p + 10, prepared.length, true);
  dv.setUint32(p + 12, centralSize, true);
  dv.setUint32(p + 16, centralStart, true);

  return out;
}
