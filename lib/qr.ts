/**
 * QR code 編碼器（issue #15：首頁露出加好友 QR）。手寫是沿襲本倉的零依賴風格
 * （OOXML、ZIP、SigV4 都手寫了）；正確性不靠自己說，靠 qr.test.ts 用 jsQR
 * （獨立實作的解碼器）把每個版本邊界都真的掃回來。
 *
 * 範圍刻意收窄：byte mode、錯誤更正等級 M、版本 1–10（最多 213 bytes）。
 * 首頁 QR 的內容是一條 oaMessage 網址（約 70 bytes，落在版本 5），
 * 上限 213 已是三倍餘裕；不做 alphanumeric/kanji 模式與更高版本。
 */

export type QrMatrix = {
  /** 邊長（模組數）＝ 17 + 4 × 版本。 */
  size: number;
  /** 深模組為 true。座標是（列, 欄），左上為原點。 */
  get(row: number, col: number): boolean;
};

/**
 * 版本表（EC level M）。data＝資料碼字總數；ec＝每個分塊的更正碼字數；
 * blocks＝[分塊數, 每塊資料碼字數]（版本 8 起分兩組，長度差 1）。
 * 數字抄自 ISO/IEC 18004 表 9——抄錯的話對應版本的滿載測試會掃不回來。
 */
const VERSIONS: Array<{ data: number; ec: number; blocks: Array<[number, number]> }> = [
  { data: 16, ec: 10, blocks: [[1, 16]] },
  { data: 28, ec: 16, blocks: [[1, 28]] },
  { data: 44, ec: 26, blocks: [[1, 44]] },
  { data: 64, ec: 18, blocks: [[2, 32]] },
  { data: 86, ec: 24, blocks: [[2, 43]] },
  { data: 108, ec: 16, blocks: [[4, 27]] },
  { data: 124, ec: 18, blocks: [[4, 31]] },
  {
    data: 154,
    ec: 22,
    blocks: [
      [2, 38],
      [2, 39],
    ],
  },
  {
    data: 182,
    ec: 22,
    blocks: [
      [3, 36],
      [2, 37],
    ],
  },
  {
    data: 216,
    ec: 26,
    blocks: [
      [4, 43],
      [1, 44],
    ],
  },
];

/** 對位圖案中心座標（版本 1 沒有）。 */
const ALIGN: number[][] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

/** byte mode 的可放位元組數：扣掉 4-bit 模式頭與字數欄（版本 10 起字數欄 16 bits）。 */
function capacity(version: number): number {
  const countBits = version >= 10 ? 16 : 8;
  return Math.floor((VERSIONS[version - 1].data * 8 - 4 - countBits) / 8);
}

// --- GF(256)，本原多項式 0x11D（Reed-Solomon 用） ---

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
}

function gfMul(a: number, b: number): number {
  return a && b ? GF_EXP[GF_LOG[a] + GF_LOG[b]] : 0;
}

/** 多項式長除法取餘數（RS 更正碼字）。 */
function rsRemainder(data: Uint8Array, degree: number): Uint8Array {
  const gen = rsGeneratorHighFirst(degree);
  const rem = new Uint8Array(degree);
  for (const b of data) {
    const factor = b ^ rem[0];
    rem.copyWithin(0, 1);
    rem[degree - 1] = 0;
    for (let i = 0; i < degree; i++) rem[i] ^= gfMul(gen[i + 1], factor);
  }
  return rem;
}

/** 生成多項式（首一、高次在前，回傳含首項共 degree+1 個係數）。 */
function rsGeneratorHighFirst(degree: number): Uint8Array {
  // g(x) = Π (x − α^i)。從 [1]（常數 1）開始，每輪乘上 (x + α^i)。
  let g = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(g.length + 1);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j]; // × x
      next[j + 1] ^= gfMul(g[j], GF_EXP[i]); // × α^i
    }
    g = next;
  }
  return g;
}

// --- 位元流 → 碼字 ---

