import crypto from "node:crypto";

/**
 * Cloudflare R2 物件儲存（S3 相容 API、手寫 SigV4，零依賴 fetch 風格）。
 * 音檔的唯一落點；72 小時後由 cron 真刪（GLOSSARY.md「音檔銷毀」）。
 * 未設 env 時 hasR2() 為 false，pipeline 會跳過音檔保存（本機開發不擋流程）。
 */

const REGION = "auto";
const SERVICE = "s3";

export function hasR2(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET,
  );
}

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} 未設定`);
  return v;
}

const sha256Hex = (data: string | Buffer) => crypto.createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) =>
  crypto.createHmac("sha256", key).update(data).digest();

function signingKey(secret: string, date: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), REGION), SERVICE), "aws4_request");
}

/** YYYYMMDDTHHMMSSZ */
function amzDate(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function encodePath(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

function endpoint(): { host: string; bucketPath: string } {
  const host = `${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`;
  return { host, bucketPath: `/${env("R2_BUCKET")}` };
}

/** header 簽名（PUT/DELETE 用）。 */
function signedRequest(
  method: string,
  key: string,
  body: Buffer | null,
  contentType?: string,
  now = new Date(),
): { url: string; headers: Record<string, string> } {
  const { host, bucketPath } = endpoint();
  const path = `${bucketPath}/${encodePath(key)}`;
  const t = amzDate(now);
  const d = t.slice(0, 8);
  const payloadHash = sha256Hex(body ?? "");

  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": t,
  };
  if (contentType) headers["content-type"] = contentType;

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((h) => `${h}:${headers[h]}\n`).join("");
  const signedHeaders = names.join(";");
  const canonical = [method, path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${d}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", t, scope, sha256Hex(canonical)].join("\n");
  const signature = crypto
    .createHmac("sha256", signingKey(env("R2_SECRET_ACCESS_KEY"), d))
    .update(stringToSign)
    .digest("hex");

  headers.authorization = `AWS4-HMAC-SHA256 Credential=${env("R2_ACCESS_KEY_ID")}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  delete headers.host; // fetch 會依 URL 自帶，與簽章一致
  return { url: `https://${host}${path}`, headers };
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const { url, headers } = signedRequest("PUT", key, body, contentType);
  const res = await fetch(url, { method: "PUT", headers, body: new Uint8Array(body) });
  if (!res.ok) throw new Error(`R2 PUT ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

export async function deleteObject(key: string): Promise<void> {
  const { url, headers } = signedRequest("DELETE", key, null);
  const res = await fetch(url, { method: "DELETE", headers });
  // 204＝刪成功；404＝本來就不在（冪等，同樣視為成功）
  if (!res.ok && res.status !== 404) {
    throw new Error(`R2 DELETE ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

/** 限時下載連結（原音回放用）。exported now 參數 for test。 */
export function presignGetUrl(key: string, expiresSeconds: number, now = new Date()): string {
  const { host, bucketPath } = endpoint();
  const path = `${bucketPath}/${encodePath(key)}`;
  const t = amzDate(now);
  const d = t.slice(0, 8);
  const scope = `${d}/${REGION}/${SERVICE}/aws4_request`;

  const params: [string, string][] = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${env("R2_ACCESS_KEY_ID")}/${scope}`],
    ["X-Amz-Date", t],
    ["X-Amz-Expires", String(expiresSeconds)],
    ["X-Amz-SignedHeaders", "host"],
  ];
  const query = params
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .sort()
    .join("&");

  const canonical = ["GET", path, query, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", t, scope, sha256Hex(canonical)].join("\n");
  const signature = crypto
    .createHmac("sha256", signingKey(env("R2_SECRET_ACCESS_KEY"), d))
    .update(stringToSign)
    .digest("hex");

  return `https://${host}${path}?${query}&X-Amz-Signature=${signature}`;
}
