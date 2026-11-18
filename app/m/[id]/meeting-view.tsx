"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AUDIO_TTL_HOURS } from "@/lib/cleanup";
import { isIos, isLineInAppBrowser } from "@/lib/browser";
import { exportBaseName } from "@/lib/docx";
import type { ExportFormat } from "@/lib/export-file";
import { fmtDurationZh, fmtTime, parseClock } from "@/lib/format";
import { cleanMeetingEdits } from "@/lib/meeting-edit";
import { PLANS, planLabel, type PlanId } from "@/lib/plans";
import { isSelectingText } from "@/lib/player";
import { turnsToSrt } from "@/lib/srt";
import { display, displayTurns, setSpeakerName, speakerLabels } from "@/lib/transcript";
import type {
  Commitment,
  Correction,
  Meeting,
  MeetingSection,
  MeetingSummary,
  TodoItem,
  TranscriptTurn,
} from "@/lib/types";

import css from "./meeting.module.css";
import { AddButton, AutoTextarea, DetailInput, Row, StringListEditor } from "./editable";
import { CorrectionsPanel, SpeakerFixSelect, type SpeakerOption, speakerOptions } from "./transcript-fix";
import { BottomBar } from "./bottom-bar";
import { type SeekFn } from "./player";

/**
 * 記錄頁 client 閘門＋編輯。流程：載入 LIFF SDK → liff.init →
 * getIDToken → 帶 Bearer 打 GET /api/m/[id]。LIFF 掛在 LINE Login channel，
 * 與 bot 同 provider，token 驗出的 userId 才對得上會議的 userId。
 * 沒拿到 liffId（本機開發，見 page.tsx）就不帶 token——後端 DEV_LINE_USER_ID 直通。
 * 外部瀏覽器打開時 liff.login() 轉去 LINE 登入再彈回來。
 *
 * 編輯：重點區可改可補、說話人命名全篇連動、逐字稿唯讀（GLOSSARY.md）。
 * 沒有「編輯模式」開關——零摩擦哲學，改完自動存。
 */

type LiffSdk = {
  init(cfg: { liffId: string }): Promise<void>;
  isLoggedIn(): boolean;
  isInClient(): boolean;
  /** 一定要傳 redirectUri，否則 LINE 只會回到 Endpoint URL（見呼叫處）。 */
  login(options?: { redirectUri?: string }): void;
  getIDToken(): string | null;
  /** 匯出要靠它把人送出 LINE 的內建瀏覽器（見 ExportZone）。 */
  openWindow?(params: { url: string; external?: boolean }): void;
  /**
   * 轉傳（見 ShareControl）。兩個都是選填：舊版 SDK 沒有，
   * 而且 shareTargetPicker 還要 LIFF app 開了 chat_message.write 權限才會出現——
   * 沒開的話 isApiAvailable 回 false，不是丟錯，只能自己問。
   */
  isApiAvailable?(name: string): boolean;
  shareTargetPicker?(
    messages: { type: string; text: string }[],
  ): Promise<{ status: string } | null>;
};

declare global {
  interface Window {
    liff?: LiffSdk;
  }
}

const LIFF_SDK_URL = "https://static.line-scdn.net/liff/edge/2/sdk.js";
/** 停手多久才送出。太短會把每個字都送上去，太長會讓人以為沒存到。 */
const SAVE_DEBOUNCE_MS = 700;
/** 替換命中處閃多久。夠久到看得見換到哪，短到不會變成頁面上的常駐註記。 */
const FLASH_MS = 1400;

/**
 * 網址上的簽章（?e=&s=）。在本頁代表這次是 PDF 的渲染請求、在試用那頭是入場憑證
 * （app/t/[id] 與其 claim 頁也用它）。回傳原樣的查詢字串，好原封不動接到 API 上——
 * 驗章在伺服器端做，這裡只負責轉交。
 */
export function signedQueryFromLocation(): string | null {
  if (typeof location === "undefined") return null;
  const q = new URLSearchParams(location.search);
  return q.has("e") && q.has("s") ? new URLSearchParams({ e: q.get("e")!, s: q.get("s")! }).toString() : null;
}

/** exported for 試用認領頁（app/t/[id]/claim）——同一套 LIFF 載入，別各寫各的。 */
export function loadLiffSdk(): Promise<LiffSdk> {
  return new Promise((resolve, reject) => {
    if (window.liff) return resolve(window.liff);
    const s = document.createElement("script");
    s.src = LIFF_SDK_URL;
    s.onload = () => (window.liff ? resolve(window.liff) : reject(new Error("LIFF SDK 載入異常")));
    s.onerror = () => reject(new Error("LIFF SDK 載入失敗"));
    document.head.appendChild(s);
  });
}

type State =
  | { phase: "loading" }
  | { phase: "denied" }
  | { phase: "gone" }
  | { phase: "deleted" }
  | { phase: "error"; message: string }
  | {
      phase: "ready";
      meeting: Meeting;
      audioUrl: string | null;
      idToken: string | null;
      /** 付費加值（PDF 匯出、分享）開不開。 */
      paid: boolean;
    };

