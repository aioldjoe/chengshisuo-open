/**
 * 本機開發用：塞一場示範會議進 repo，讓記錄頁不用真的丟錄音就打得開。
 * 內容是合成的（重度中英夾雜、四位講者），不是任何真實會議。
 *
 *   pnpm seed          # 建一場，印出網址
 *
 * userId 取 DEV_LINE_USER_ID——要跟 lib/auth.ts 的本機直通身分一致，
 * 否則 GET /api/m/[id] 會判定不是本人而回 404。
 */

import { randomUUID } from "node:crypto";

import { loadEnvLocal } from "./env";
import type { Meeting } from "../lib/types";

loadEnvLocal();

const DEMO_TURNS: Array<[string, number, string]> = [
  ["講者 A", 0, "那我們今天先過一下 Q3 的 roadmap，主要是三塊：一個是 onboarding 的改版，一個是報表，最後是計價。"],
  ["講者 B", 14, "onboarding 我這邊上週跑了五個 user testing，最卡的還是第二步，drop off 大概四成。"],
  ["講者 A", 27, "四成？那比上一版還糟。原因抓得出來嗎？"],
  ["講者 B", 33, "抓得出來，他們不知道要填什麼。那個欄位寫「組織代碼」，可是使用者根本沒有這個概念，要去問他們公司的 IT。"],
  ["講者 C", 48, "這個我可以改，把它變 optional，後面再補就好。engineering 上大概兩天。"],
  ["講者 A", 56, "好，那就這樣定案——組織代碼改成選填。Ken 你這週處理掉。"],
  ["講者 C", 63, "沒問題，我這週五前上 staging。"],
  ["講者 D", 70, "報表這塊我要提醒一下，客戶那邊一直在問 export 成 Excel，不是 PDF。這個 request 從三月問到現在。"],
  ["講者 A", 84, "三月？那我們是不是漏了什麼。為什麼一直沒排？"],
  ["講者 D", 90, "因為每次 sprint planning 都被 priority 更高的事情擠掉，它一直在 backlog 的中段。"],
  ["講者 B", 99, "我覺得可以放 Q3，這個不難，而且是 retention 的問題——他們不能 export 就會自己另外做一份 Excel，久了就不用我們的了。"],
  ["講者 A", 114, "同意。D 你把它寫成 ticket，下個 sprint 進去。"],
  ["講者 D", 121, "好，我今天下班前開好 ticket。"],
  ["講者 A", 126, "最後計價。我們現在是 per seat，但大客戶一直嫌貴，因為他們有很多 read-only 的人。"],
  ["講者 C", 138, "業界比較常見的是分 tier，editor 收費、viewer 免費或很便宜。"],
  ["講者 A", 147, "這個影響營收模型，我不想今天決定。B 你幫我拉一份現有客戶的 seat 分布，看 read-only 佔多少，下週我們再談。"],
  ["講者 B", 160, "了解，我下週一給你數字。"],
  ["講者 A", 165, "那今天就到這裡，謝謝大家。"],
];

function demoMeeting(userId: string): Meeting {
  const now = new Date();
  return {
    id: randomUUID(),
    userId,
    createdAt: now.toISOString(),
    filename: "示範會議.m4a",
    language: "zh",
    // 與轉寫產出的格式一致（mm:ss），顯示時才會被 fmtDurationZh 讀成中文時長
    durationLabel: "02:52",
    durationSeconds: 172,
    turns: DEMO_TURNS.map(([speaker, start, text]) => ({ speaker, start, text })),
    summary: {
      title: "Q3 產品 roadmap 討論",
      highlights: [
        "onboarding 第二步的「組織代碼」欄位造成四成使用者流失，決定改為選填。",
        "Excel export 的客戶需求從三月積壓至今，因排序被擠壓；判定為 retention 問題，排進下個 sprint。",
        "per seat 計價對大客戶偏貴（read-only 人數多），是否改 tier 制待數據支撐，下週再議。",
      ],
      decisions: [
        "onboarding 的「組織代碼」欄位改為選填，本週上 staging。",
        "Excel export 排進下個 sprint。",
        "計價模型今天不拍板，先看現有客戶的 seat 分布。",
      ],
      todos: [
        { task: "把組織代碼改成選填並上 staging", owner: "講者 C", due: "本週五前" },
        { task: "開 Excel export 的 ticket 進下個 sprint", owner: "講者 D", due: "今天下班前" },
        { task: "拉現有客戶的 seat 分布（read-only 佔比）", owner: "講者 B", due: "下週一" },
      ],
      commitments: [
        { who: "講者 C", what: "組織代碼改選填，週五前上 staging", due: "本週五" },
        { who: "講者 D", what: "今天下班前開好 Excel export 的 ticket", due: "今天" },
        { who: "講者 B", what: "給出現有客戶的 seat 分布數字", due: "下週一" },
      ],
      sections: [
        {
          title: "onboarding 改版",
          points: [
            "五位使用者測試，第二步 drop off 約四成，比上一版更糟。",
            "根因是「組織代碼」對使用者無意義，得回頭問公司 IT。",
            "工程評估改為選填約需兩天。",
          ],
          decisions: ["組織代碼改為選填"],
          todos: [{ task: "改選填並上 staging", owner: "講者 C", due: "本週五前" }],
        },
        {
          title: "報表 Excel export",
          points: [
            "客戶要的是 Excel 不是 PDF，需求從三月提出。",
            "一直被更高優先序的項目擠出 sprint。",
            "不能 export 會讓客戶自建 Excel，最終流失。",
          ],
          decisions: ["排進下個 sprint"],
          todos: [{ task: "開 ticket", owner: "講者 D", due: "今天下班前" }],
        },
        {
          title: "計價模型",
          points: [
            "現行 per seat 對 read-only 人數多的大客戶偏貴。",
            "業界常見做法是 editor 收費、viewer 免費或低價。",
            "影響營收模型，需先有 seat 分布數據才決定。",
          ],
          decisions: [],
          todos: [{ task: "拉 seat 分布", owner: "講者 B", due: "下週一" }],
        },
      ],
    },
    // 說話人命名留空——這正是要在記錄頁上測的動作。
    speakerNames: {},
    // 沒有真的音檔，記錄頁會顯示「已銷毀」那行文案。
    audioKey: null,
    expiresAt: new Date(now.getTime() + 30 * 24 * 3600_000).toISOString(),
    shareToken: null,
  };
}

async function main(): Promise<void> {
  const userId = process.env.DEV_LINE_USER_ID;
  if (!userId) {
    console.error("缺 DEV_LINE_USER_ID——在 .env.local 加一行（本機直通身分，正式環境無效）：");
    console.error("  DEV_LINE_USER_ID=U-dev-local");
    process.exit(1);
  }

  const { getRepo } = await import("../lib/store/meetings");
  const { recordEvent } = await import("../lib/store/events");
  const m = demoMeeting(userId);
  await getRepo().save(m);
  // 跟真 pipeline 走同一條量測路徑（含場次 id），pnpm metrics 才看得到本機這場
  await recordEvent("meeting_created", userId, m.id);

  const where = process.env.TURSO_DATABASE_URL ? "Turso" : "檔案系統";
  const base = process.env.APP_BASE_URL || "http://localhost:3000";
  console.log(`已建立示範會議（${where}，userId=${userId}）`);
  console.log(`  ${base}/m/${m.id}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
