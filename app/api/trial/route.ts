import crypto from "node:crypto";

import { audioDurationSeconds } from "@/lib/audio/duration";
import { signedExportQuery } from "@/lib/export-url";
import { summarizeTurns } from "@/lib/pipeline";
import { recordEvent } from "@/lib/store/events";
import { getRepo } from "@/lib/store/meetings";
import { deleteObject, hasR2, putObject } from "@/lib/store/r2";
import { transcribe } from "@/lib/stt/scribe";
import {
  TRIAL_PAGE_TTL_MS,
  transcribedTooLong,
  trialRejectionText,
  trialUserId,
  trialVerdict,
  type TrialRejection,
} from "@/lib/trial";
import { clientIp, ipHash, safeExt } from "@/lib/trial-server";
import type { Meeting } from "@/lib/types";

/**
 * 首頁試用上傳（issue #19）：收音檔 → 跑既有 pipeline 的階段
 * （轉寫 → summarizeTurns 的校正＋抽取）→ 落庫成 trial:<ipHash> 名下的會議 → 回簽章網址。
 *
 * 同步處理、不走 after()：上傳的人就掛在頁面上等，回應本身就是完成通知
 * ——不像 LINE 那條有 push 可用。5 分鐘上限的轉寫在一分鐘內收尾，撐得住。
 *
 * 已知的洞（先記帳不先修）：IP 額度是「落庫後才算用過」，同 IP 併發搶打
 * 可以同時過閘；單場被 4MB／5 分鐘鎖死，最壞成本是幾場小額轉寫費，
 * 不值得為它加分散式鎖。失敗的場次不落庫、也就不燒名額——重試是應該的。
 */

export const runtime = "nodejs";
export const maxDuration = 300;

const REJECTION_STATUS: Record<TrialRejection, number> = {
  "ip-limit": 429,
  "too-large": 413,
  "unknown-duration": 415,
  "too-long": 422,
};

export async function POST(req: Request) {
  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    // 不是 multipart——照缺檔處理
  }
  if (!file) return Response.json({ error: "沒收到檔案。挑一個錄音檔再試一次。" }, { status: 400 });

  const tuid = trialUserId(ipHash(clientIp(req)));
  const now = Date.now();
  // 「同 IP 一天一場」：試用場次的 userId 就是 trial:<ipHash>，
  // 直接問儲存層過去 24 小時有沒有這個人的場次，不加欄位也不掃全表
  const usedToday = (await getRepo().listSince(tuid, new Date(now - TRIAL_PAGE_TTL_MS))).length > 0;

  const data = Buffer.from(await file.arrayBuffer());
  const verdict = trialVerdict({
    bytes: data.length,
    durationSeconds: audioDurationSeconds(data),
    usedToday,
  });
  if (!verdict.ok) {
    return Response.json(
      { error: trialRejectionText(verdict.reason) },
      { status: REJECTION_STATUS[verdict.reason] },
    );
  }

  const id = crypto.randomUUID();
  let audioKey: string | null = null;
  try {
    const contentType = file.type || "application/octet-stream";
    if (hasR2()) {
      audioKey = `audio/${id}/trial${safeExt(file.name)}`;
      await putObject(audioKey, data, contentType);
    }

    const { turns, language, durationLabel, durationSeconds } = await transcribe(
      data,
      file.name || "trial.m4a",
      contentType,
    );
    // 真時長複驗：檔頭那關擋不住偽造（見 transcribedTooLong 檔頭）。
    // 擋在 LLM 兩段之前——轉寫費已花，校正與抽取的錢還省得下來
    if (transcribedTooLong(durationSeconds)) {
      if (audioKey) await deleteObject(audioKey).catch(() => {});
      return Response.json(
        { error: trialRejectionText("too-long") },
        { status: REJECTION_STATUS["too-long"] },
      );
    }
    const { turns: correctedTurns, summary } = await summarizeTurns(turns);

    const meeting: Meeting = {
      id,
      userId: tuid,
      createdAt: new Date(now).toISOString(),
      filename: file.name || "試用錄音",
      language,
      durationLabel,
      durationSeconds: durationSeconds ?? audioDurationSeconds(data),
      turns: correctedTurns,
      summary,
      speakerNames: {},
      audioKey,
      // 試用頁 24 小時後由每日 cron 整筆刪（含音檔）；認領後改按方案的保留規則
      expiresAt: new Date(now + TRIAL_PAGE_TTL_MS).toISOString(),
      shareToken: null,
    };
    await getRepo().save(meeting);
    // 無主事件：試用還沒有身分，userHash 留 null，靠場次 id 對回認領那筆
    await recordEvent("trial_completed", null, id);

    return Response.json({
      url: `/t/${id}?${signedExportQuery(id, "trial", now, TRIAL_PAGE_TTL_MS)}`,
    });
  } catch (e) {
    console.error("[trial] 處理失敗", { filename: file.name }, e);
    // 音檔已上 R2 但會議沒落庫的話，cleanup（掃會議表）永遠找不到它——當場收走
    if (audioKey) await deleteObject(audioKey).catch(() => {});
    return Response.json(
      { error: "處理到一半失敗了，這場不算你的試用名額——再傳一次看看。" },
      { status: 500 },
    );
  }
}
