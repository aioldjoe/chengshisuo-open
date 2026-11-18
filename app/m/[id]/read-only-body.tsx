"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { fmtDurationZh, parseClock } from "@/lib/format";
import { display, displayTurns, speakerLabels } from "@/lib/transcript";
import type { Meeting, TranscriptTurn } from "@/lib/types";

import css from "./meeting.module.css";
import { Brand, Section, TextScaleControl, TurnRow, useTextScale } from "./meeting-view";
import { BottomBar } from "./bottom-bar";
import { type SeekFn } from "./player";
import { StaticCommitmentList, StaticList, StaticTodoList } from "./static-lists";

/**
 * 唯讀記錄頁的共用骨架（issue #21）：分享頁（app/s/[token]）、示範頁（app/demo）、
 * 試用頁（app/t/[id]）三頁同一副身體，各自只組裝插槽。改唯讀版版面——調區塊
 * 順序、加一區、改 hint 文案——只改這裡，三頁同時生效。
 *
 * 插槽守則：維持 ReactNode 插槽 ≤4、不加 boolean 開關。下一個「想不一樣」的
 * 需求若塞不進現有插槽，先考慮那頁是不是該脫離這副骨架，而不是加參數。
 *
 * 可編輯版（meeting-view.tsx 的本人頁）刻意不共用——編輯器的複雜度不該漏進來。
 */

/** 三頁拿到的會議資料都已去掉私密欄位。 */
export type ReadOnlyMeeting = Omit<Meeting, "userId" | "shareToken">;

export function ReadOnlyMeetingBody({
  meeting: m,
  audioUrl = null,
  badge,
  headerNote,
  transcriptAction,
  joinBlock,
  footerExtra,
  textScale,
}: {
  meeting: ReadOnlyMeeting;
  /** 有值就掛播放器（點段落即播＋逐字稿跟播）；示範頁永遠 null。 */
  audioUrl?: string | null;
  /** header 的定位句——這頁是什麼、規則是什麼，一頁一句。 */
  badge: string;
  /** badge 下方的補充（如錄音已刪的說明）；沒有就不佔位。 */
  headerNote?: React.ReactNode;
  /** 逐字稿標題列右側的動作（如 SRT 下載）。收函式不收節點：錯詞替換後的
      turns 由骨架算一次交回來，SRT 跟畫面才是同一份，不會各算各的走鐘。 */
  transcriptAction?: (shown: TranscriptTurn[]) => React.ReactNode;
  /** 頁尾落款前的 CTA 區——每頁想要人做的那件事，文案與結構各頁自理。 */
  joinBlock: React.ReactNode;
  /** 落款下方的附加區（如分享頁的匯出區）。 */
  footerExtra?: React.ReactNode;
  /** 由各頁自己呼叫 useTextScale() 傳進來——hook 要在載入態就跑起來，
      存過的字級才會套在 Skeleton 上，不會等資料到了才跳一下。 */
  textScale: ReturnType<typeof useTextScale>;
}) {
  const s = m.summary;
  const labels = speakerLabels(m);
  const meta = [
    m.createdAt.slice(0, 10),
    fmtDurationZh(m.durationLabel),
    labels.length > 0 ? `${labels.length} 位說話人` : null,
  ].filter((x): x is string => typeof x === "string");

  const anchors = [
    { id: "highlights", label: "重點", count: s.highlights.length },
    { id: "decisions", label: "決議", count: s.decisions.length },
    { id: "todos", label: "待辦", count: s.todos.length },
    { id: "commitments", label: "承諾", count: s.commitments.length },
    ...(s.sections.length >= 2 ? [{ id: "topics", label: "議題", count: s.sections.length }] : []),
    { id: "transcript", label: "逐字稿", count: null },
  ];

  const [activeTurn, setActiveTurn] = useState(-1);
  const seekRef = useRef<SeekFn | null>(null);
  const jump = useCallback((sec: number) => seekRef.current?.(sec), []);
  const starts = useMemo(() => m.turns.map((t) => t.start), [m.turns]);
  // 錯詞替換與說話人修正在本人那頁改，這裡只是照著規則顯示（issue #9）
  const shown = useMemo(() => displayTurns(m), [m.turns, m.corrections, m.speakerFixes]);

  return (
    <main className={`${css.page}${audioUrl ? ` ${css.hasPlayer}` : ""}`}>
      <header>
        <div className={css.headerTop}>
          <Brand quiet />
          <TextScaleControl
            step={textScale.step}
            max={textScale.max}
            onSmaller={textScale.smaller}
            onBigger={textScale.bigger}
          />
        </div>
        <h1 className={css.shareTitle}>{s.title || "未命名會議"}</h1>
        <p className={css.meta}>
          {meta.map((x, i) => (
            <span key={i}>
              {i > 0 && (
                <span className={css.metaDot} aria-hidden>
                  {" / "}
                </span>
              )}
              {x}
            </span>
          ))}
        </p>
        <span className={css.shareBadge}>{badge}</span>
        {headerNote}
      </header>

      {labels.length > 0 && (
        <Section title="說話人">
          <div className={css.speakers}>
            {labels.map((label) => (
              <div key={label} className={css.speakerRow}>
                <span className={css.speakerLabel}>{label}</span>
                <span className={css.speakerStatic}>{m.speakerNames[label] || "未命名"}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section id="highlights" title="重點">
        <StaticList items={s.highlights} emptyText="還沒有重點。" lead />
      </Section>

      <Section id="decisions" title="決議">
        <StaticList items={s.decisions} emptyText="沒有記到決議。" />
      </Section>

      <Section id="todos" title="待辦">
        <StaticTodoList todos={s.todos} m={m} />
      </Section>

      <Section id="commitments" title="承諾追蹤" hint="會中親口答應的事">
        <StaticCommitmentList commitments={s.commitments} m={m} />
      </Section>

      {s.sections.length >= 2 && (
        <Section id="topics" title="議題分段">
          {s.sections.map((sec, i) => (
            <div key={i} className={css.subsection}>
              <p className={css.subsectionTitleStatic}>{sec.title || `議題 ${i + 1}`}</p>
              <StaticList items={sec.points} emptyText="這段還沒有內容。" />
            </div>
          ))}
        </Section>
      )}

      <Section
        id="transcript"
        title="逐字稿"
        printBreak
        hint={audioUrl ? "點段落即播" : undefined}
        action={transcriptAction?.(shown)}
      >
        {shown.map((t, i) => {
          const changed = i === 0 || t.speaker !== shown[i - 1].speaker;
          return (
            <TurnRow
              key={i}
              index={i}
              start={t.start}
              text={t.text}
              speaker={changed ? display(m, t.speaker) : null}
              spaced={changed && i > 0}
              active={i === activeTurn}
              onSeek={audioUrl ? jump : null}
            />
          );
        })}
      </Section>

      {joinBlock}

      <footer className={css.footer}>
        <div className={css.signoff}>
          <span className={css.signoffText}>
            <span className={css.seal} aria-hidden>
              成
            </span>
            成事所　想把 AI 導入你的公司？
          </span>
          <a className={css.cta} href="mailto:hello@chengshisuo.com">
            找我們聊聊
          </a>
        </div>
        {footerExtra}
      </footer>

      <BottomBar
        anchors={anchors}
        player={
          audioUrl
            ? {
                src: audioUrl,
                starts,
                durationHint: parseClock(m.durationLabel),
                seekRef,
                onActiveTurn: setActiveTurn,
              }
            : null
        }
      />
    </main>
  );
}
