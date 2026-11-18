/**
 * Cloudflare AI Gateway（統一觀測、快取、限流的代理層）。
 * 設 CF_AI_GATEWAY_ID 即啟用，所有 AI 呼叫改走 gateway；未設時各呼叫端退回直連官方 API。
 * 帳號 ID 沿用 R2_ACCOUNT_ID（同一個 Cloudflare 帳號），跨帳號時用 CF_ACCOUNT_ID 覆寫。
 */

export type GatewayProvider = "anthropic" | "google-ai-studio" | "grok" | "elevenlabs";

type Env = Record<string, string | undefined>;

function accountId(env: Env): string | undefined {
  return env.CF_ACCOUNT_ID || env.R2_ACCOUNT_ID;
}

export function gatewayBaseUrl(provider: GatewayProvider, env: Env = process.env): string | null {
  const account = accountId(env);
  const gateway = env.CF_AI_GATEWAY_ID;
  if (!account || !gateway) return null;
  return `https://gateway.ai.cloudflare.com/v1/${account}/${gateway}/${provider}`;
}

/**
 * gateway 開 Authenticated Gateway 時需要的驗證標頭；沒開就是空物件，可安全展開進 headers。
 * gateway 未啟用時即使設了 token 也回空——直連官方 API 時附上會把 gateway token 洩漏給第三方。
 */
export function gatewayHeaders(env: Env = process.env): Record<string, string> {
  const token = env.CF_AI_GATEWAY_TOKEN;
  if (!token || !accountId(env) || !env.CF_AI_GATEWAY_ID) return {};
  return { "cf-aig-authorization": `Bearer ${token}` };
}
