import type { OutgoingMessage } from "./line";

/**
 * 第一次見面的三件事（issue #18）：歡迎訊息＋Quick Reply、圖文選單、怎麼用的教學。
 * 零註冊的副作用是加完好友面對一個空的聊天室，不知道能幹嘛——這個模組就是補這個洞。
 *
 * 四格按下去送出的都是文字訊息，走跟打字一模一樣的分流（lib/routing.ts）；
 * 選單本身不長邏輯，邏輯永遠只有一份。綁定測試在 onboarding.test.ts。
 */

/** 選單名稱帶版本，setup-richmenu.ts 靠它認出自己建過的舊選單來收掉。 */
export const RICH_MENU_NAME = "chengshisuo-main-v1";

export const RICH_MENU = {
  /** 聊天室下方那條收合列上的字（LINE 上限 14 字）。 */
  chatBarText: "選單",
  /**
   * 四格，2×2：左上→右上→左下→右下。順序就是 quick reply 的順序，
   * 也是 brand/src/richmenu.html 畫格子的順序——三邊都照這份定義走。
   */
  items: [
    { label: "怎麼傳錄音", text: "怎麼用" },
    { label: "看範例記錄頁", text: "看範例" },
    { label: "我的額度", text: "額度" },
    { label: "方案與價格", text: "方案" },
  ],
} as const;

type MenuItem = (typeof RICH_MENU.items)[number];

/** 選單格與 quick reply 共用同一個 action——「同一組動作」靠構造保證，不只靠測試。 */
function messageAction(item: MenuItem): { type: "message"; label: string; text: string } {
  return { type: "message", label: item.label, text: item.text };
}

/** LINE Create rich menu API 要的那包 JSON。圖是 2500×1686，四格各 1250×843。 */
export function richMenuObject(): {
  size: { width: number; height: number };
  selected: boolean;
  name: string;
  chatBarText: string;
  areas: {
    bounds: { x: number; y: number; width: number; height: number };
    action: { type: "message"; label: string; text: string };
  }[];
} {
  const W = 2500;
  const H = 1686;
  const cw = W / 2;
  const ch = H / 2;
  return {
    size: { width: W, height: H },
    // 預設展開：這個選單存在的理由就是「不知道能幹嘛」，收起來等於沒做
    selected: true,
    name: RICH_MENU_NAME,
    chatBarText: RICH_MENU.chatBarText,
    areas: RICH_MENU.items.map((item, i) => ({
      bounds: { x: (i % 2) * cw, y: Math.floor(i / 2) * ch, width: cw, height: ch },
      action: messageAction(item),
    })),
  };
}

/**
 * follow 事件（加好友／解除封鎖）的歡迎訊息。Quick reply 跟圖文選單是同一組
 * 動作——選單要等圖載入，quick reply 在第一則訊息就到，兩層保險。
 * 已知取捨：這個功能上線前就加了好友的人不會收到這則（follow 不會重發），靠選單補位。
 */
export function welcomeMessages(): OutgoingMessage[] {
  return [
    {
      type: "text",
      text:
        "你好，這裡是成事所 ✦\n\n" +
        "把會議錄音傳給我，幾分鐘後回你一條會議記錄頁連結——摘要、決議、待辦、逐字稿都在裡面。不用註冊、不用裝 App，現在就能用。\n\n" +
        "不確定從哪開始的話，先按下面的按鈕逛逛：",
      quickReply: {
        items: RICH_MENU.items.map((item) => ({ type: "action", action: messageAction(item) })),
      },
    },
  ];
}

/** 「怎麼用」的教學回覆。iPhone 語音備忘錄那條路是訪談裡最多人卡住的地方，要講到步驟。 */
export const HOWTO_GUIDE =
  "把錄音給我有兩條路：\n\n" +
  "1. 現場直接錄——聊天室輸入框右邊的麥克風，按住說話、放開送出。\n\n" +
  "2. 已經有錄音檔（例如 iPhone 語音備忘錄）——打開那段錄音 → 點分享 → 選 LINE → 傳給「成事所」。m4a、mp3、wav 這些常見格式都收。\n\n" +
  "收到後我會先回一聲，幾分鐘內把整理好的記錄頁連結傳給你 ✦";