function buildCodewords(bytes: Uint8Array, version: number): Uint8Array {
  const spec = VERSIONS[version - 1];
  const bits: number[] = [];
  const push = (value: number, count: number) => {
    for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, version >= 10 ? 16 : 8);
  for (const b of bytes) push(b, 8);
  // 終止符最多 4 個 0，塞得下多少算多少；再補 0 到位元組邊界；再輪流補 0xEC/0x11
  push(0, Math.min(4, spec.data * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const data = new Uint8Array(spec.data);
  for (let i = 0; i < bits.length; i++) data[i >> 3] = (data[i >> 3] << 1) | bits[i];
  // 上面的寫法對最後一個未滿的 byte 不成立——bits 已補到 8 的倍數，所以安全
  for (let i = bits.length / 8, pad = 0xec; i < spec.data; i++, pad ^= 0xec ^ 0x11) data[i] = pad;

  // 切分塊、各算 EC，再交錯（interleave）：先輪流取各塊的資料碼字，再輪流取 EC
  const blocks: Uint8Array[] = [];
  const ecs: Uint8Array[] = [];
  let off = 0;
  for (const [count, len] of spec.blocks) {
    for (let k = 0; k < count; k++) {
      const block = data.slice(off, off + len);
      off += len;
      blocks.push(block);
      ecs.push(rsRemainder(block, spec.ec));
    }
  }
  const out = new Uint8Array(spec.data + spec.ec * blocks.length);
  let p = 0;
  const maxLen = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxLen; i++) {
    for (const b of blocks) if (i < b.length) out[p++] = b[i];
  }
  for (let i = 0; i < spec.ec; i++) {
    for (const e of ecs) out[p++] = e[i];
  }
  return out;
}

// --- 矩陣 ---

const MASKS: Array<(r: number, c: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

export function qrEncode(text: string): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  let version = 0;
  for (let v = 1; v <= VERSIONS.length; v++) {
    if (bytes.length <= capacity(v)) {
      version = v;
      break;
    }
  }
  if (!version) {
    throw new Error(
      `QR 內容 ${bytes.length} bytes 超過版本 ${VERSIONS.length}-M 的上限 ${capacity(VERSIONS.length)} bytes`,
    );
  }

  const size = 17 + 4 * version;
  const modules = new Uint8Array(size * size);
  const isFunction = new Uint8Array(size * size);
  const set = (r: number, c: number, dark: boolean) => {
    modules[r * size + c] = dark ? 1 : 0;
    isFunction[r * size + c] = 1;
  };

  // 定位圖案（含分隔帶）：以中心 (r, c) 畫 9×9，超出邊界的部分自然裁掉
  const finder = (r: number, c: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const y = r + dy;
        const x = c + dx;
        if (y < 0 || y >= size || x < 0 || x >= size) continue;
        const d = Math.max(Math.abs(dy), Math.abs(dx));
        set(y, x, d !== 2 && d !== 4);
      }
    }
  };
  finder(3, 3);
  finder(3, size - 4);
  finder(size - 4, 3);

  // 時序圖案
  for (let i = 8; i < size - 8; i++) {
    if (!isFunction[6 * size + i]) set(6, i, i % 2 === 0);
    if (!isFunction[i * size + 6]) set(i, 6, i % 2 === 0);
  }

  // 對位圖案：跳過與三個定位圖案重疊的角
  const centers = ALIGN[version - 1];
  for (const r of centers) {
    for (const c of centers) {
      const nearFinder =
        (r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8);
      if (nearFinder) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          set(r + dy, c + dx, Math.max(Math.abs(dy), Math.abs(dx)) !== 1);
        }
      }
    }
  }

  // 版本資訊（版本 7 起）：6 bits 版本號 + 12 bits BCH（生成式 0x1F25）
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const vbits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((vbits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, bit);
      set(b, a, bit);
    }
  }

  // 格式資訊的位置先保留（值要等選完遮罩才知道），順便放固定的深模組。
  // 座標順序照 bit 0..14：第一份繞左上定位圖案（欄 8 往下、再列 8 往左），
  // 第二份拆在列 8 右端（bit 0..7）與欄 8 下端（bit 8..14）
  const formatCells: Array<[number, number]> = [];
  for (let i = 0; i <= 5; i++) formatCells.push([i, 8]);
  formatCells.push([7, 8], [8, 8], [8, 7]);
  for (let i = 9; i <= 14; i++) formatCells.push([8, 14 - i]);
  for (const [r, c] of formatCells) set(r, c, false);
  for (let i = 0; i <= 7; i++) set(8, size - 1 - i, false);
  for (let i = 8; i <= 14; i++) set(size - 15 + i, 8, false);
  set(size - 8, 8, true); // 固定深模組

  // 資料位元蛇行填入（由右往左、兩欄一組、上下交替；欄 6 整條是時序，跳過）
  const cw = buildCodewords(bytes, version);
  const totalBits = cw.length * 8;
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? size - 1 - vert : vert;
        if (isFunction[r * size + c]) continue;
        // 剩餘位元（版本 2–6 有 7 個）補 0
        const bit =
          bitIndex < totalBits ? (cw[bitIndex >> 3] >>> (7 - (bitIndex & 7))) & 1 : 0;
        modules[r * size + c] = bit;
        bitIndex++;
      }
    }
  }

  // 八種遮罩都試，取罰分最低的
  let best: Uint8Array | null = null;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = Uint8Array.from(modules);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!isFunction[r * size + c] && MASKS[mask](r, c)) candidate[r * size + c] ^= 1;
      }
    }
    // 格式資訊在評分前寫入：罰分算的是完整符號（含格式模組），不是只有資料區
    writeFormat(candidate, size, mask, formatCells);
    const p = penalty(candidate, size);
    if (p < bestPenalty) {
      best = candidate;
      bestPenalty = p;
    }
  }
  const finalModules = best!;

  return { size, get: (r, c) => finalModules[r * size + c] === 1 };
}

