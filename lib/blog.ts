/**
 * 部落格文章的解析：frontmatter ＋ 一個只認得這些文章用到的語法的 markdown 子集。
 *
 * 為什麼不裝 MDX 或 markdown 套件：這個專案的規矩是零重依賴（LINE／R2／SigV4／OOXML
 * 都是手寫，唯一例外是 PDF 的 Chromium）。兩篇文章背一整套 build-time toolchain 不划算，
 * 而稿子用到的語法就下面這幾種——認不得的一律當純文字原樣輸出，不會把內容吃掉。
 *
 * 內容留在 content/blog/*.md 而不是抄進 TSX：改稿的人是內容端，.md 的 diff 看得出改了哪句。
 *
 * FAQ 刻意在解析時就抽成結構化的 Q/A：頁面要渲染它，JSON-LD 也要它，
 * 兩邊各自從 HTML 裡撈一次就會走鐘（見 faqJsonLd）。
 */

/** 一段行內文字。bold 與 href 可並存（稿子裡沒有，但不必為此禁止）。 */
export type Inline = { text: string; bold?: boolean; href?: string };

export type Block =
  | { kind: "h2"; text: string; id: string }
  | { kind: "h3"; text: string; id: string }
  | { kind: "p"; spans: Inline[] }
  | { kind: "ul"; items: Inline[][] }
  | { kind: "ol"; items: Inline[][] }
  | { kind: "quote"; spans: Inline[] }
  | { kind: "table"; head: string[]; rows: Inline[][][] };

export type Faq = { q: string; a: string };

export type Article = {
  slug: string;
  /** 正文用的完整標題（frontmatter 的 title，通常等於 H1）。 */
  title: string;
  /** <title> 用的短版；稿子刻意跟 title 分開，SEO 標題要短。 */
  metaTitle: string;
  metaDescription: string;
  updated: string;
  blocks: Block[];
  faq: Faq[];
};

/** 行內語法：粗體與連結。兩者都不巢狀——稿子沒有，也不值得為此寫一個真的 parser。 */
const INLINE_RE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of src.matchAll(INLINE_RE)) {
    if (m.index > last) out.push({ text: src.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ text: m[1], bold: true });
    else out.push({ text: m[2], href: m[3] });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ text: src.slice(last) });
  return out.filter((s) => s.text !== "");
}

/** 攤成純文字。給 FAQ 的 JSON-LD 與測試用——結構化資料要的是人話，不是標記。 */
export function renderInline(spans: Inline[]): string {
  return spans.map((s) => s.text).join("");
}

/**
 * 標題的錨點 id。中文原樣保留（HTML5 的 id 收得下，瀏覽器也跳得到），
 * 只把空白與會壞掉網址的標點換成連字號——重點是穩定，不是好看。
 */
export function headingId(text: string): string {
  const id = text
    .trim()
    .replace(/[\s]+/g, "-")
    .replace(/[/\\?#&%=+"'<>[\]{}|^~`]/g, "");
  return id || "section";
}

/**
 * frontmatter：只取需要的純量欄位。刻意不寫成通用 YAML——
 * 稿子裡有巢狀的 internal_links，通用解析器會為了它長一倍，而我們根本不用它。
 * 縮排行直接跳過。
 */
function parseFrontmatter(src: string): { meta: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!m) throw new Error("blog: 缺少 frontmatter");
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || /^\s/.test(line)) continue; // 縮排＝巢狀，不取
    const kv = /^([A-Za-z_][\w]*):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: src.slice(m[0].length) };
}

/** 表格的分隔線（|---|---|）。 */
const TABLE_SEP = /^\|[\s|:-]+\|$/;

