"use client";

import { useEffect } from "react";

import css from "./theme-toggle.module.css";

/**
 * 深淺色切換鈕。預設跟隨系統；按下後把選擇寫進 html[data-theme] 與 localStorage
 * （開機腳本在 layout.tsx 讀回來）。若按回「跟系統一樣」的那一側，就清掉覆寫、
 * 回到跟隨系統——多數人繞一圈會回到 auto，不會永遠卡在手動。
 *
 * 圖示顯示「按了會變成的主題」（亮色時給月亮），兩顆 SVG 都渲染、由 CSS 依
 * 當前主題挑一顆亮——避免 server/client 對主題認知不同造成 hydration 閃爍。
 */

const BAR = { light: "#F8F6F4", dark: "#211c1a" } as const;

/** 依當前覆寫狀態同步 theme-color meta；沒覆寫就照各自的 media 還原系統色。 */
function syncThemeColorMeta() {
  const t = document.documentElement.dataset.theme;
  const forced = t === "dark" ? BAR.dark : t === "light" ? BAR.light : null;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    const systemSide = (m.getAttribute("media") || "").includes("dark") ? BAR.dark : BAR.light;
    m.setAttribute("content", forced ?? systemSide);
  });
}

/**
 * layout.tsx 的開機腳本改完 meta 後，Next 在 hydration 時會重渲染 viewport meta、
 * 蓋回系統色——掛在 layout 的這個空元件在 hydration 後再同步一次，把覆寫色搶回來。
 */
export function ThemeMetaSync() {
  useEffect(syncThemeColorMeta, []);
  return null;
}

function toggleTheme() {
  const root = document.documentElement;
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const currentDark = root.dataset.theme ? root.dataset.theme === "dark" : systemDark;
  const next = currentDark ? "light" : "dark";

  try {
    if ((next === "dark") === systemDark) {
      delete root.dataset.theme;
      localStorage.removeItem("theme");
    } else {
      root.dataset.theme = next;
      localStorage.setItem("theme", next);
    }
  } catch {
    root.dataset.theme = next;
  }

  syncThemeColorMeta();
}

export function ThemeToggle() {
  return (
    <button type="button" className={css.toggle} aria-label="切換深淺色" onClick={toggleTheme}>
      <svg className={css.toDark} viewBox="0 0 16 16" width="14" height="14" aria-hidden>
        <path
          d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
      <svg className={css.toLight} viewBox="0 0 16 16" width="14" height="14" aria-hidden>
        <circle cx="8" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
          <path d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M12.8 3.2l-1.1 1.1M4.3 11.7l-1.1 1.1" />
        </g>
      </svg>
    </button>
  );
}
