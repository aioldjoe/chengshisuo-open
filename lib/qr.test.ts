import jsQR from "jsqr";
import { afterEach, describe, expect, it } from "vitest";

import { oaMessageUrl } from "./join";
import { qrEncode, qrSvgPath } from "./qr";
import { DEMO_PREFILL_MESSAGE } from "./routing";

afterEach(() => {
  delete process.env.NEXT_PUBLIC_LINE_OA_ID;
});

/**
 * 驗證方式是「真的掃回來」：用 jsQR（獨立實作的解碼器）把我們編出來的矩陣
 * 解回原文。結構性測試只能證明長得像 QR，掃得回才證明是 QR。
 */

/** 把矩陣畫成 RGBA 點陣給 jsQR 掃：每模組 4px、外圍留 4 模組靜區（規格要求）。 */
function rasterize(m: { size: number; get: (row: number, col: number) => boolean }) {
  const scale = 4;
  const quiet = 4;
  const px = (m.size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(px * px * 4).fill(255);
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (!m.get(r, c)) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const x = (quiet + c) * scale + dx;
          const y = (quiet + r) * scale + dy;
          const i = (y * px + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    }
  }
  return { data, width: px, height: px };
}

function decode(text: string): string | null {
  const img = rasterize(qrEncode(text));
  return jsQR(img.data, img.width, img.height)?.data ?? null;
}

describe("qrEncode", () => {
  it("首頁 QR 的實際內容（oaMessage 深連結＋預填訊息）掃得回原文——用真的組法組，不寫死", () => {
    process.env.NEXT_PUBLIC_LINE_OA_ID = "@592rrmzt";
    const url = oaMessageUrl(DEMO_PREFILL_MESSAGE)!;
    expect(url).toContain("oaMessage");
    expect(decode(url)).toBe(url);
  });

  it("各種長度都掃得回——跨版本（1–10）與跨分塊的邊界都要過", () => {
    // 14/15 是 v1→v2 的邊界；62/84/106 落在 v4/v5/v6 滿載；152+ 進多分塊交錯；213 是 v10-M 滿載
    for (const len of [1, 14, 15, 42, 62, 63, 84, 106, 122, 152, 180, 213]) {
      const text = "A".repeat(len);
      expect(decode(text), `len=${len}`).toBe(text);
    }
  });

  it("非 ASCII 走 UTF-8 bytes，掃回來位元組一致", () => {
    const text = "成事所：開完的會，別讓決議散掉。";
    const img = rasterize(qrEncode(text));
    const decoded = jsQR(img.data, img.width, img.height);
    expect(new Uint8Array(decoded!.binaryData)).toEqual(new TextEncoder().encode(text));
  });

  it("超過 v10-M 容量（213 bytes）丟明確錯誤，不產出掃不動的圖", () => {
    expect(() => qrEncode("A".repeat(214))).toThrow(/QR/);
  });

  it("矩陣尺寸符合版本（17 + 4v）", () => {
    expect(qrEncode("A").size).toBe(21); // v1
    expect(qrEncode("A".repeat(84)).size).toBe(37); // v5
  });
});

describe("qrSvgPath", () => {
  it("產出單一 path 的 d：深模組全在、淺模組不畫", () => {
    const m = qrEncode("hello");
    const d = qrSvgPath(m);
    expect(d).toMatch(/^M\d/);
    // 左上角的定位圖案第一列是 7 個連續深模組——路徑裡一定有一段 h7
    expect(d).toContain("h7");
  });
});
