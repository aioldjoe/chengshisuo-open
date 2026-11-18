"use client";

import { useEffect, useRef, useState } from "react";

import { PlayerRow, type SeekFn } from "./player";

import css from "./meeting.module.css";

/**
 * 貼底列：跳區導覽列常駐，音檔還在時上面再疊一層播放列。
 *
 * 播放列裡沒有任何可拖的東西：進度是貼在這條列上緣的一條線（顯示，不是控制），
 * 跳播交給逐字稿與 ±10 秒鍵。這是刻意的——貼底是 iOS 系統手勢帶（home indicator、
 * 切 app）與 LIFF「下滑關閉」的地盤，可拖元素放在這裡遲早被滑走。橫捲的導覽列
 * 是唯一的例外，它用 touch-action: pan-x 把垂直分量吃掉。
 *
 * 跳區列放這裡不放頁首，順便讓它進拇指熱區：逐字稿幾百行，
 * 「跳去待辦」在手機上是高頻動作。
 *
 * 「目前在哪一區」的狀態留在這個元件裡：捲動時一直在變，
 * 放到頁面元件會讓整份逐字稿跟著重畫。
 */

export type JumpAnchor = { id: string; label: string; count: number | null };

export type PlayerProps = {
  src: string;
  starts: number[];
  durationHint: number | null;
  seekRef: React.MutableRefObject<SeekFn | null>;
  onActiveTurn: (index: number) => void;
};

export function BottomBar({
  anchors,
  player,
}: {
  anchors: JumpAnchor[];
  /** 音檔 72 小時後銷毀，那之後只剩導覽列那層。 */
  player: PlayerProps | null;
}) {
  const ids = anchors.map((a) => a.id);
  const activeId = useActiveSection(ids);
  const nav = useOverflowRight<HTMLElement>(ids.join(","));

  return (
    <div className={css.bottomBar}>
      {player && <PlayerRow {...player} />}
      <nav
        ref={nav.ref}
        className={`${css.bottomNav}${nav.more ? ` ${css.bottomNavMore}` : ""}`}
        aria-label="快速跳區"
      >
        {anchors.map((a) => (
          <a
            key={a.id}
            className={`${css.jump}${a.id === activeId ? ` ${css.jumpActive}` : ""}`}
            href={`#${a.id}`}
            aria-current={a.id === activeId ? "location" : undefined}
          >
            {a.label}
            {a.count !== null && <span className={css.jumpCount}>{a.count}</span>}
          </a>
        ))}
      </nav>
    </div>
  );
}

/**
 * 跳區列的「目前區」：取畫面上半部最靠上的那一區。
 * 用 IntersectionObserver 不用 scroll 事件——長逐字稿一邊滑一邊算 offsetTop 會掉幀。
 */
function useActiveSection(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  // ids 每次 render 都是新陣列，用字串當依賴才不會每次都重掛 observer
  const key = ids.join(",");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const els = key
      .split(",")
      .map((id) => document.getElementById(id))
      .filter((x): x is HTMLElement => !!x);
    if (els.length === 0) return;
    const visible = new Set<string>();
    const pick = () => {
      const first = els.find((el) => visible.has(el.id));
      setActive(first ? first.id : null);
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        pick();
      },
      // 只看視窗上 40%：讀者眼睛在哪一區，就亮哪一顆
      { rootMargin: "0px 0px -60% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [key]);
  return active;
}

/**
 * 橫滑列右邊是否還有東西——有才掛漸隱遮罩，滑到底或裝得下就拿掉。
 * key 換了（跳區增減）要重掛。
 */
function useOverflowRight<T extends HTMLElement>(key: string) {
  const ref = useRef<T | null>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    check();
    el.addEventListener("scroll", check, { passive: true });
    // 字體換好、字級鈕調大都會撐寬內容，但列本身的寬沒變——只看列會漏掉，孩子也要看。
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(check) : null;
    ro?.observe(el);
    for (const child of Array.from(el.children)) ro?.observe(child);
    void document.fonts?.ready.then(check).catch(() => {});
    return () => {
      el.removeEventListener("scroll", check);
      ro?.disconnect();
    };
  }, [key]);
  return { ref, more };
}
