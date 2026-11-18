// 成事所共用型別。client / server 共用，勿放 server-only import。
// 詞彙見 GLOSSARY.md：一段錄音＝一場「會議」＝一個「記錄頁」。

/** 一段同一講者的連續發言。 */
export type TranscriptTurn = {
  /** 講者標籤（如「講者 A」）；無法分離時為 null。 */
  speaker: string | null;
  /** 起始秒數（顯示時間戳用）。 */
  start: number;
  text: string;
};

/**
 * 錯詞替換規則（issue #9）。STT 轉錯的多半是專有名詞／同音詞，而且全篇一致地錯——
 * 只能整詞、全篇一致地換，改的是詞的拼法不是話的內容。逐字稿唯讀因此不破。
 */
export type Correction = {
  from: string;
  to: string;
};

export type TodoItem = {
  task: string;
  /** AI 從上下文推測的負責人；無則 null。 */
  owner: string | null;
  /** AI 推測的期限字串（如「下週五前」）；無則 null。 */
  due: string | null;
};

/** 承諾追蹤：誰在會中親口承諾了什麼。與待辦不同，承諾一定綁定說話人。 */
export type Commitment = {
  /** 承諾人（講者標籤或名字）。 */
  who: string;
  what: string;
  due: string | null;
};

/** 依議題／agenda 切出的一段紀要。長會議會有多段，短會議可能只有一段。 */
export type MeetingSection = {
  title: string;
  points: string[];
  decisions: string[];
  todos: TodoItem[];
};

/** AI 從逐字稿萃取的結構化會議紀要——記錄頁「重點區」的資料形狀。 */
export type MeetingSummary = {
  title: string;
  /** 全場彙總重點（跨議題總覽）。 */
  highlights: string[];
  decisions: string[];
  todos: TodoItem[];
  commitments: Commitment[];
  /** 依議題分段；顯示端在 >= 2 段時才另呈現分段視圖。 */
  sections: MeetingSection[];
};

/** 一場會議的完整紀錄（儲存單位）。 */
export type Meeting = {
  id: string;
  /** LINE userId——零註冊世界裡的身分。 */
  userId: string;
  /** ISO 時間。 */
  createdAt: string;
  filename: string;
  language: string | null;
  durationLabel: string | null;
  /**
   * 實際時長（秒），額度計量的依據——付費檔按小時扣，顯示用的 durationLabel 反解回來
   * 會在「1:05:00」這種邊界上失真。選填是因為付費牆之前的資料沒有這欄（見 meetingSeconds）。
   */
  durationSeconds?: number | null;
  turns: TranscriptTurn[];
  summary: MeetingSummary;
  /** 說話人命名：原講者標籤 → 真名（如 {"講者 A": "王協理"}）。 */
  speakerNames: Record<string, string>;
  /**
   * 錯詞替換規則；顯示時才套用，turns 永不落改（可撤銷、竄改面最小）。
   * 選填是因為舊資料沒有這欄——讀的一端一律當空陣列。
   */
  corrections?: Correction[];
  /**
   * 說話人修正：turns 的索引（字串）→ 正確的講者標籤。分離錯人時改的是「這段是誰講的」，
   * 一個字都不動。同樣顯示時才套用，選填理由同 corrections。
   */
  speakerFixes?: Record<string, string>;
  /** R2 物件 key；音檔已銷毀（72h 規則）或未存則 null。 */
  audioKey: string | null;
  /** 記錄頁到期時間（ISO）；免費 30 天，付費永久為 null。 */
  expiresAt: string | null;
  /** 唯讀分享連結的 token；沒開分享或已撤銷為 null。 */
  shareToken: string | null;
};

/**
 * 量測事件的型別。刻意極少——事件表只回答「誰、什麼時候、做了什麼」，不存內容。
 * meeting_created 是留存與人均場次的唯一分子（issue #6）；
 * share_opened 是病毒迴路的分子（issue #7），對象放在 subject；
 * demo_opened 是首頁示範記錄頁被打開（issue #14）——跟 share_opened 分開，
 * 示範頁的流量才不會灌進「分享轉傳」的迴路數字。
 * trial_completed／trial_claimed 是首頁試用的兩個點（issue #19）：試用產出一份
 * 記錄頁、以及那份被認領進 LINE 身分——這張票有沒有用，只看這兩個數字。
 * 再加新型別往這裡加字串就好，表不用動。
 */
export type UsageEventType =
  | "meeting_created"
  | "share_opened"
  | "join_clicked"
  | "demo_opened"
  | "trial_completed"
  | "trial_claimed";

/** 一筆量測事件。userHash 為 null 表示無主事件（如分享頁被陌生人打開）。 */
export type UsageEvent = {
  /** sha256(LINE userId)——留存要能跨月比對同一人，但不留下可回查身分的原始 id。 */
  userHash: string | null;
  /** 寫入端的型別由 recordEvent 收斂；讀出來的就是 DB 裡的字串。 */
  type: string;
  /**
   * 事件的對象：meeting_created 與 share_opened 都是那場會議的 id，
   * join_clicked 是來源標記（如 share）。
   * 放的是 id 不是內容——事件表不存內容這條線不能破（見 lib/store/events.ts）。
   */
  subject: string | null;
  /** ISO 時間。 */
  at: string;
};