function parseBlocks(body: string): Block[] {
  const lines = body.split(/\r?\n/);
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // H1 是正文標題，頁面自己會出一個 <h1>——留著就是雙 h1
    if (/^#\s/.test(line)) {
      i++;
      continue;
    }

    const h = /^(#{2,3})\s+(.*)$/.exec(line);
    if (h) {
      const text = h[2].trim();
      blocks.push({ kind: h[1].length === 2 ? "h2" : "h3", text, id: headingId(text) });
      i++;
      continue;
    }

    if (line.startsWith("> ")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) buf.push(lines[i].slice(2).trim()), i++;
      blocks.push({ kind: "quote", spans: parseInline(buf.join("\n")) });
      continue;
    }

    // 表格：至少要有表頭與分隔線才算，否則一行以 | 開頭的普通句子會被誤判
    if (line.startsWith("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1].trim())) {
      const cells = (row: string) =>
        row
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(cells(lines[i]).map(parseInline));
        i++;
      }
      blocks.push({ kind: "table", head, rows });
      continue;
    }

    const bullet = /^([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (bullet) {
      const ordered = /\d/.test(bullet[1]);
      const items: string[] = [];
      while (i < lines.length) {
        // 項目之間可以隔「一行」空行——稿子用它把「標題＋一段說明」型的長項目拉開。
        // 碰到空行就收尾的話，一份清單會被切成好幾個 <ol>，畫面上的編號每項都從 1 重來。
        // 隔兩行以上則當作者真的想斷開，不硬接。
        let j = i;
        let blanks = 0;
        while (j < lines.length && !lines[j].trim()) (blanks++, j++);
        if (blanks > 1) break;
        const b = /^([-*]|\d+\.)\s+(.*)$/.exec(lines[j] ?? "");
        if (!b || /\d/.test(b[1]) !== ordered) break;
        items.push(b[2]);
        i = j + 1;
        // 縮排的續行屬於上一項
        while (i < lines.length && /^\s+\S/.test(lines[i])) {
          items[items.length - 1] += `\n${lines[i].trim()}`;
          i++;
        }
      }
      blocks.push({ kind: ordered ? "ol" : "ul", items: items.map(parseInline) });
      continue;
    }

    // 其餘＝段落。段落內的單一換行是 soft break，保留（渲染成 <br>）——
    // 稿子用它斷句，併成一行會讓長句黏在一起
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|>\s|\||[-*]\s|\d+\.\s)/.test(lines[i])) {
      buf.push(lines[i].trim());
      i++;
    }
    if (buf.length) blocks.push({ kind: "p", spans: parseInline(buf.join("\n")) });
  }

  return blocks;
}

/**
 * 把 `## FAQ` 之後的 `**Q：…**` / `A：…` 段落抽成結構化問答，並把它們從 blocks 移除。
 * 移除是重點：頁面的 FAQ 由專用區塊渲染，留在 blocks 裡就會整份出現兩次。
 */
function extractFaq(blocks: Block[]): { blocks: Block[]; faq: Faq[] } {
  const at = blocks.findIndex((b) => b.kind === "h2" && b.text === "FAQ");
  if (at < 0) return { blocks, faq: [] };

  const faq: Faq[] = [];
  for (const b of blocks.slice(at + 1)) {
    if (b.kind !== "p") continue;
    const flat = renderInline(b.spans);
    const m = /^Q[：:]\s*([\s\S]*?)\n\s*A[：:]\s*([\s\S]*)$/.exec(flat);
    if (m) faq.push({ q: m[1].trim(), a: m[2].trim() });
  }
  return { blocks: blocks.slice(0, at + 1), faq };
}

export function parseArticle(src: string): Article {
  const { meta, body } = parseFrontmatter(src);
  const { blocks, faq } = extractFaq(parseBlocks(body));
  const title = meta.title ?? "";
  return {
    slug: meta.slug ?? "",
    title,
    metaTitle: meta.meta_title || title,
    metaDescription: meta.meta_description ?? "",
    updated: meta.updated ?? "",
    blocks,
    faq,
  };
}

/** FAQPage 結構化資料。Google 從 2023 起只給政府／醫療站顯示摘錄，這裡的收益在 AI 問答引擎的抽取。 */
export function faqJsonLd(faq: Faq[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}
