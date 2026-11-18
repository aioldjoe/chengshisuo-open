// 自製播放器的純邏輯。client / server 共用工具，勿放 server-only import。

/**
 * 播放位置落在第幾段逐字稿：最後一個 start <= time 的索引，還沒到第一段回 -1。
 * starts 必須遞增（轉寫本來就是時序）。逐字稿動輒上千段、timeupdate 一秒好幾發，
 * 所以走二分不走 findLast。同一秒有兩段時取後面那段——聽到的是後面那句。
 */
export function activeTurnIndex(starts: number[], time: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= time) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** 進度條填色百分比。時長還沒讀到（m4a 常見的 0／NaN／Infinity）回 0，條才不會亂跳。 */
export function progressPercent(current: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(100, Math.max(0, (current / duration) * 100));
}

/**
 * 使用者是不是正在選字？整列逐字稿都是跳播熱區，但選字放開的那一下也會是 click——
 * 那時他要的是複製，不是播放。拿不到 Selection 就當沒選字：寧可多播一次，
 * 不要讓整列變成點不動的啞區。
 * （只選到空白／換行是點擊跨段落邊界的常見回報，不算選字。）
 */
export function isSelectingText(
  sel: { isCollapsed: boolean; toString(): string } | null,
): boolean {
  if (!sel || sel.isCollapsed) return false;
  return sel.toString().trim().length > 0;
}

/**
 * ±10 秒跳播的落點。前面夾到 0，後面夾到結尾——時長還沒讀到（m4a 串流中）就不夾上界，
 * 讓瀏覽器自己決定；夾成 0 會變成「往前跳＝跳回開頭」，比不能跳更糟。
 */
export function skipTarget(current: number, delta: number, duration: number): number {
  const t = Math.max(0, current + delta);
  if (!Number.isFinite(duration) || duration <= 0) return t;
  return Math.min(t, duration);
}

/**
 * 播放速度：會議錄音的第二個主力操作（第一個是跳到某段）。
 * 只給三段——點一下換一段的鈕，選項多了就得改成選單，多一層互動不划算。
 */
export const PLAY_RATES = [1, 1.5, 2] as const;

/** 下一段速度，繞回第一段。不在清單上（存壞了、舊版留下的）一律回 1×。 */
export function nextRate(current: number): number {
  const i = PLAY_RATES.indexOf(current as (typeof PLAY_RATES)[number]);
  if (i < 0) return PLAY_RATES[0];
  return PLAY_RATES[(i + 1) % PLAY_RATES.length];
}

/** localStorage 讀回來的東西一律不信：不是清單上的值就回 1×。 */
export function parseRate(raw: string | null): number {
  const n = Number(raw);
  return PLAY_RATES.includes(n as (typeof PLAY_RATES)[number]) ? n : PLAY_RATES[0];
}

/** 速度標籤。固定一位小數，換速時鈕的寬度才不會抖。 */
export function rateLabel(rate: number): string {
  return `${rate.toFixed(1)}×`;
}
