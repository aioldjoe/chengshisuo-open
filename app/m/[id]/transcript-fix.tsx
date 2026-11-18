"use client";

import { useMemo, useState } from "react";

import { countHits, display } from "@/lib/transcript";
import type { Correction, Meeting, TranscriptTurn } from "@/lib/types";

import css from "./meeting.module.css";

/**
 * 逐字稿的兩種修正。共同前提：改的都是規則，不是原文——
 * 逐字稿是承諾追蹤的證據層，本人能逐句改字這一層就塌了（GLOSSARY.md、issue #9）。
 *
 * 錯詞替換：只能整詞、全篇一致地換，改的是詞的拼法不是話的內容。
 * 說話人修正：改的是「這段是誰講的」，一個字都不動。
 * 兩者都可刪、刪了就還原，所以刪除不做二次確認——加確認只是摩擦。
 */

/** 選單裡的一位講者：label 是資料裡的標籤，text 是命名後顯示的樣子。 */
export type SpeakerOption = { label: string; text: string };

export function speakerOptions(
  m: Pick<Meeting, "speakerNames">,
  labels: string[],
): SpeakerOption[] {
  return labels.map((label) => ({ label, text: display(m, label) }));
}

/**
 * 錯詞替換面板。命中次數即時算在「現在畫面上的逐字稿」上（已套過先前規則），
 * 使用者看到幾處就是會換到幾處；0 處不給存——存一條換不到東西的規則只是雜訊。
 */
export function CorrectionsPanel({
  turns,
  corrections,
  onAdd,
  onRemove,
}: {
  /** 已套過現有規則的逐字稿。 */
  turns: TranscriptTurn[];
  corrections: Correction[];
  onAdd: (c: Correction) => void;
  onRemove: (index: number) => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const hits = useMemo(() => countHits(turns, from), [turns, from]);
  // 「改成」不准留空：整詞刪掉全篇就不是修拼法而是刪內容了，那是另一件事。
  const ready = from !== "" && to !== "" && from !== to && hits > 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    onAdd({ from, to });
    setFrom("");
    setTo("");
  };

  return (
    <div className={css.fixPanel}>
      <form className={css.fixForm} onSubmit={submit}>
        <input
          className={css.fixInput}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          placeholder="轉錯的詞"
          aria-label="轉錯的詞"
        />
        <span className={css.fixArrow} aria-hidden>
          →
        </span>
        <input
          className={css.fixInput}
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="改成"
          aria-label="改成"
        />
        <button type="submit" className={css.shareBtn} disabled={!ready}>
          全篇替換
        </button>
        {/* 打字時數字要跟著跳，讀螢幕的人也得聽得到——所以是 role="status" 不是純裝飾。 */}
        <p className={css.fixHits} role="status">
          {from === ""
            ? "整詞替換，全篇一致；逐字稿原文不會被改。"
            : hits === 0
              ? "全篇找不到這個詞。"
              : `全篇 ${hits} 處`}
        </p>
      </form>

      {corrections.length > 0 && (
        <ul className={css.fixList}>
          {corrections.map((c, i) => (
            <li key={i} className={css.fixRule}>
              <span className={css.fixRuleText}>
                {c.from}
                <span className={css.fixArrow} aria-hidden>
                  {" → "}
                </span>
                {c.to}
              </span>
              <button
                type="button"
                className={css.fixRemove}
                onClick={() => onRemove(i)}
                aria-label={`刪除「${c.from}」改成「${c.to}」的替換`}
              >
                刪除
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * 一段話的說話人選單。只列既有講者——分離錯人是「認錯人」，
 * 不是「這裡多一個人」。空字串那個選項是「回原本」，由呼叫端放進 options
 * （見 meeting-view 的 options），選它就等於把這段的修正撤掉。
 */
export function SpeakerFixSelect({
  index,
  value,
  options,
  onChange,
}: {
  index: number;
  /** 這段目前顯示的講者標籤（已套過修正）。 */
  value: string | null;
  options: SpeakerOption[];
  onChange: (index: number, label: string) => void;
}) {
  return (
    <select
      className={`${css.select} ${css.turnSpeakerSelect}`}
      value={value ?? ""}
      aria-label={`第 ${index + 1} 段的說話人`}
      onChange={(e) => onChange(index, e.target.value)}
    >
      {options.map((o) => (
        <option key={o.label} value={o.label}>
          {o.text}
        </option>
      ))}
    </select>
  );
}