export default function MeetingView({ id, liffId }: { id: string; liffId: string | null }) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const textScale = useTextScale();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let idToken: string | null = null;
        // 帶簽章進來的是 headless Chromium 在渲染 PDF（見 lib/pdf.ts）——
        // 它沒有 LINE 身分，也不該被轉去登入，簽章本身就是這兩分鐘的憑證。
        const signed = signedQueryFromLocation();
        if (liffId && !signed) {
          const liff = await loadLiffSdk();
          await liff.init({ liffId });
          // 外部瀏覽器且未登入：轉去 LINE 登入，回來會重跑這段
          if (!liff.isLoggedIn() && !liff.isInClient()) {
            // 帶著 code 回來卻還是沒登入 = 這趟登入沒被 SDK 接完，
            // 再 login 一次就是無限迴圈。寧可停下來給句話。
            if (new URLSearchParams(location.search).has("code")) {
              return setState({ phase: "error", message: "LINE 登入沒接上" });
            }
            // 一定要自己給 redirectUri：不給的話 SDK 不會帶 redirect_uri，
            // LINE 只認得 LIFF app 的 Endpoint URL（網域根），登入完就把人丟在首頁，
            // 而且連 liffRedirectUri 也只是那個根網址——/m/{id} 救不回來（2026-08-23 實測）。
            liff.login({ redirectUri: location.href });
            return;
          }
          idToken = liff.getIDToken();
        }
        const res = await fetch(`/api/m/${id}${signed ? `?${signed}` : ""}`, {
          headers: idToken ? { authorization: `Bearer ${idToken}` } : {},
        });
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) return setState({ phase: "denied" });
        if (res.status === 404) return setState({ phase: "gone" });
        if (!res.ok) return setState({ phase: "error", message: `伺服器回應 ${res.status}` });
        const body = (await res.json()) as {
          meeting: Meeting;
          audioUrl: string | null;
          plan?: PlanId;
        };
        setState({
          phase: "ready",
          meeting: body.meeting,
          audioUrl: body.audioUrl,
          idToken,
          paid: !!body.plan && PLANS[body.plan].paidPerks,
        });
      } catch (e) {
        if (!cancelled) setState({ phase: "error", message: e instanceof Error ? e.message : "未知錯誤" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, liffId]);

  if (state.phase === "loading") return <Skeleton />;
  if (state.phase === "denied")
    return <Notice text="這份記錄只有本人能看。請用收到連結的 LINE 帳號打開。" />;
  if (state.phase === "gone") return <Notice text="找不到這份記錄，可能已到期或已刪除。" />;
  if (state.phase === "deleted") return <Notice text="刪掉了。記錄和音檔都已清除，這個連結不再有效。" />;
  if (state.phase === "error") return <Notice text={`載入失敗（${state.message}）。重新整理再試。`} />;

  return (
    <MeetingBody
      id={id}
      initial={state.meeting}
      audioUrl={state.audioUrl}
      idToken={state.idToken}
      paid={state.paid}
      textScale={textScale}
      onDeleted={() => setState({ phase: "deleted" })}
    />
  );
}

/**
 * 打不開的那幾種結局。別人點到連結時這是唯一會看到的畫面——
 * 落款要在，不然看起來只是一個壞掉的網址。
 */
export function Notice({ text }: { text: string }) {
  return (
    <main className={css.notice}>
      <Brand />
      <p className={css.noticeText}>{text}</p>
    </main>
  );
}

/** quiet：記錄頁抬頭用——LIFF 標題列已經寫著「成事所」，頁內落款退後一步，重心讓給會議標題。 */
export function Brand({ quiet = false }: { quiet?: boolean }) {
  return (
    <div className={`${css.brand}${quiet ? ` ${css.brandQuiet}` : ""}`}>
      <span className={css.seal} aria-hidden>
        成
      </span>
      <span className={css.wordmark}>成事所</span>
    </div>
  );
}

/** 載入中的骨架。落款是確定的就先給真的，其餘用灰塊佔位——第一秒的印象在這裡。 */
export function Skeleton() {
  return (
    <main className={css.page} aria-busy="true">
      <Brand />
      <p className={css.srOnly}>載入中</p>
      <div aria-hidden>
        <div className={css.skel} style={{ height: "2.4rem", width: "62%" }} />
        <div className={css.skel} style={{ height: "0.9rem", width: "40%", marginTop: "0.9rem" }} />
        {[0, 1].map((i) => (
          <div key={i} style={{ marginTop: "3rem" }}>
            <div className={css.skel} style={{ height: "1.1rem", width: "5rem" }} />
            <div className={css.skel} style={{ height: "0.95rem", width: "100%", marginTop: "1.1rem" }} />
            <div className={css.skel} style={{ height: "0.95rem", width: "92%", marginTop: "0.7rem" }} />
            <div className={css.skel} style={{ height: "0.95rem", width: "74%", marginTop: "0.7rem" }} />
          </div>
        ))}
      </div>
    </main>
  );
}

/* ------------------------------- 字體大小 ------------------------------- */

const TEXT_SCALE_KEY = "chengshisuo:textScale";
/** 全站 rem 都吃 html 的字級，調這裡整頁跟著縮放，元件不必知道。 */
const TEXT_SCALE_STEPS = [1, 1.125, 1.25, 1.375];

export function useTextScale() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const saved = Number(localStorage.getItem(TEXT_SCALE_KEY));
    if (Number.isInteger(saved) && saved > 0 && saved < TEXT_SCALE_STEPS.length) setStep(saved);
  }, []);

  useEffect(() => {
    document.documentElement.style.fontSize = `${TEXT_SCALE_STEPS[step] * 100}%`;
    localStorage.setItem(TEXT_SCALE_KEY, String(step));
    // 離開記錄頁就還原，字級偏好不該滲到其他頁面
    return () => {
      document.documentElement.style.fontSize = "";
    };
  }, [step]);

  return {
    step,
    max: TEXT_SCALE_STEPS.length - 1,
    bigger: () => setStep((s) => Math.min(s + 1, TEXT_SCALE_STEPS.length - 1)),
    smaller: () => setStep((s) => Math.max(s - 1, 0)),
  };
}

export function TextScaleControl({
  step,
  max,
  onSmaller,
  onBigger,
}: {
  step: number;
  max: number;
  onSmaller: () => void;
  onBigger: () => void;
}) {
  return (
    <div className={css.textScale} role="group" aria-label="調整字體大小">
      <button
        type="button"
        className={css.textScaleBtn}
        onClick={onSmaller}
        disabled={step === 0}
        aria-label="縮小字體"
      >
        A－
      </button>
      <button
        type="button"
        className={css.textScaleBtn}
        onClick={onBigger}
        disabled={step === max}
        aria-label="放大字體"
      >
        A＋
      </button>
    </div>
  );
}

/* ------------------------------- 自動存檔 ------------------------------- */

type SaveState = "idle" | "saving" | "saved" | "failed";

/**
 * 停手 700ms 才 PATCH，且同時間只有一個請求在路上——
 * 打字快時後面的覆蓋前面的，避免舊值蓋掉新值。
 */
