/**
 * LIFF 身分驗證（共識雷點 #1）：頁端 liff.getIDToken() 送來的 id token，
 * 一律後端打 LINE 的 verify 端點換 sub——不可信前端 profile。
 * LIFF 掛的 LINE Login channel 必須與 bot 的 Messaging API channel 同 provider，
 * sub 才會等於 webhook 看到的 userId。
 */

const VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";

/** 驗證 id token；成功回 LINE userId（sub），任何失敗（過期、偽造、未設 env、網路）回 null。 */
export async function verifyLineIdToken(idToken: string): Promise<string | null> {
  const clientId = process.env.LINE_LOGIN_CHANNEL_ID;
  if (!clientId) return null;
  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: clientId }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { sub?: string };
    return body.sub ?? null;
  } catch {
    return null;
  }
}
