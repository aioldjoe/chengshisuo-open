"use client";

import css from "./meeting.module.css";

/**
 * 記錄頁的可編輯原件。共同約束：平時看起來就是內文（框線透明），
 * hover 才浮出邊界、focus 才變成明顯的輸入框——「可直接編輯」不該長得像表單。
 * 存檔由上層負責（debounce PATCH），這裡只管值與外觀。
 */

/**
 * 隨內容長高的 textarea。單行內容也用它，避免換行時跳成捲軸。
 * 高度由 CSS 的隱形複製文字撐開（見 meeting.module.css 的 .grow），
 * data-value 就是餵給它的內容——所以這裡不需要 ref 也不需要量。
 */
export function AutoTextarea({
  value,
  onChange,
  placeholder,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div className={`${css.grow}${className ? ` ${className}` : ""}`} data-value={value}>
      <textarea
        className={css.field}
        value={value}
        rows={1}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/**
 * 一列可刪除的內容。刪除鈕平時淡出，滑到該列才明顯。
 * marker="seal" 是承諾專用的方印——承諾是蓋過章的，跟一般條目不同級。
 */
export function Row({
  onRemove,
  removeLabel,
  marker = "dash",
  children,
}: {
  onRemove: () => void;
  removeLabel: string;
  marker?: "dash" | "seal";
  children: React.ReactNode;
}) {
  return (
    <li className={css.row}>
      <span className={marker === "seal" ? css.bulletSeal : css.bullet} aria-hidden />
      <div className={css.rowBody}>{children}</div>
      {/* 手機上 ✕ 只在該列 focus-within 時出現、可點。按下去若讓 textarea 先失焦，
          列會在 click 到達前收起——所以 mousedown 不搶焦點（iOS 的觸控相容事件也走 mousedown）。 */}
      <button
        type="button"
        className={css.remove}
        onClick={onRemove}
        onMouseDown={(e) => e.preventDefault()}
        aria-label={removeLabel}
        title={removeLabel}
      >
        ✕
      </button>
    </li>
  );
}

export function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className={css.add} onClick={onClick}>
      ＋ {label}
    </button>
  );
}

/** 字串陣列的編輯器（重點、決議、議題要點都用它）。 */
export function StringListEditor({
  items,
  onChange,
  placeholder,
  addLabel,
  emptyText,
  itemClassName,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  addLabel: string;
  emptyText: string;
  /** 給重點區加份量用——同一個元件，不同段落的字級可以不一樣。 */
  itemClassName?: string;
}) {
  const replace = (i: number, v: string) => onChange(items.map((x, j) => (j === i ? v : x)));
  const remove = (i: number) => onChange(items.filter((_, j) => j !== i));

  return (
    <>
      {items.length === 0 && <p className={css.empty}>{emptyText}</p>}
      <ul className={css.list}>
        {items.map((item, i) => (
          <Row key={i} onRemove={() => remove(i)} removeLabel="刪除這一條">
            <AutoTextarea
              value={item}
              onChange={(v) => replace(i, v)}
              placeholder={placeholder}
              className={itemClassName}
            />
          </Row>
        ))}
      </ul>
      <AddButton onClick={() => onChange([...items, ""])} label={addLabel} />
    </>
  );
}

/** 待辦／承諾底下那排「負責人・期限」的小欄位。 */
export function DetailInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <span className={css.detailItem}>
      <span className={css.detailLabel}>{label}</span>
      <AutoTextarea
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={css.small}
        ariaLabel={label}
      />
    </span>
  );
}
