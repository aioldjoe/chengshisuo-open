/**
 * VC 驗證鏈第一關的三個數字：每月活躍用戶數、人均場次、次月回訪率，
 * 外加病毒迴路：分享頁被打開幾次（issue #7）、有幾個讀者去點加好友（issue #8）。
 *
 *   pnpm metrics              # 印出逐月數字
 *   pnpm metrics --backfill   # 一次性：把既有會議補成 meeting_created 事件
 *
 * 資料來源是事件表（lib/store/events.ts），不是會議表——會議會被真刪，事件不會，
 * 所以歷史只有從事件表算才問得出「這個人在幾月丟過幾場」。
 * --backfill 只在事件表還沒有任何 meeting_created 時能跑（避免重複計數）。
 */

import type { UsageEvent } from "../lib/types";
import { loadEnvLocal } from "./env";

loadEnvLocal();

const pct = (r: number): string => `${Math.round(r * 100)}%`;

async function backfill(): Promise<void> {
  const { getEventsRepo, userHash } = await import("../lib/store/events");
  const { getRepo } = await import("../lib/store/meetings");

  const existing = (await getEventsRepo().list()).filter((e) => e.type === "meeting_created");
  if (existing.length > 0) {
    console.error(`事件表已經有 ${existing.length} 筆 meeting_created，不補了——再補會重複計數。`);
    process.exit(1);
  }

  const meetings = await getRepo().list();
  for (const m of meetings) {
    await getEventsRepo().record({
      userHash: userHash(m.userId),
      type: "meeting_created",
      subject: m.id,
      at: m.createdAt,
    });
  }
  console.log(`已從 ${meetings.length} 場既有會議補出事件。\n`);
}

async function main(): Promise<void> {
  if (process.argv.includes("--backfill")) await backfill();

  const { getEventsRepo } = await import("../lib/store/events");
  const { monthlyUsage } = await import("../lib/metrics");

  const source = process.env.TURSO_DATABASE_URL
    ? "Turso"
    : `檔案系統（${process.env.EVENTS_FILE || ".data/events.jsonl"}）`;
  const events = await getEventsRepo().list();
  const rows = monthlyUsage(events);

  console.log(`成事所量測 · 資料來源：${source}\n`);
  if (rows.length === 0) {
    console.log("還沒有任何 meeting_created 事件。");
    console.log("  已經有會議但事件表是空的（事件表是後補的）→ pnpm metrics --backfill");
    console.log("  本機想看管線通不通 → pnpm seed");
    console.log();
    await printShareOpens(events);
    await printJoinClicks(events);
    await printDemo(events);
    return;
  }

  // 欄寬對齊全形標題（CJK 佔兩格）——這張表是人在看的，歪掉就讀不出趨勢
  console.log("月份     活躍用戶   場次 人均場次   次月回訪率");
  for (const r of rows) {
    const retention =
      r.retentionRate === null
        ? r.activeUsers === 0
          ? "—"
          : "—（下個月還沒到）"
        : `${pct(r.retentionRate)}（${r.activeUsers} 人中 ${r.retainedNextMonth} 人）`;
    console.log(
      [
        r.month.padEnd(9),
        String(r.activeUsers).padStart(6),
        String(r.meetings).padStart(7),
        r.meetingsPerUser.toFixed(1).padStart(9),
        `   ${retention}`,
      ].join(""),
    );
  }

  console.log();
  await printShareOpens(events);
  await printJoinClicks(events);
  await printDemo(events);
  await printTrial(events);
}

/**
 * 分享頁開啟數。分子只有一種事件（share_opened）——本人在 app/m/[id] 開自己的
 * 記錄頁不記事件，混不進來。標題是順手查的：會議可能已經真刪，那就只剩 id。
 */
async function printShareOpens(events: UsageEvent[]): Promise<void> {
  const { shareOpens } = await import("../lib/metrics");
  const { getRepo } = await import("../lib/store/meetings");

  const stats = shareOpens(events);
  console.log(`分享頁開啟 · 全站 ${stats.total} 次`);
  if (stats.byMeeting.length === 0) {
    if (stats.total === 0) console.log("  還沒有人打開過分享連結。");
    return;
  }

  const titles = new Map((await getRepo().list()).map((m) => [m.id, m.summary.title]));
  console.log("  次數  會議");
  for (const row of stats.byMeeting) {
    const title = titles.get(row.meetingId) ?? `${row.meetingId.slice(0, 8)}…（已刪除）`;
    console.log(`${String(row.opens).padStart(6)}  ${title}`);
  }
}

/**
 * 加好友 CTA 的點擊（issue #8）。ref=share 是分享頁那顆；轉化率的分母是分享頁開啟數，
 * 兩個數字並排才看得出迴路有沒有轉起來。
 * 注意這是點擊不是實際加好友——後者只有 LINE OA 後台的「加入好友管道」數得到。
 */
async function printJoinClicks(events: UsageEvent[]): Promise<void> {
  const { joinClicks, shareConversion } = await import("../lib/metrics");

  const stats = joinClicks(events);
  console.log();
  console.log(`加好友 CTA 點擊 · 全站 ${stats.total} 次`);
  if (stats.byRef.length === 0) {
    console.log("  還沒有人點過加好友 CTA。");
    return;
  }

  console.log("  次數  來源");
  for (const row of stats.byRef) {
    console.log(`${String(row.clicks).padStart(6)}  ${row.ref ?? "未標記"}`);
  }

  const conv = shareConversion(events);
  console.log(
    conv.rate === null
      ? "  分享頁還沒被打開過，轉化率算不出來。"
      : `  分享頁開啟 ${conv.opens} 次 → 點 CTA ${conv.clicks} 次，轉化 ${pct(conv.rate)}`,
  );
}

/**
 * 首頁示範記錄頁（issue #14）。跟分享頁分開印——示範頁量的是首頁的說服力，
 * 分享頁量的是轉傳，兩個數字混在一起哪個都讀不準。
 */
async function printDemo(events: UsageEvent[]): Promise<void> {
  const { demoConversion } = await import("../lib/metrics");

  const conv = demoConversion(events);
  console.log();
  console.log(`示範記錄頁開啟 · 全站 ${conv.opens} 次`);
  console.log(
    conv.rate === null
      ? "  還沒有人打開過示範頁。"
      : `  開啟 ${conv.opens} 次 → 點加好友 CTA ${conv.clicks} 次，轉化 ${pct(conv.rate)}`,
  );
}

/**
 * 首頁試用漏斗（issue #19）。試用完成 → 認領進 LINE 身分——
 * 這張票有沒有用只看這兩個數字（rate 低是 CTA 的病，completed 少是上傳區的病）。
 */
async function printTrial(events: UsageEvent[]): Promise<void> {
  const { trialFunnel } = await import("../lib/metrics");

  const funnel = trialFunnel(events);
  console.log();
  console.log(`首頁試用 · 完成 ${funnel.completed} 場`);
  console.log(
    funnel.rate === null
      ? "  還沒有人試用過。"
      : `  完成 ${funnel.completed} 場 → 認領進 LINE ${funnel.claimed} 場，轉化 ${pct(funnel.rate)}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
