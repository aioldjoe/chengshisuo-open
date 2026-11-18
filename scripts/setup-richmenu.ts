/**
 * 圖文選單一鍵設定（issue #18）：建選單 → 上圖 → 設為所有人預設 → 收掉自己建過的舊版。
 *
 *   pnpm setup:richmenu
 *
 * 可重複跑（改了文案或圖就再跑一次）：每次都建新的再切換預設，中途失敗不會把
 * 現役選單弄壞。只清名字是 RICH_MENU_NAME 開頭的舊選單——別人手動建的不碰。
 * 圖檔是 brand/richmenu.png；改了 brand/src/richmenu.html 要先跑 bash brand/render.sh。
 */

import fs from "node:fs";
import path from "node:path";

import { loadEnvLocal } from "./env";

loadEnvLocal();

async function main(): Promise<void> {
  const {
    createRichMenu,
    uploadRichMenuImage,
    setDefaultRichMenu,
    listRichMenus,
    deleteRichMenu,
  } = await import("../lib/line");
  const { RICH_MENU_NAME, richMenuObject } = await import("../lib/onboarding");

  const imagePath = path.join(process.cwd(), "brand", "richmenu.png");
  if (!fs.existsSync(imagePath)) {
    console.error("找不到 brand/richmenu.png——先跑 bash brand/render.sh 產圖。");
    process.exit(1);
  }
  const png = fs.readFileSync(imagePath);
  if (png.length > 1024 * 1024) {
    console.error(`richmenu.png ${Math.round(png.length / 1024)}KB 超過 LINE 的 1MB 上限。`);
    process.exit(1);
  }

  const before = await listRichMenus();
  const stale = before.filter((m) => m.name.startsWith(RICH_MENU_NAME.replace(/-v\d+$/, "")));

  const id = await createRichMenu(richMenuObject());
  console.log(`✓ 建立選單 ${id}`);
  await uploadRichMenuImage(id, png);
  console.log(`✓ 上傳圖片（${Math.round(png.length / 1024)}KB）`);
  await setDefaultRichMenu(id);
  console.log("✓ 設為所有人的預設選單");

  for (const m of stale) {
    await deleteRichMenu(m.richMenuId);
    console.log(`✓ 收掉舊選單 ${m.richMenuId}（${m.name}）`);
  }

  console.log("\n完成。手機上關掉聊天室重開就會看到新選單。");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
