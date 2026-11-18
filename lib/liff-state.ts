/**
 * LIFF 深連結的落地處理。
 *
 * LINE 開 https://liff.line.me/{LIFF_ID}/m/{id} 時不會直接開 /m/{id}——它先開
 * Endpoint URL，把路徑塞在 ?liff.state=/m/{id}（primary redirect），再靠那一頁
 * 執行 liff.init() 跳到真正路徑（secondary redirect）。首頁是純落地頁不跑 SDK，
 * 所以在伺服器端直接看 liff.state 轉走，endpoint 填網域根或 /m 都通、也不用等 SDK。
 *
 * 其餘 query（外部瀏覽器登入回跳會帶 code／state／liffClientId／liffRedirectUri）
 * 原樣帶過去，讓目的頁的 liff.init() 接手完成登入。
 *
 * 桌機外部瀏覽器登入回跳是**另一種**形狀（2026-08-23 實測）：LINE 一律把人送回
 * Endpoint URL，但這一趟**不帶 liff.state**，目的地改放在 liffRedirectUri。
 * 首頁不跑 SDK，只認 liff.state 的話人就停在落地頁——記錄頁再也回不去。
 */

/** 只准站內相對路徑，擋掉 //evil.com 這種 open redirect。 */
function isSafePath(p: string): boolean {
  return p.startsWith("/") && !p.startsWith("//") && !p.startsWith("/\\");
}

/**
 * 登入回跳的目的地。liffRedirectUri 是絕對網址，只取路徑就好——
 * 轉相對路徑天生留在站內，別站的網址也害不了人。
 * 指回根路徑要當沒有：轉去同一頁 = 無限迴圈。
 */
function pathFromRedirectUri(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw, "https://liff-state.invalid");
  } catch {
    return null;
  }
  const path = `${u.pathname}${u.search}${u.hash}`;
  if (u.pathname === "/") return null;
  return isSafePath(path) ? path : null;
}

/**
 * 從 endpoint 頁收到的 query 算出要轉去的站內路徑；
 * liff.state 優先，其次 liffRedirectUri（登入回跳），兩者都沒有回 null。
 * 支援 URLSearchParams 或 Next 的 searchParams 物件（值可能是陣列，取第一個）。
 */
export function resolveLiffState(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): string | null {
  const sp =
    params instanceof URLSearchParams
      ? params
      : new URLSearchParams(
          Object.entries(params).flatMap(([k, v]) =>
            v === undefined ? [] : Array.isArray(v) ? v.map((x) => [k, x] as [string, string]) : [[k, v] as [string, string]],
          ),
        );

  const raw = sp.get("liff.state");

  // liff.state 本身可能帶 query 與 fragment；拆開後把外層其他參數併回去
  let target: string;
  if (raw) {
    try {
      target = decodeURIComponent(raw);
    } catch {
      target = raw;
    }
    if (!isSafePath(target)) return null;
  } else {
    // 沒有 liff.state：可能是登入回跳，目的地在 liffRedirectUri（見檔頭）
    const redirectUri = sp.get("liffRedirectUri");
    const fallback = redirectUri ? pathFromRedirectUri(redirectUri) : null;
    if (!fallback) return null;
    target = fallback;
  }

  const hashAt = target.indexOf("#");
  const hash = hashAt >= 0 ? target.slice(hashAt) : "";
  const noHash = hashAt >= 0 ? target.slice(0, hashAt) : target;
  const qAt = noHash.indexOf("?");
  const pathname = qAt >= 0 ? noHash.slice(0, qAt) : noHash;
  const inner = new URLSearchParams(qAt >= 0 ? noHash.slice(qAt + 1) : "");

  for (const [k, v] of sp) {
    if (k === "liff.state") continue;
    inner.append(k, v);
  }
  const qs = inner.toString();
  return `${pathname}${qs ? `?${qs}` : ""}${hash}`;
}
