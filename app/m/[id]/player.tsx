"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fmtTime } from "@/lib/format";
import { activeTurnIndex, nextRate, parseRate, progressPercent, rateLabel, skipTarget } from "@/lib/player";

import css from "./meeting.module.css";

/**
 * 播放列。原生 <audio> 藏起來只當引擎，控制項全手寫——
 * iOS 給的灰色藥丸（AirPlay、⋯）是整頁唯一不是我們設計的東西，與克制的方向不搭。
 *
 * 時間狀態刻意留在這個元件裡：timeupdate 一秒好幾發，
 * 放到 MeetingBody 會讓整份逐字稿跟著重畫。外面只收「換段了」這一件事。
 *
 * 位置歸 BottomBar 管，這裡不碰——進度條底下一定要墊著跳區列才安全（見 bottom-bar.tsx）。
 */

export type SeekFn = (sec: number) => void;

const RATE_KEY = "chengshisuo:playRate";

/** LIFF 內建瀏覽器的隱私模式可能讓 localStorage 丟例外——記不住速度是小事，播不了是大事。 */
function readRate(): number {
  try {
    return parseRate(localStorage.getItem(RATE_KEY));
  } catch {
    return 1;
  }
}

function writeRate(rate: number): void {
  try {
    localStorage.setItem(RATE_KEY, String(rate));
  } catch {
    /* 記不住就算了 */
  }
}

export function PlayerRow({
  src,
  starts,
  durationHint,
  seekRef,
  onActiveTurn,
}: {
  src: string;
  /** 每段逐字稿的起始秒，遞增。 */
  starts: number[];
  /** 音檔 metadata 還沒下載完時先頂著的總長（來自 durationLabel）。 */
  durationHint: number | null;
  /** 逐字稿的時間戳要跳播，透過這個 ref 拿到 seek——用 ref 才不會每次 render 都換 handler。 */
  seekRef: React.MutableRefObject<SeekFn | null>;
  onActiveTurn: (index: number) => void;
}) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(durationHint ?? 0);
  const [rate, setRate] = useState(1);
  /** metadata 還沒到就設 currentTime 會被吞掉，先記著等 loadedmetadata 再補跳。 */
  const pendingSeek = useRef<number | null>(null);

  // starts 在編輯時會換新陣列，但 seek 不該因此重建——用 ref 讀最新值。
  const startsRef = useRef(starts);
  startsRef.current = starts;

  const moveTo = useCallback(
    (t: number) => {
      setTime(t);
      onActiveTurn(activeTurnIndex(startsRef.current, t));
    },
    [onActiveTurn],
  );

  const seek = useCallback(
    (sec: number, andPlay = false) => {
      const a = audio.current;
      if (!a) return;
      if (a.readyState === 0) pendingSeek.current = sec;
      else a.currentTime = sec;
      moveTo(sec);
      // play() 在使用者手勢裡呼叫才會過；被擋下就維持暫停，不彈錯誤。
      if (andPlay) void a.play().catch(() => {});
    },
    [moveTo],
  );

  /** ±10 秒。拉 bar 在手機上太細，跳秒才是聽會議的主力操作；播放狀態不動（播著就繼續播）。 */
  const skip = (delta: number) => {
    const a = audio.current;
    if (!a) return;
    seek(skipTarget(a.currentTime, delta, a.duration));
  };

  useEffect(() => {
    seekRef.current = (sec) => seek(sec, true);
    return () => {
      seekRef.current = null;
    };
  }, [seek, seekRef]);

  // 速度偏好跨會議沿用：同一個人聽第二場不該再點一次。
  // 讀在 effect 裡不在 render 裡——SSR 沒有 localStorage，寫進 render 會 hydration 不一致。
  useEffect(() => {
    setRate(readRate());
  }, []);

  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    a.playbackRate = rate;
    // 2× 不能變花栗鼠。Safari 到現在還只認前綴那顆，兩個都設。
    a.preservesPitch = true;
    (a as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
  }, [rate]);

  const cycleRate = () => {
    const r = nextRate(rate);
    setRate(r);
    writeRate(r);
  };

  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => {});
    else a.pause();
  };

  const readDuration = (a: HTMLAudioElement) => {
    if (Number.isFinite(a.duration) && a.duration > 0) setDuration(a.duration);
  };

  // 讀不到時長（串流中的 m4a，duration 是 0／NaN）就停在 0%——線不會亂跳，
  // 也不會出現「拖了沒反應」的死控制項（那是還有 scrubber 時才要處理的事）。
  const pct = progressPercent(time, duration);

  return (
    <div className={css.playerRow}>
      {/* 進度是「顯示」不是「控制」：貼在整條貼底列的上緣，橫向不佔位。
          aria-hidden——讀屏要的位置在時間文字裡，這裡只是一條線。 */}
      <div className={css.progress} aria-hidden>
        <span className={css.progressFill} style={{ width: `${pct}%` }} />
      </div>

      {/* 三顆一組貼在一起：這是「操作播放」這件事，不是三個獨立按鈕 */}
      <div className={css.transport}>
        <button
          type="button"
          className={css.skipBtn}
          onClick={() => skip(-10)}
          aria-label="倒退 10 秒"
        >
          −10秒
        </button>

        <button
          type="button"
          className={css.playBtn}
          onClick={toggle}
          aria-label={playing ? "暫停" : "播放"}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>

        <button
          type="button"
          className={css.skipBtn}
          onClick={() => skip(10)}
          aria-label="快轉 10 秒"
        >
          +10秒
        </button>
      </div>

      {/* 速度是點按不是拖曳，放貼底列安全（見 bottom-bar.tsx）。
          三段循環，不做選單——選項多到要選單，就不該放在這條列上。 */}
      <button
        type="button"
        className={css.rateBtn}
        onClick={cycleRate}
        aria-label={`播放速度 ${rate} 倍，點一下換速`}
      >
        {rateLabel(rate)}
      </button>

      <span className={css.dockTime}>
        {fmtTime(time)}
        <span aria-hidden>/</span>
        {fmtTime(duration)}
      </span>

      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const a = e.currentTarget;
          readDuration(a);
          if (pendingSeek.current !== null) {
            a.currentTime = pendingSeek.current;
            pendingSeek.current = null;
          }
        }}
        onDurationChange={(e) => readDuration(e.currentTarget)}
        onTimeUpdate={(e) => moveTo(e.currentTarget.currentTime)}
        onSeeked={(e) => moveTo(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </div>
  );
}

/* 播放／暫停手寫，不引圖示庫（零重依賴）。整條列只有這顆是圖形——
   ±10 秒與速度用文字，「−10秒」不必先學，小尺寸下也不會糊成一團。 */

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden focusable="false">
      <path d="M4 2.5 13 8l-9 5.5z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden focusable="false">
      <path d="M4 2.5h2.5v11H4zM9.5 2.5H12v11H9.5z" fill="currentColor" />
    </svg>
  );
}
