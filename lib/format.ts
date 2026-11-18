// client / server 共用的顯示格式工具。勿放 server-only import（會進瀏覽器 bundle）。

/** mm:ss（超過一小時 h:mm:ss）。 */
export function fmtTime(sec: number): string {
  const s = Math.floor(sec);
  const p = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  return h > 0 ? `${h}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}` : `${p(Math.floor(s / 60))}:${p(s % 60)}`;
}

/**
 * fmtTime 的反向：「07:32」→ 452 秒。播放器在音檔 metadata 還沒下載完時
 * 先拿 durationLabel 頂著顯示總長，數字才不會從 00:00 跳一下。看不懂就回 null，不猜。
 */
export function parseClock(label: string | null): number | null {
  if (label === null) return null;
  const parts = label.split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((x) => !/^\d+$/.test(x))) return null;
  const nums = parts.map(Number);
  const [h, m, s] = nums.length === 3 ? nums : [0, nums[0], nums[1]];
  return h * 3600 + m * 60 + s;
}

/**
 * 把 fmtTime 產的「07:32」讀成「7 分 32 秒」。抬頭 meta 行用——
 * 「07:32」孤零零放著會被讀成時刻，不是時長。看不懂的字串原樣回傳。
 */
export function fmtDurationZh(label: string | null): string | null {
  if (label === null) return null;
  const total = parseClock(label);
  if (total === null) return label;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const out: string[] = [];
  if (h > 0) out.push(`${h} 小時`);
  if (m > 0) out.push(`${m} 分`);
  if (s > 0 || out.length === 0) out.push(`${s} 秒`);
  return out.join(" ");
}
