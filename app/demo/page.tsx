import type { Metadata } from "next";
import { after } from "next/server";

import { recordEvent } from "@/lib/store/events";

import DemoView from "./demo-view";

/**
 * 首頁「看一份真的記錄頁」的落點（issue #14）：公開、唯讀、不過期、不綁身分。
 * 資料編譯在 lib/demo-meeting.ts，不走資料庫——為什麼是這樣，理由寫在那個檔頭。
 *
 * force-dynamic 是為了計數：這頁沒碰任何動態 API，不聲明的話 build 時就被
 * 靜態化，demo_opened 只會在建置那一刻記一筆，之後誰開都數不到。
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "示範記錄頁",
  description: "一份成事所的會議記錄頁長這樣：重點、決議、待辦、承諾追蹤、逐字稿。",
};

export default function DemoPage() {
  // 回應送出後才記，跟分享頁同一套規矩；recordEvent 自己吞錯誤
  after(() => recordEvent("demo_opened", null, null));
  return <DemoView />;
}
