import fs from "node:fs";
import path from "node:path";

/** tsx 不吃 Next 的 .env.local，跑腳本前自己讀（只認 KEY=VALUE，夠用就好）。 */
export function loadEnvLocal(): void {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, raw] = m;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.trim().replace(/^["']|["']$/g, "").replace(/\s+#.*$/, "");
  }
}
