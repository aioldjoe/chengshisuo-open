// 會議記錄 → Word（.docx）。client / server 共用，勿放 server-only import。
//
// 手寫 OOXML 而不是裝函式庫，理由同 lib/zip.ts：一份文件不值得一整包依賴。
// .docx 就是「幾個 XML 檔包成 ZIP」，最小可用集合只有這裡列的六個 part。
//
// 條列刻意用「・」＋首行凸排，不做 numbering.xml：編號清單那套是 docx 裡最容易
// 寫壞的部分（Word 遇到不合法的 numbering 會整份拒開），而中文文件用「・」本來就通。

import { fmtDurationZh, fmtTime } from "./format";
import type { Meeting } from "./types";
import { zipStore } from "./zip";

/** 一段文字的樣式；對應 styles.xml 裡的 styleId。 */
type Style = "Title" | "Heading1" | "Heading2" | "Speaker" | "Meta" | "Normal";

type Para = {
  style: Style;
  text: string;
  /** 條列項：前面加「・」與首行凸排。 */
  bullet?: boolean;
  /** 從新的一頁開始。 */
  pageBreak?: boolean;
};

/** A4，單位 twip（1/1440 吋）。 */
const A4_W = 11906;
const A4_H = 16838;
/** 2cm 邊界。 */
const MARGIN = 1134;
/** 條列凸排 0.25 吋。 */
const INDENT = 360;

function esc(s: string): string {
  return (
    s
      // XML 1.0 不接受的控制字元先清掉——留著 Word 會整份拒開
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
  );
}

/** 一段文字轉 runs；段內換行用 <w:br/>（使用者在 textarea 裡打的 Enter 會走到這）。 */
function runs(text: string, rPr: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `<w:r>${rPr}<w:t xml:space="preserve">${esc(line)}</w:t></w:r>`)
    .join("<w:br/>");
}

/**
 * 每一級的實際格式。w:sz 的單位是半點（22 ＝ 11pt），間距是 twip。
 *
 * 這份表跟 styles.xml 的內容重複，而且是刻意的：不少 .docx 閱讀器（macOS 的
 * textutil／Quick Look 就是）根本不讀 styles.xml，只認段落上的直接格式——
 * 只掛 pStyle 的話，那些地方會把整份文件攤成同一級的內文。
 * styles.xml 還是要留：Word 的導覽窗格與「改樣式套全篇」吃的是它。
 */
const FORMAT: Record<Style, {
  sz: number;
  bold?: boolean;
  color?: string;
  before?: number;
  after?: number;
  keepNext?: boolean;
}> = {
  Title: { sz: 44, bold: true, after: 80 },
  Heading1: { sz: 30, bold: true, before: 360, after: 140, keepNext: true },
  Heading2: { sz: 24, bold: true, before: 220, after: 100, keepNext: true },
  Speaker: { sz: 22, bold: true, color: "6B6B6B", before: 200, after: 40, keepNext: true },
  Meta: { sz: 18, color: "6B6B6B", after: 240 },
  Normal: { sz: 22, after: 120 },
};

function rPrXml(style: Style): string {
  const f = FORMAT[style];
  // 元素順序是 schema 規定的：b → color → sz
  return (
    "<w:rPr>" +
    (f.bold ? "<w:b/>" : "") +
    (f.color ? `<w:color w:val="${f.color}"/>` : "") +
    `<w:sz w:val="${f.sz}"/><w:szCs w:val="${f.sz}"/>` +
    "</w:rPr>"
  );
}