/** 格式資訊：EC level M（00）＋遮罩號，BCH（0x537）加 10 bits，再 XOR 0x5412。 */
function writeFormat(modules: Uint8Array, size: number, mask: number, cells: Array<[number, number]>) {
  const data = (0b00 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i: number) => ((bits >>> i) & 1) as 0 | 1;
  cells.forEach(([r, c], i) => {
    modules[r * size + c] = bit(i);
  });
  for (let i = 0; i <= 7; i++) modules[8 * size + (size - 1 - i)] = bit(i);
  for (let i = 8; i <= 14; i++) modules[(size - 15 + i) * size + 8] = bit(i);
}

/** 遮罩罰分（ISO 18004 的四條規則）。分數只用來比大小，不對外。 */
function penalty(m: Uint8Array, size: number): number {
  let score = 0;
  const at = (r: number, c: number) => m[r * size + c];

  // N1：同色連續 ≥5；N3：1011101 兩側帶 0000 的假定位圖案（40 分）
  for (let axis = 0; axis < 2; axis++) {
    for (let i = 0; i < size; i++) {
      let run = 0;
      let prev = -1;
      let history = 0; // 最近 11 格的位元窗
      for (let j = 0; j < size; j++) {
        const v = axis === 0 ? at(i, j) : at(j, i);
        if (v === prev) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score++;
        } else {
          prev = v;
          run = 1;
        }
        history = ((history << 1) | v) & 0x7ff;
        if (j >= 10 && (history === 0b00001011101 || history === 0b10111010000)) score += 40;
      }
    }
  }

  // N2：2×2 同色
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = at(r, c);
      if (v === at(r, c + 1) && v === at(r + 1, c) && v === at(r + 1, c + 1)) score += 3;
    }
  }

  // N4：深色比例偏離 50% 每 5% 加 10 分
  let dark = 0;
  for (const v of m) dark += v;
  score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
  return score;
}

/**
 * 深模組轉成單一 SVG path 的 d（每列跑 run-length，一段連續深模組一個子路徑）。
 * viewBox 用 `0 0 size size`，quiet zone 由外層留白負責（規格要 4 模組）。
 */
export function qrSvgPath(m: QrMatrix): string {
  const parts: string[] = [];
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (!m.get(r, c)) continue;
      let len = 1;
      while (c + len < m.size && m.get(r, c + len)) len++;
      parts.push(`M${c} ${r}h${len}v1h-${len}z`);
      c += len - 1;
    }
  }
  return parts.join("");
}
