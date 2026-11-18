"use client";

import { display } from "@/lib/transcript";
import type { Commitment, Meeting, TodoItem } from "@/lib/types";

import css from "./meeting.module.css";

/**
 * 唯讀版的三種清單：分享頁（app/s/[token]）與示範頁（app/demo）共用。
 * 跟 meeting-view 的可編輯版是兩回事——這裡沒有輸入框、沒有存檔，
 * 拿到頁面的人只能看。
 */

export function StaticList({ items, emptyText, lead }: { items: string[]; emptyText: string; lead?: boolean }) {
  if (items.length === 0) return <p className={css.empty}>{emptyText}</p>;
  return (
    <ul className={css.list}>
      {items.map((item, i) => (
        <li key={i} className={css.row}>
          <span className={css.bullet} aria-hidden />
          <div className={css.rowBody}>
            <p className={`${css.staticText}${lead ? ` ${css.staticTextLead}` : ""}`}>{item}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function StaticTodoList({ todos, m }: { todos: TodoItem[]; m: Pick<Meeting, "speakerNames"> }) {
  if (todos.length === 0) return <p className={css.empty}>沒有待辦事項。</p>;
  return (
    <ul className={css.list}>
      {todos.map((t, i) => (
        <li key={i} className={css.row}>
          <span className={css.bullet} aria-hidden />
          <div className={css.rowBody}>
            <p className={css.staticText}>{t.task}</p>
            <div className={css.staticDetail}>
              <span className={css.detailItem}>
                <span className={css.detailLabel}>誰</span>
                <span>{t.owner ? display(m, t.owner) : "未指定"}</span>
              </span>
              <span className={css.detailItem}>
                <span className={css.detailLabel}>何時</span>
                <span>{t.due ?? "未指定"}</span>
              </span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function StaticCommitmentList({
  commitments,
  m,
}: {
  commitments: Commitment[];
  m: Pick<Meeting, "speakerNames">;
}) {
  if (commitments.length === 0) return <p className={css.empty}>沒有記到承諾。</p>;
  return (
    <ul className={css.list}>
      {commitments.map((c, i) => (
        <li key={i} className={css.row}>
          <span className={css.bulletSeal} aria-hidden />
          <div className={css.rowBody}>
            <p className={css.staticText}>{c.what}</p>
            <div className={css.staticDetail}>
              <span className={css.detailItem}>
                <span className={css.detailLabel}>誰</span>
                <span>{display(m, c.who)}</span>
              </span>
              <span className={css.detailItem}>
                <span className={css.detailLabel}>何時</span>
                <span>{c.due ?? "未指定"}</span>
              </span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
