import fs from "node:fs";
import path from "node:path";

/** tsx 不吃 Next 的 .env.local，bake-off 自己讀（只認 KEY=VALUE，已存在的環境變數優先）。 */
export function loadEnvLocal(): void {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    if (process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "").replace(/(^|\s+)#.*$/, "");
  }
}