function useAutosave(id: string, idToken: string | null) {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<unknown>(null);
  const inflight = useRef(false);

  const flush = useCallback(async () => {
    if (inflight.current || pending.current === null) return;
    const body = pending.current;
    pending.current = null;
    inflight.current = true;
    setSaveState("saving");
    try {
      const res = await fetch(`/api/m/${id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          ...(idToken ? { authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify(body),
      });
      setSaveState(res.ok ? "saved" : "failed");
    } catch {
      setSaveState("failed");
    } finally {
      inflight.current = false;
    }
    if (pending.current !== null) void flush();
  }, [id, idToken]);

  const queue = useCallback(
    (body: unknown) => {
      pending.current = body;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  // 「已儲存」只是回饋，晃一下就收——常駐會變成畫面雜訊。
  useEffect(() => {
    if (saveState !== "saved") return;
    const t = setTimeout(() => setSaveState("idle"), 1600);
    return () => clearTimeout(t);
  }, [saveState]);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return { saveState, queue };
}

/* -------------------------------- 主體 -------------------------------- */

function MeetingBody({
  id,
  initial,
  audioUrl,
  idToken,
  paid,
  textScale,
  onDeleted,
}: {
  id: string;
  initial: Meeting;
  audioUrl: string | null;
  idToken: string | null;
  /** 付費檔才有的加值：PDF 匯出與分享（GLOSSARY.md 的方案與價格）。 */
  paid: boolean;
  textScale: ReturnType<typeof useTextScale>;
  onDeleted: () => void;
}) {
  const [m, setM] = useState<Meeting>(initial);
  const { saveState, queue } = useAutosave(id, idToken);
  // 逐字稿的兩種修正各自是一個模式：平時逐字稿一個編輯 affordance 都不長，唯讀外觀不變。
  const [fixingWords, setFixingWords] = useState(false);
  const [fixingSpeakers, setFixingSpeakers] = useState(false);
  /**
   * 剛套上的替換：term 是換上去的詞，rows 是真的被換到的段落。
   * 只閃這幾列——不然原本就拼對的同一個詞也會跟著亮，看起來像改到了沒改的地方。
   * 每次都是新物件，同一個詞連換兩次也會重新閃（state 不會 bail out）。
   */
  const [flash, setFlash] = useState<{ term: string; rows: Set<number> } | null>(null);

  /**
   * 存檔一律經過這裡，不用 effect 監看 m——effect 版在 StrictMode 下
   * 會在載入當下就送出一次沒人改過的內容。ref 存最新值，連打時不會拿到舊 state。
   */
  const latest = useRef(m);
  const edit = useCallback(
    (mutate: (prev: Meeting) => Meeting) => {
      const next = mutate(latest.current);
      latest.current = next;
      setM(next);
      queue(cleanMeetingEdits(next));
    },
    [queue],
  );

  /**
   * 畫面上的逐字稿＝原文套上錯詞替換與說話人修正（lib/transcript.ts）。
   * 相依只列這三個：標題打一個字就重算整份逐字稿太貴。
   */
  const shown = useMemo(() => displayTurns(m), [m.turns, m.corrections, m.speakerFixes]);

  const addCorrection = (c: Correction) => {
    // 命中的列在套用前就算好——shown 這時還是舊的，正好是「換之前」的樣子
    const rows = new Set(shown.flatMap((t, i) => (t.text.includes(c.from) ? [i] : [])));
    edit((prev) => ({ ...prev, corrections: [...(prev.corrections ?? []), c] }));
    setFlash({ term: c.to, rows });
  };

  const removeCorrection = (i: number) =>
    // 刪了就還原——原文從沒被動過，所以不做二次確認（2026-08-21 拍板）
    edit((prev) => ({ ...prev, corrections: (prev.corrections ?? []).filter((_, j) => j !== i) }));

  /** memo 過的 TurnRow 靠這個 identity 穩定：播放時每秒都在換 activeTurn，整份逐字稿不能跟著重畫。 */
  const fixSpeaker = useCallback(
    (index: number, label: string) => {
      edit((prev) => {
        const next = { ...(prev.speakerFixes ?? {}) };
        // 選回原本分離出來的那位＝取消修正，規則就不該留著
        if (label === "" || label === prev.turns[index].speaker) delete next[String(index)];
        else next[String(index)] = label;
        return { ...prev, speakerFixes: next };
      });
    },
    [edit],
  );

  const patchSummary = (p: Partial<MeetingSummary>) =>
    edit((prev) => ({ ...prev, summary: { ...prev.summary, ...p } }));

  /**
   * 逐字稿列上的就地改名也走這支，所以要 useCallback——memo 過的 TurnRow 靠 identity 穩定。
   * 清空＝取消命名（鍵刪掉，不是留空字串），規則在 lib/transcript.ts 的 setSpeakerName。
   */
  const renameSpeaker = useCallback(
    (label: string, name: string) =>
      edit((prev) => ({ ...prev, speakerNames: setSpeakerName(prev.speakerNames, label, name) })),
    [edit],
  );

  /** 分享連結不走自動存檔——app/api/m/[id]/share/route.ts 自己落庫，這裡只同步畫面。 */
  const setShareToken = (shareToken: string | null) => {
    const next = { ...latest.current, shareToken };
    latest.current = next;
    setM(next);
  };

  const s = m.summary;
  // memo 過：修正說話人的選單吃它，identity 一變 memo 過的逐字稿列就整份重畫
  const labels = useMemo(() => speakerLabels(m), [m.turns, m.speakerNames]);
  // 檔名不放：iPhone 語音備忘錄預設名（「新錄音 3」）沒資訊量，只是雜訊。
  const meta = [
    m.createdAt.slice(0, 10),
    fmtDurationZh(m.durationLabel),
    labels.length > 0 ? `${labels.length} 位說話人` : null,
  ].filter((x): x is string => typeof x === "string");

  // 快速跳區兼總覽：帶數字，第一秒就知道這場會記到多少東西；逐字稿可能幾百行，手機上找承諾不該用滑的。
  const anchors = [
    { id: "highlights", label: "重點", count: s.highlights.length },
    { id: "decisions", label: "決議", count: s.decisions.length },
    { id: "todos", label: "待辦", count: s.todos.length },
    { id: "commitments", label: "承諾", count: s.commitments.length },
    ...(s.sections.length >= 2 ? [{ id: "topics", label: "議題", count: s.sections.length }] : []),
    { id: "transcript", label: "逐字稿", count: null },
  ];
  /**
   * 選單內容一次算好：TurnRow 是 memo 的，這個陣列的 identity 一變整份逐字稿就重畫。
   * 「回原本」永遠在——修正一律可撤銷，包含本來就沒分離出講者（speaker 為 null）的段落。
   */
  const options = useMemo(
    () => [{ label: "", text: "回原本" }, ...speakerOptions(m, labels)],
    [m.speakerNames, labels],
  );

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(t);
  }, [flash]);

  // 播放位置只以「第幾段」的形式傳進來——播放器內部一秒更新好幾次，整份逐字稿不能跟著重畫。
  const [activeTurn, setActiveTurn] = useState(-1);
  const seekRef = useRef<SeekFn | null>(null);
  const jump = useCallback((sec: number) => seekRef.current?.(sec), []);
  const starts = useMemo(() => m.turns.map((t) => t.start), [m.turns]);

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
        <AutoTextarea
          value={s.title}
          onChange={(v) => patchSummary({ title: v })}
          placeholder="會議標題"
          className={css.titleField}
          ariaLabel="會議標題"
        />
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
        {!audioUrl && m.audioKey === null && (
          <p className={css.audioGone}>錄音已刪除。所有錄音只保留 {AUDIO_TTL_HOURS} 小時。</p>
        )}
      </header>

      {labels.length > 0 && (
        <Section title="說話人" hint="改成真名，整份跟著換">
          <div className={css.speakers}>
            {labels.map((label) => (
              <label key={label} className={css.speakerRow}>
                <span className={css.speakerLabel}>{label}</span>
                <SpeakerNameInput
                  label={label}
                  name={m.speakerNames[label] ?? ""}
                  className={css.speakerInput}
                  onRename={renameSpeaker}
                />
              </label>
            ))}
          </div>
        </Section>
      )}

      <Section id="highlights" title="重點" hint="點內容就能改">
        <StringListEditor
          items={s.highlights}
          onChange={(highlights) => patchSummary({ highlights })}
          placeholder="這場會議的重點是…"
          addLabel="新增重點"
          emptyText="還沒有重點。"
          itemClassName={css.lead}
        />
      </Section>

      <Section id="decisions" title="決議">
        <StringListEditor
          items={s.decisions}
          onChange={(decisions) => patchSummary({ decisions })}
          placeholder="會中拍板的事…"
          addLabel="新增決議"
          emptyText="沒有記到決議。"
        />
      </Section>

      <Section id="todos" title="待辦">
        <TodoEditor
          todos={s.todos}
          labels={labels}
          m={m}
          onChange={(todos) => patchSummary({ todos })}
        />
      </Section>

      <Section id="commitments" title="承諾追蹤" hint="會中親口答應的事">
        <CommitmentEditor
          commitments={s.commitments}
          labels={labels}
          m={m}
          onChange={(commitments) => patchSummary({ commitments })}
        />
      </Section>

      {s.sections.length >= 2 && (
        <Section id="topics" title="議題分段">
          {s.sections.map((sec, i) => (
            <SectionBlock
              key={i}
              index={i}
              section={sec}
              onChange={(next) =>
                patchSummary({ sections: s.sections.map((x, j) => (j === i ? next : x)) })
              }
            />
          ))}
        </Section>
      )}

      {/* 講者名只在換人時出現——同一個人連講三段還標三次名字是雜訊，時間戳已經定位了。 */}
      {/* 「唯讀」不能因為多了跳播就不講——整頁只有這一區不能改（GLOSSARY.md）。 */}
      <Section
        id="transcript"
        title="逐字稿"
        printBreak
        hint={audioUrl ? "唯讀，點段落即播" : "唯讀"}
        action={
          <>
            {/* 修正的入口都放在區 head：列上一個編輯 affordance 都不長，也不跟「點段落即播」搶手勢。 */}
            <button
              type="button"
              className={`${css.sectionAction}${fixingWords ? ` ${css.sectionActionOn}` : ""}`}
              aria-expanded={fixingWords}
              onClick={() => setFixingWords((v) => !v)}
            >
              修正錯詞
            </button>
            {labels.length > 0 && (
              <button
                type="button"
                className={`${css.sectionAction}${fixingSpeakers ? ` ${css.sectionActionOn}` : ""}`}
                aria-pressed={fixingSpeakers}
                onClick={() => setFixingSpeakers((v) => !v)}
              >
                {fixingSpeakers ? "改完了" : "修正說話人"}
              </button>
            )}
            <DownloadSrtButton turns={shown} m={m} title={s.title} />
          </>
        }
      >
        {fixingWords && (
          <CorrectionsPanel
            turns={shown}
            corrections={m.corrections ?? []}
            onAdd={addCorrection}
            onRemove={removeCorrection}
          />
        )}
        {fixingSpeakers && (
          <p className={css.fixNote}>
            分離錯人的那段，改成正確的說話人；選「回原本」就取消修正。話一個字都不會變。
          </p>
        )}
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
              flash={flash?.rows.has(i) ? flash.term : null}
              speakerLabel={t.speaker}
              speakerName={t.speaker ? (m.speakerNames[t.speaker] ?? "") : ""}
              onRenameSpeaker={renameSpeaker}
              fixOptions={fixingSpeakers ? options : null}
              onFixSpeaker={fixSpeaker}
            />
          );
        })}
      </Section>

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
        <ExportZone
          paid={paid}
          fileUrl={async (format) => {
            const res = await fetch(`/api/m/${id}/export?format=${format}`, {
              method: "POST",
              headers: idToken ? { authorization: `Bearer ${idToken}` } : {},
            });
            if (!res.ok) throw new Error(String(res.status));
            return (await res.json()).url as string;
          }}
        />
        <div className={css.shareZone}>
          <h3 className={css.shareSectionTitle}>分享</h3>
          <ShareControl
            id={id}
            idToken={idToken}
            paid={paid}
            shareToken={m.shareToken}
            title={s.title}
            onChange={setShareToken}
          />
        </div>
        <div className={css.dangerZone}>
          <DeleteMeeting id={id} idToken={idToken} onDeleted={onDeleted} />
        </div>
      </footer>

      {/* 跳區列常駐；音檔還在就在它上面疊播放列，邊聽邊滑逐字稿對照。 */}
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

      {saveState !== "idle" && (
        <div className={`${css.saveBar}${saveState === "failed" ? ` ${css.failed}` : ""}`} role="status">
          <span className={css.saveDot} aria-hidden />
          {saveState === "saving" && "儲存中"}
          {saveState === "saved" && "已儲存"}
          {saveState === "failed" && "沒存上，檢查網路後再試"}
        </div>
      )}
    </main>
  );
}

export function Section({
  id,
  title,
  hint,
  action,
  printBreak = false,
  children,
}: {
  id?: string;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  /** 列印時從新的一頁開始（逐字稿用）。CSS module 會改寫 id，只能靠 class 認。 */
  printBreak?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={`${css.section}${printBreak ? ` ${css.printBreak}` : ""}`}>
      <div className={css.sectionHead}>
        <h2 className={css.sectionTitle}>{title}</h2>
        <span className={css.rule} aria-hidden />
        {hint && <span className={css.hint}>{hint}</span>}
        {action}
      </div>
      {children}
    </section>
  );
}

/* -------------------------------- 匯出 -------------------------------- */

/** Blob 生連結、模擬點擊。伺服器不參與——內容早就在畫面上了。 */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * blob 下載前的關卡：在 LINE 內建瀏覽器裡先把人送去外部瀏覽器，回傳「這次擋下來了」。
 *
 * LINE 的 iOS WebView 沒有實作 <a download>，按了毫無反應也不丟錯；全站流量都從
 * LINE 進來，不擋就是靜默失效。匯出已經改走伺服器出檔＋導頁，不需要這一關了，
 * 只剩逐字稿的 SRT 還是前端組 blob（見下面）。
 * LIFF 頁有 SDK 可以直接開；分享頁沒有，只能告訴使用者怎麼自己開。
 */
function leaveLineBrowser(tell: (msg: string) => void): boolean {
  if (typeof navigator === "undefined" || !isLineInAppBrowser(navigator.userAgent)) return false;
  const liff = window.liff;
  if (liff?.openWindow) liff.openWindow({ url: location.href, external: true });
  else tell("LINE 內建瀏覽器沒辦法匯出。點右上角「⋯」→「用其他瀏覽器開啟」，再按一次。");
  return true;
}

/**
 * 鎖住的加值按下去說的話。不寫「無權限」——會按這顆的人正是想付錢的人，
 * 給的是下一步（回 LINE 傳「升級」拿付款連結），不是道歉。
 */
const UPGRADE_HINT = (what: string) =>
  `${what}是付費方案的加值 ✦ 在 LINE 對成事所傳一句「升級」，我會把付款連結送過去（${planLabel("lite")}起）。`;

/**
 * 匯出：Word 與 PDF 都由伺服器出檔，前端只負責導頁。
 *
 * Word 刻意不在前端組完 blob 直接下載——LINE 的 iOS 內建瀏覽器是 WKWebView，
 * 沒有實作 <a download>，按了不會有事也不會報錯。改成跟伺服器換一條短效簽章網址、
 * 就地導過去：iOS 用 QuickLook 預覽、Android 的 LINE 直接下載、桌機正常存檔，
 * 一條路走完，人也不必離開 LINE（見 app/api/m/[id]/export）。
 *
 * PDF 同一條路：伺服器上用 headless Chromium 跑同一份 @media print 排版
 * （lib/pdf.ts），出來的就是頁面本身的樣子。window.print() 在 LINE 的 WebView 裡
 * 根本不存在，所以「叫瀏覽器列印」這條路在主要通路上從來就走不通。
 *
 * 付費牆在這裡：PDF 是加值，Word 所有人都有（體驗核心不上鎖）。
 * 鎖住的鈕仍然按得下去——按了會告訴你怎麼升級，這是升級扳機不是死路。
 * 真正的閘門在伺服器（app/api/m/[id]/export 的 402），這裡只是先講清楚。
 */
export function ExportZone({
  fileUrl,
  paid,
}: {
  fileUrl: (format: ExportFormat) => Promise<string>;
  paid: boolean;
}) {
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const go = async (format: ExportFormat) => {
    setHint(null);
    if (format === "pdf" && !paid) return setHint(UPGRADE_HINT("PDF 匯出"));
    setBusy(format);
    try {
      const url = await fileUrl(format);
      // PDF 要在伺服器上開一次瀏覽器排版，冷的時候十幾秒。導頁下載沒有任何
      // 完成事件可以聽，畫面上不講一句就是「按了沒反應」。
      // LINE 的 iOS WebView 拿到 attachment 不會下載，一律先開 QuickLook 預覽——
      // 「存進手機」那一步藏在預覽的分享鈕裡，不講的話使用者以為只能看不能存。
      // （iOS 的 Safari 走正常下載，所以要同時是 LINE 內建才講這句。）
      const iosInLine = isLineInAppBrowser(navigator.userAgent) && isIos(navigator.userAgent);
      if (format === "pdf") {
        setHint(
          iosInLine
            ? "PDF 在伺服器上排版中，好了會開啟預覽；點分享 →「儲存到檔案」就能存進手機。"
            : "PDF 在伺服器上排版中，好了會自動下載。",
        );
      } else if (iosInLine) {
        setHint("會先開啟預覽，點分享 →「儲存到檔案」就能存進手機。");
      }
      // 導頁而不是 a[download]：理由見上面。附帶好處是不必判斷是不是在 LINE 裡。
      location.href = url;
      // 同理，「忙完了」也沒得聽，只能自己收。這個秒數是給最慢的情況留餘裕，
      // 不是真的在等它——收早了會讓人以為失敗而連按。
      setTimeout(() => setBusy(null), format === "pdf" ? 20_000 : 2_000);
    } catch {
      setHint("拿不到檔案，檢查網路後再試一次。");
      setBusy(null);
    }
  };

  return (
    <div className={css.exportZone}>
      <h3 className={css.shareSectionTitle}>匯出</h3>
      <div className={css.shareRow}>
        <button
          type="button"
          className={css.shareBtn}
          onClick={() => go("docx")}
          disabled={busy !== null}
        >
          {busy === "docx" ? "準備中" : "Word 檔"}
        </button>
        {/* PDF 要在伺服器上開一次瀏覽器排版，冷的時候好幾秒——按鈕得說話，不然像沒反應 */}
        <button
          type="button"
          className={css.shareBtn}
          onClick={() => go("pdf")}
          disabled={busy !== null}
        >
          {busy === "pdf" ? "排版中" : paid ? "PDF" : "PDF ✦"}
        </button>
      </div>
      {hint && (
        <p className={css.exportHint} role="status">
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * 逐字稿轉 SRT 下載。turns 早就在畫面上了，不用多打一支 API——
 * 純前端組字串、Blob 生連結、模擬點擊，跟伺服器無關。
 *
 * 這顆是前端組 blob，所以得先過 leaveLineBrowser——在 LINE 的 WebView 裡按了
 * 沒反應。（匯出那兩顆已經改成伺服器出檔＋導頁，不必再繞這一圈。）
 * 提示沒地方放——它長在區塊標題列上，所以讓它整條換行到標題底下
 * （見 .sectionActionHint），語氣比照 .exportHint。
 */
export function DownloadSrtButton({
  turns,
  m,
  title,
}: {
  turns: TranscriptTurn[];
  m: Pick<Meeting, "speakerNames">;
  title: string;
}) {
  const [hint, setHint] = useState<string | null>(null);

  const download = () => {
    if (leaveLineBrowser(setHint)) return;
    const srt = turnsToSrt(turns, (label) => display(m, label));
    downloadBlob(
      new Blob([srt], { type: "text/plain;charset=utf-8" }),
      `${exportBaseName(title)}.srt`,
    );
  };
  return (
    <>
      <button type="button" className={css.sectionAction} onClick={download}>
        下載字幕（SRT）
      </button>
      {/* role="status" 是因為按鈕本身看不出變化——讀螢幕的人只有這句話能知道發生什麼事。 */}
      {hint && (
        <p className={css.sectionActionHint} role="status">
          {hint}
        </p>
      )}
    </>
  );
}

/**
 * 剛換好的詞閃一下。只在剛套用的那幾秒有 <mark>，之後整列回到純文字——
 * 逐字稿不該留下永久的「這裡被改過」註記，那是編輯過的樣子。
 */
function highlightTerm(text: string, term: string): React.ReactNode {
  const parts = text.split(term);
  if (parts.length === 1) return text;
  return parts.map((p, i) => (
    <span key={i}>
      {i > 0 && <mark className={css.hit}>{term}</mark>}
      {p}
    </span>
  ));
}

/**
 * 逐字稿一列。memo 是必要的不是優化：播放時每換一段就重畫，
 * 上千列的逐字稿只有交棒的那兩列該動。
 */
export const TurnRow = memo(function TurnRow({
  index,
  start,
  text,
  speaker,
  spaced,
  active,
  onSeek,
  flash = null,
  speakerLabel = null,
  speakerName = "",
  onRenameSpeaker,
  fixOptions = null,
  onFixSpeaker,
}: {
  index: number;
  start: number;
  text: string;
  /** 換人講話才給名字，同一個人連講不重複標。 */
  speaker: string | null;
  spaced: boolean;
  active: boolean;
  /** 沒有音檔（72 小時後）就是 null，時間戳退回純文字。 */
  onSeek: ((sec: number) => void) | null;
  /** 剛套上的替換詞；這列有命中就閃一下（分享頁永遠是 null）。 */
  flash?: string | null;
  /** 這列目前的講者標籤（已套過修正）——修正說話人選單與就地改名都吃它。 */
  speakerLabel?: string | null;
  /** 這位講者目前存的名字，沒命名是空字串（就地改名的輸入框預填它）。 */
  speakerName?: string;
  /** 給了才長出就地改名的入口（唯讀的分享／試用／示範頁不給）。identity 要穩定。 */
  onRenameSpeaker?: (label: string, name: string) => void;
  /** 非 null＝修正說話人模式。identity 要穩定，否則播放時整份逐字稿會重畫。 */
  fixOptions?: SpeakerOption[] | null;
  onFixSpeaker?: (index: number, label: string) => void;
}) {
  const cls = [
    css.turn,
    spaced ? css.turnNew : "",
    active ? css.turnActive : "",
    onSeek ? css.turnSeekable : "",
  ]
    .filter(Boolean)
    .join(" ");
  /* 整列都是跳播熱區：手機上 3.25rem 的時間戳太細，而且使用者想點的是「那句話」。
     規則只有一條——點哪一列就從那列開頭播，正在播的也一樣（重播），暫停交給 dock。
     列本身不掛 role="button"：裡面已經有 button，巢狀非法；這只是指標裝置的加大熱區。 */
  const onRowClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    // 時間戳按鈕自己會播（也是鍵盤入口），冒泡上來別再播一次
    // 選單（修正說話人）自己會處理點擊，冒泡上來別再跳播
    if (e.target instanceof Element && e.target.closest("button, select")) return;
    if (isSelectingText(window.getSelection())) return;
    onSeek(start);
  };
  return (
    <div className={cls} onClick={onRowClick}>
      {onSeek ? (
        <button
          type="button"
          className={css.stampBtn}
          onClick={() => onSeek(start)}
          aria-label={`從 ${fmtTime(start)} 開始播放`}
        >
          {fmtTime(start)}
        </button>
      ) : (
        <span className={css.stamp}>{fmtTime(start)}</span>
      )}
      <p className={css.turnText}>
        {fixOptions && onFixSpeaker ? (
          <SpeakerFixSelect
            index={index}
            value={speakerLabel}
            options={fixOptions}
            onChange={onFixSpeaker}
          />
        ) : speaker && speakerLabel && onRenameSpeaker ? (
          <TurnSpeakerName
            label={speakerLabel}
            text={speaker}
            name={speakerName}
            onRename={onRenameSpeaker}
          />
        ) : (
          speaker && <span className={css.turnSpeaker}>{speaker}</span>
        )}
        {flash ? highlightTerm(text, flash) : text}
      </p>
    </div>
  );
});

/**
 * 講者的名字欄位。頁首「說話人」區與逐字稿列上的就地改名共用這一顆——
 * placeholder 與 aria-label 一分岔，同一件事就會在兩個地方講成兩種話。
 */
function SpeakerNameInput({
  label,
  name,
  className,
  onRename,
  autoFocus = false,
  onBlur,
  onKeyDown,
}: {
  label: string;
  /** 目前存的名字；沒命名是空字串，placeholder 才有機會出現。 */
  name: string;
  className: string;
  onRename: (label: string, name: string) => void;
  autoFocus?: boolean;
  onBlur?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <input
      className={className}
      value={name}
      placeholder="這位是誰？"
      aria-label={`${label} 的名字`}
      onChange={(e) => onRename(label, e.target.value)}
      autoFocus={autoFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    />
  );
}

/**
 * 逐字稿列上的講者名，點下去就地改名（issue #23）。
 * 使用者是在逐字稿裡讀到內容才認出「A 是王經理」——入口只擺在頁首等於逼他捲回去、
 * 離開判斷現場。改的是 speakerNames 這條規則、不是原文，所以「逐字稿唯讀」沒破
 * （GLOSSARY.md）；顯示時才套用，一改整份（頁首、待辦／承諾選單、匯出）跟著換。
 *
 * 邊打邊套用：跟頁首那組欄位同一套零摩擦規矩，而且「整份跟著換」要當場看得到
 * 才有說服力。代價是沒有「還沒送出」的中間態，所以 Esc 得自己記著打開當下的名字
 * 寫回去——按 Esc 的人要的是取消，不是把已經生效的改動留下來。
 *
 * 跟區頭的「修正說話人」是兩件事：那裡改的是「這段是誰講的」，這裡只改名字。
 */
function TurnSpeakerName({
  label,
  text,
  name,
  onRename,
}: {
  label: string;
  /** 顯示用的講者名（已套過命名）。 */
  text: string;
  /** 目前存的名字；沒命名是空字串，placeholder 才有機會出現。 */
  name: string;
  onRename: (label: string, name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  /** 打開當下的名字，給 Esc 還原用。 */
  const before = useRef(name);

  if (!editing) {
    return (
      <button
        type="button"
        className={css.turnSpeakerBtn}
        onClick={() => {
          before.current = name;
          setEditing(true);
        }}
        aria-label={`改「${text}」的名字`}
      >
        {text}
      </button>
    );
  }
  return (
    // 整列是跳播熱區，而這一組（輸入框＋提示）都不該跳播——提示那半邊既不是
    // button 也不是 input，列上的排除清單接不到，所以由這裡整組擋下來。
    <span className={css.turnRename} onClick={(e) => e.stopPropagation()}>
      <SpeakerNameInput
        label={label}
        name={name}
        className={css.turnRenameInput}
        onRename={onRename}
        // 點了才長出來的欄位，游標不進去等於還要再點一次
        autoFocus
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onRename(label, before.current);
          if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
        }}
      />
      <span className={css.turnRenameHint}>改名字，整份跟著換</span>
    </span>
  );
}

/* ------------------------------ 各區編輯器 ------------------------------ */

/**
 * 負責人／承諾人一律從說話人裡選——這樣改名字時整頁會一起動。
 * 資料裡若是 AI 寫的名字（不在講者清單裡），保留成一個選項，不逼使用者改掉。
 */
function SpeakerSelect({
  value,
  labels,
  m,
  onChange,
  ariaLabel,
  allowNone,
}: {
  value: string | null;
  labels: string[];
  m: Meeting;
  onChange: (v: string | null) => void;
  ariaLabel: string;
  allowNone: boolean;
}) {
  const extra = value && !labels.includes(value) ? [value] : [];
  return (
    <select
      className={css.select}
      value={value ?? ""}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
    >
      {allowNone && <option value="">未指定</option>}
      {!allowNone && value === null && <option value="">請選擇</option>}
      {[...labels, ...extra].map((label) => (
        <option key={label} value={label}>
          {display(m, label)}
        </option>
      ))}
    </select>
  );
}

function TodoEditor({
  todos,
  labels,
  m,
  onChange,
}: {
  todos: TodoItem[];
  labels: string[];
  m: Meeting;
  onChange: (next: TodoItem[]) => void;
}) {
  const patch = (i: number, p: Partial<TodoItem>) =>
    onChange(todos.map((t, j) => (j === i ? { ...t, ...p } : t)));

  return (
    <>
      {todos.length === 0 && <p className={css.empty}>沒有待辦事項。</p>}
      <ul className={css.list}>
        {todos.map((t, i) => (
          <Row key={i} onRemove={() => onChange(todos.filter((_, j) => j !== i))} removeLabel="刪除這項待辦">
            <AutoTextarea
              value={t.task}
              onChange={(task) => patch(i, { task })}
              placeholder="要做什麼？"
              ariaLabel="待辦內容"
            />
            <div className={css.detail}>
              <span className={css.detailItem}>
                <span className={css.detailLabel}>誰</span>
                <SpeakerSelect
                  value={t.owner}
                  labels={labels}
                  m={m}
                  onChange={(owner) => patch(i, { owner })}
                  ariaLabel="負責人"
                  allowNone
                />
              </span>
              <DetailInput
                label="何時"
                value={t.due ?? ""}
                onChange={(due) => patch(i, { due: due === "" ? null : due })}
                placeholder="未指定"
              />
            </div>
          </Row>
        ))}
      </ul>
      <AddButton
        onClick={() => onChange([...todos, { task: "", owner: null, due: null }])}
        label="新增待辦"
      />
    </>
  );
}

function CommitmentEditor({
  commitments,
  labels,
  m,
  onChange,
}: {
  commitments: Commitment[];
  labels: string[];
  m: Meeting;
  onChange: (next: Commitment[]) => void;
}) {
  const patch = (i: number, p: Partial<Commitment>) =>
    onChange(commitments.map((c, j) => (j === i ? { ...c, ...p } : c)));

  return (
    <>
      {commitments.length === 0 && <p className={css.empty}>沒有記到承諾。</p>}
      <ul className={css.list}>
        {commitments.map((c, i) => (
          <Row
            key={i}
            onRemove={() => onChange(commitments.filter((_, j) => j !== i))}
            removeLabel="刪除這則承諾"
            marker="seal"
          >
            <AutoTextarea
              value={c.what}
              onChange={(what) => patch(i, { what })}
              placeholder="答應了什麼？"
              ariaLabel="承諾內容"
            />
            <div className={css.detail}>
              <span className={css.detailItem}>
                <span className={css.detailLabel}>誰</span>
                <SpeakerSelect
                  value={c.who === "" ? null : c.who}
                  labels={labels}
                  m={m}
                  onChange={(who) => patch(i, { who: who ?? "" })}
                  ariaLabel="承諾人"
                  allowNone={false}
                />
              </span>
              <DetailInput
                label="何時"
                value={c.due ?? ""}
                onChange={(due) => patch(i, { due: due === "" ? null : due })}
                placeholder="未指定"
              />
            </div>
          </Row>
        ))}
      </ul>
      <AddButton
        onClick={() => onChange([...commitments, { who: labels[0] ?? "", what: "", due: null }])}
        label="新增承諾"
      />
    </>
  );
}

function SectionBlock({
  index,
  section,
  onChange,
}: {
  index: number;
  section: MeetingSection;
  onChange: (next: MeetingSection) => void;
}) {
  // 不用 <details> 摺疊：標題本身要可編輯，摺疊列會讓同一個標題出現兩次。
  return (
    <div className={css.subsection}>
      <AutoTextarea
        value={section.title}
        onChange={(title) => onChange({ ...section, title })}
        placeholder={`議題 ${index + 1}`}
        className={css.subsectionTitle}
        ariaLabel="議題標題"
      />
      <StringListEditor
        items={section.points}
        onChange={(points) => onChange({ ...section, points })}
        placeholder="這段講了什麼…"
        addLabel="新增一點"
        emptyText="這段還沒有內容。"
      />
    </div>
  );
}

/**
 * 唯讀分享連結的開關。沒有連結就是一顆「產生」按鈕；有連結就顯示網址（可複製）
 * ＋撤銷鍵。token 本身就是憑證，撤銷後舊連結立刻失效（app/api/s/[token] 查不到）。
 */
function ShareControl({
  id,
  idToken,
  paid,
  shareToken,
  title,
  onChange,
}: {
  id: string;
  idToken: string | null;
  /** 分享是付費加值；已經有連結的（降回免費檔）照樣看得到連結與撤銷鍵。 */
  paid: boolean;
  shareToken: string | null;
  /** 轉傳出去的訊息第一行，讓收到的人知道這是哪一場。 */
  title: string;
  onChange: (token: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const url =
    shareToken && typeof window !== "undefined" ? `${window.location.origin}/s/${shareToken}` : "";

  /** 產一條分享連結並回傳 token；失敗回 null（呼叫端自己決定要不要往下走）。 */
  const mintToken = async (): Promise<string | null> => {
    try {
      const res = await fetch(`/api/m/${id}/share`, {
        method: "POST",
        headers: idToken ? { authorization: `Bearer ${idToken}` } : {},
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { shareToken: string };
      onChange(body.shareToken);
      return body.shareToken;
    } catch {
      setFailed(true);
      return null;
    }
  };

  const create = async () => {
    if (!paid) return setNote(UPGRADE_HINT("分享連結"));
    setBusy(true);
    setFailed(false);
    await mintToken();
    setBusy(false);
  };

  /**
   * 轉傳到 LINE：跳出 LINE 的選人畫面，把分享連結送進選定的聊天室。
   *
   * 送的是「連結」不是檔案——LINE 的 API 傳不了 .docx／.pdf，
   * shareTargetPicker 只吃文字／Flex／圖片這類訊息。
   * 還沒有分享連結就順手產一條：要轉傳的人不該先被逼著按另一顆鈕。
   */
  const forward = async () => {
    if (!paid && !shareToken) return setNote(UPGRADE_HINT("分享連結"));
    setBusy(true);
    setFailed(false);
    setNote(null);
    try {
      const token = shareToken ?? (await mintToken());
      if (!token) return;

      const liff = window.liff;
      // 權限沒開時 isApiAvailable 回 false（不是丟錯）——給得出替代動作才有用
      if (!liff?.shareTargetPicker || liff.isApiAvailable?.("shareTargetPicker") === false) {
        setNote("這裡不能直接轉傳，用「複製」把連結貼到聊天室。");
        return;
      }
      const res = await liff.shareTargetPicker([
        { type: "text", text: `${title.trim() || "會議記錄"}\n${window.location.origin}/s/${token}` },
      ]);
      // 使用者按取消時回 null，那不是失敗，不必說話
      if (res) setNote("已送出。");
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/m/${id}/share`, {
        method: "DELETE",
        headers: idToken ? { authorization: `Bearer ${idToken}` } : {},
      });
      if (!res.ok) throw new Error(String(res.status));
      onChange(null);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // 剪貼簿權限被擋——連結欄位本身可以手動選取複製
    }
  };

  // 轉傳是這一區的主要動作——大部分人要的是「傳給誰」，不是「拿到一串網址」。
  const forwardBtn = (
    <button type="button" className={css.shareCta} onClick={forward} disabled={busy}>
      轉傳到 LINE
    </button>
  );

  if (!shareToken) {
    return (
      <>
        <div className={css.shareRow}>
          {forwardBtn}
          <button type="button" className={css.shareBtn} onClick={create} disabled={busy}>
            {busy ? "產生中…" : "只要連結"}
          </button>
        </div>
        {note && <p className={css.exportHint} role="status">{note}</p>}
        {failed && <span className={css.confirmText}>沒產生成功，再試一次？</span>}
      </>
    );
  }

  return (
    <>
      <div className={css.shareRow}>{forwardBtn}</div>
      <div className={css.shareRow}>
        <input
          className={css.shareLink}
          value={url}
          readOnly
          onFocus={(e) => e.currentTarget.select()}
          aria-label="分享連結"
        />
        <button type="button" className={css.shareBtn} onClick={copy}>
          {copied ? "已複製" : "複製"}
        </button>
        <button type="button" className={css.dangerBtn} onClick={revoke} disabled={busy}>
          {busy ? "撤銷中…" : "撤銷"}
        </button>
      </div>
      {note && <p className={css.exportHint} role="status">{note}</p>}
      {failed && <span className={css.confirmText}>操作失敗，再試一次？</span>}
      <p className={css.hint}>拿到連結的人都能看（唯讀），不用 LINE 登入。</p>
    </>
  );
}

/** 刪除鍵：真刪、二次確認（GLOSSARY.md 的刪除權）。 */
function DeleteMeeting({
  id,
  idToken,
  onDeleted,
}: {
  id: string;
  idToken: string | null;
  onDeleted: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const doDelete = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/m/${id}`, {
        method: "DELETE",
        headers: idToken ? { authorization: `Bearer ${idToken}` } : {},
      });
      if (!res.ok) throw new Error(String(res.status));
      onDeleted();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  if (!asking) {
    return (
      <button type="button" className={css.dangerBtn} onClick={() => setAsking(true)}>
        刪除這場會議
      </button>
    );
  }

  return (
    <div className={css.confirmRow}>
      <span className={css.confirmText}>
        {failed ? "刪除失敗，再試一次？" : "記錄頁與音檔都會立刻消失，無法復原。"}
      </span>
      <button type="button" className={css.confirmYes} onClick={doDelete} disabled={busy}>
        {busy ? "刪除中…" : "確認刪除"}
      </button>
      <button type="button" className={css.confirmNo} onClick={() => setAsking(false)} disabled={busy}>
        取消
      </button>
    </div>
  );
}
