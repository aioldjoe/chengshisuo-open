"use client";

import { useRef, useState } from "react";

import { TRIAL_MAX_BYTES, trialRejectionText } from "@/lib/trial";

import css from "./home.module.css";

/**
 * 首頁試用上傳區（issue #19）：拖放或選一個錄音檔，跑完直接跳試用記錄頁。
 * 這一塊是整頁承諾最低的入口——先摸到產品，加好友變成留住成果的動作。
 *
 * 送出用一發 fetch 同步等到底（後端 app/api/trial 也是同步處理）：
 * 上傳的人就掛在這裡等，所以 busy 文案要把「要等一兩分鐘」講在前面。
 * 檔案大小在這裡先擋——超過 Vercel 的請求上限的話，白傳一趟才被平台斷掉。
 */

type Phase = { phase: "idle" } | { phase: "busy" } | { phase: "error"; message: string };

export default function TrialUpload() {
  const [phase, setPhase] = useState<Phase>({ phase: "idle" });
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (file: File) => {
    if (file.size > TRIAL_MAX_BYTES) {
      return setPhase({ phase: "error", message: trialRejectionText("too-large") });
    }
    setPhase({ phase: "busy" });
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/trial", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!res.ok || !body?.url) {
        return setPhase({ phase: "error", message: body?.error ?? `伺服器回應 ${res.status}，再試一次。` });
      }
      location.href = body.url;
    } catch {
      setPhase({ phase: "error", message: "傳送中斷了，網路穩一點再試一次。" });
    }
  };

  const pick = (files: FileList | null) => {
    const f = files?.[0];
    if (f) void submit(f);
  };

  if (phase.phase === "busy") {
    return (
      <div className={css.trialCard} aria-live="polite">
        <span className={css.trialSpinner} aria-hidden />
        <span className={css.trialText}>
          <strong>轉寫整理中——大約一兩分鐘</strong>
          <span>別關這個分頁，跑完直接帶你去看記錄頁。</span>
        </span>
      </div>
    );
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        className={`${css.trialCard} ${css.trialCardIdle}${dragging ? ` ${css.trialCardDragging}` : ""}`}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pick(e.dataTransfer.files);
        }}
      >
        <span className={css.trialMark} aria-hidden>
          試
        </span>
        <span className={css.trialText}>
          <strong>傳一段錄音試試——不用加好友</strong>
          {/* 不點名 wav：3 分鐘的 wav 就超過 4MB，寫出來等於承諾一個過不了的格式 */}
          <span>拖到這裡或點一下選檔。5 分鐘內、4MB 內的錄音，跑完直接給你記錄頁。</span>
        </span>
        <input
          ref={inputRef}
          className={css.trialInput}
          type="file"
          accept="audio/*,.m4a,.mp3,.wav"
          onChange={(e) => {
            pick(e.target.files);
            // 同一個檔再選一次也要觸發 change
            e.target.value = "";
          }}
        />
      </div>
      {phase.phase === "error" && <p className={css.trialError}>{phase.message}</p>}
    </div>
  );
}