function paraXml(p: Para): string {
  const f = FORMAT[p.style];
  // w:pPr 的子元素順序也是 schema 規定的：pStyle → keepNext → pageBreakBefore → spacing → ind → rPr
  const props =
    `<w:pStyle w:val="${p.style}"/>` +
    (f.keepNext ? "<w:keepNext/>" : "") +
    (p.pageBreak ? "<w:pageBreakBefore/>" : "") +
    `<w:spacing w:before="${f.before ?? 0}" w:after="${f.after ?? 0}" w:line="288" w:lineRule="auto"/>` +
    (p.bullet ? `<w:ind w:left="${INDENT}" w:hanging="${INDENT}"/>` : "") +
    rPrXml(p.style);
  const rPr = rPrXml(p.style);
  const bullet = p.bullet ? `<w:r>${rPr}<w:t xml:space="preserve">・</w:t></w:r>` : "";
  return `<w:p><w:pPr>${props}</w:pPr>${bullet}${runs(p.text, rPr)}</w:p>`;
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const CONTENT_TYPES =
  XML_HEAD +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
  "</Types>";

const ROOT_RELS =
  XML_HEAD +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
  "</Relationships>";

const DOC_RELS =
  XML_HEAD +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  "</Relationships>";

/**
 * 樣式表。刻意不指定字型——指名了反而糟：中文字型在 Windows／macOS／Google Docs
 * 三邊的名字都不一樣，指錯就是滿頁方框。交給 Word 自己的預設中文字型最穩。
 * w:sz 的單位是半點，所以 15pt 寫 30。
 */
const STYLES =
  XML_HEAD +
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault>' +
  '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="288" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/>' +
  '<w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="44"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
  '<w:pPr><w:keepNext/><w:spacing w:before="360" w:after="140"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>' +
  '<w:pPr><w:keepNext/><w:spacing w:before="220" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Speaker"><w:name w:val="Speaker"/>' +
  '<w:pPr><w:keepNext/><w:spacing w:before="200" w:after="40"/></w:pPr><w:rPr><w:b/><w:color w:val="6B6B6B"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Meta"><w:name w:val="Meta"/>' +
  '<w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:color w:val="6B6B6B"/><w:sz w:val="18"/></w:rPr></w:style>' +
  "</w:styles>";

function coreXml(title: string, at: Date): string {
  const iso = at.toISOString().replace(/\.\d+Z$/, "Z");
  return (
    XML_HEAD +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"' +
    ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"' +
    ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${esc(title)}</dc:title>` +
    "<dc:creator>成事所</dc:creator><cp:lastModifiedBy>成事所</cp:lastModifiedBy>" +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified>` +
    "</cp:coreProperties>"
  );
}

function documentXml(paras: Para[]): string {
  return (
    XML_HEAD +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    paras.map(paraXml).join("") +
    `<w:sectPr><w:pgSz w:w="${A4_W}" w:h="${A4_H}"/>` +
    `<w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}"/></w:sectPr>` +
    "</w:body></w:document>"
  );
}

export type ExportMeeting = Pick<
  Meeting,
  "createdAt" | "durationLabel" | "summary" | "turns" | "speakerNames"
>;

/** 抬頭那行 meta，跟記錄頁同一組資訊（檔名不放，理由見 meeting-view）。 */
function metaLine(m: ExportMeeting): string {
  const speakers = new Set<string>();
  for (const t of m.turns) if (t.speaker) speakers.add(t.speaker);
  for (const k of Object.keys(m.speakerNames)) speakers.add(k);
  return [
    m.createdAt.slice(0, 10),
    fmtDurationZh(m.durationLabel),
    speakers.size > 0 ? `${speakers.size} 位說話人` : null,
  ]
    .filter((x): x is string => typeof x === "string")
    .join("　/　");
}

/** 一區：有內容才給標題。空區塊在文件裡是「看起來壞了」，不是「誠實地空」。 */
function block(title: string, items: string[], level: 1 | 2 = 1): Para[] {
  if (items.length === 0) return [];
  return [
    { style: level === 1 ? "Heading1" : "Heading2", text: title },
    ...items.map((text): Para => ({ style: "Normal", text, bullet: true })),
  ];
}

/** 待辦／承諾底下那行小字；欄位缺了就整段不出現，不留「負責人：」的空殼。 */
function detailLine(parts: (string | null)[]): Para[] {
  const text = parts.filter((x): x is string => !!x).join("　/　");
  return text ? [{ style: "Normal", text }] : [];
}

function buildParas(m: ExportMeeting, displayName: (label: string | null) => string): Para[] {
  const s = m.summary;
  const todos = s.todos.flatMap((t): Para[] => [
    { style: "Normal", text: t.task, bullet: true },
    ...detailLine([t.owner && `負責人：${t.owner}`, t.due && `期限：${t.due}`]),
  ]);
  const commitments = s.commitments.flatMap((c): Para[] => [
    { style: "Normal", text: `${displayName(c.who)}：${c.what}`, bullet: true },
    ...detailLine([c.due && `期限：${c.due}`]),
  ]);

  return [
    { style: "Title", text: s.title.trim() || "會議記錄" },
    { style: "Meta", text: metaLine(m) },
    ...block("重點", s.highlights),
    ...block("決議", s.decisions),
    ...(todos.length > 0 ? [{ style: "Heading1" as const, text: "待辦" }, ...todos] : []),
    ...(commitments.length > 0
      ? [{ style: "Heading1" as const, text: "承諾追蹤" }, ...commitments]
      : []),
    // 只有一段時不另立「議題分段」——那一段就是整場會，跟記錄頁同一條規則
    ...(s.sections.length >= 2
      ? [
          { style: "Heading1" as const, text: "議題分段" },
          ...s.sections.flatMap((sec, i) =>
            block(sec.title.trim() || `議題 ${i + 1}`, sec.points, 2),
          ),
        ]
      : []),
    ...transcriptParas(m, displayName),
  ];
}

/**
 * 逐字稿另起一頁：重點區是給人看的交付物，逐字稿是佐證——
 * 印出來時兩者混在同一頁，第一頁就被口水淹掉。
 * 講者名只在換人時出現，跟記錄頁一樣（同一個人連講三段還標三次是雜訊）；
 * 用自己的 Speaker 樣式不用 Heading2——講者名進了大綱，Word 的導覽窗格會被幾百個名字灌爆。
 */
function transcriptParas(
  m: ExportMeeting,
  displayName: (label: string | null) => string,
): Para[] {
  if (m.turns.length === 0) return [];
  const out: Para[] = [{ style: "Heading1", text: "逐字稿", pageBreak: true }];
  m.turns.forEach((t, i) => {
    if (t.speaker && (i === 0 || t.speaker !== m.turns[i - 1].speaker)) {
      out.push({ style: "Speaker", text: displayName(t.speaker) });
    }
    out.push({ style: "Normal", text: `${fmtTime(t.start)}　${t.text}` });
  });
  return out;
}

/** 匯出檔名（不含副檔名）。標題可能是空的或超長，兩種都要有下限。 */
export function exportBaseName(title: string): string {
  return (title.trim() || "會議記錄").replace(/[\\/:*?"<>|]/g, " ").slice(0, 60);
}

/**
 * 會議 → .docx 的位元組。displayName 解說話人命名，
 * 與記錄頁共用同一套（見 meeting-view 的 display）。
 */
export function meetingToDocx(
  m: ExportMeeting,
  displayName: (label: string | null) => string,
  at: Date = new Date(),
): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const title = m.summary.title.trim() || "會議記錄";
  const files: [string, string][] = [
    ["[Content_Types].xml", CONTENT_TYPES],
    ["_rels/.rels", ROOT_RELS],
    ["docProps/core.xml", coreXml(title, at)],
    ["word/_rels/document.xml.rels", DOC_RELS],
    ["word/document.xml", documentXml(buildParas(m, displayName))],
    ["word/styles.xml", STYLES],
  ];
  return zipStore(
    files.map(([name, xml]) => ({ name, data: enc.encode(xml) })),
    at,
  );
}
