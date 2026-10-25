/**
 * The editor sends its document as ProseMirror JSON. The client is not trusted, so the server
 * rebuilds the tree from a whitelist: only known node/mark types, only known attributes, only
 * safe link protocols. Anything else is rejected, not silently dropped, so a student never loses
 * work without noticing. Keep the lists in step with the editor extensions in the web app.
 */

export interface EditorNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: EditorNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

export class InvalidEditorContent extends Error {}

const MAX_DEPTH = 30;
const MAX_NODES = 50_000;
const MAX_TEXT = 100_000;
const MAX_BYTES = 1024 * 1024;
const SAFE_LINK = /^(https?:|mailto:)/i;

/** Must match web/src/app/features/supervision/editor/editor-options.ts */
export const FONT_FAMILIES = ['Arial', 'Calibri', 'Cambria', 'Courier New', 'Georgia', 'Times New Roman', 'Verdana'];
export const FONT_SIZES = ['10pt', '11pt', '12pt', '14pt', '16pt', '18pt', '24pt', '36pt'];
const ALIGNMENTS = ['left', 'center', 'right', 'justify'];
// style values reach the page as CSS, so they are checked against fixed lists / a strict pattern
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const int = (min: number, max: number) => (v: unknown) =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? v : undefined;

type AttrRule = (value: unknown) => unknown;

const oneOf = (allowed: string[]) => (v: unknown) =>
  typeof v === 'string' && allowed.includes(v) ? v : undefined;
const hexColor = (v: unknown) => (typeof v === 'string' && HEX_COLOR.test(v) ? v.toLowerCase() : undefined);

const NODES: Record<string, Record<string, AttrRule>> = {
  doc: {},
  paragraph: { textAlign: oneOf(ALIGNMENTS) },
  text: {},
  heading: { level: int(1, 6), textAlign: oneOf(ALIGNMENTS) },
  bulletList: {},
  orderedList: { start: int(1, 100000) },
  listItem: {},
  blockquote: {},
  codeBlock: {
    language: (v) => (typeof v === 'string' && /^[\w+#.-]{1,30}$/.test(v) ? v : null),
  },
  hardBreak: {},
  horizontalRule: {},
  table: {},
  tableRow: {},
  tableCell: { colspan: int(1, 50), rowspan: int(1, 50), colwidth: colwidth },
  tableHeader: { colspan: int(1, 50), rowspan: int(1, 50), colwidth: colwidth },
};

function colwidth(v: unknown) {
  if (v === null || v === undefined) return null;
  return Array.isArray(v) && v.length <= 50 && v.every((n) => Number.isInteger(n) && n > 0 && n < 5000)
    ? v
    : null;
}

const MARKS: Record<string, Record<string, AttrRule>> = {
  bold: {},
  italic: {},
  strike: {},
  underline: {},
  code: {},
  subscript: {},
  superscript: {},
  highlight: { color: hexColor },
  textStyle: { fontFamily: oneOf(FONT_FAMILIES), fontSize: oneOf(FONT_SIZES), color: hexColor },
  link: {
    href: (v) => (typeof v === 'string' && v.length <= 2000 && SAFE_LINK.test(v.trim()) ? v.trim() : undefined),
  },
};

function pickAttrs(raw: unknown, rules: Record<string, AttrRule>) {
  const out: Record<string, unknown> = {};
  if (raw && typeof raw === 'object') {
    for (const [key, rule] of Object.entries(rules)) {
      if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
      const value = rule((raw as Record<string, unknown>)[key]);
      if (value !== undefined) out[key] = value;
    }
  }
  return out;
}

export function sanitizeEditorContent(input: unknown): EditorNode {
  if (!input || typeof input !== 'object') throw new InvalidEditorContent('Content must be an object.');
  if (JSON.stringify(input).length > MAX_BYTES) throw new InvalidEditorContent('The document is too large.');

  let count = 0;

  const walk = (raw: unknown, depth: number): EditorNode => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new InvalidEditorContent('Invalid node.');
    if (depth > MAX_DEPTH) throw new InvalidEditorContent('The document is nested too deeply.');
    if (++count > MAX_NODES) throw new InvalidEditorContent('The document has too many elements.');

    const node = raw as Record<string, unknown>;
    const type = node.type;
    if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(NODES, type)) {
      throw new InvalidEditorContent(`Unsupported element "${String(type).slice(0, 30)}".`);
    }

    const out: EditorNode = { type };
    const attrs = pickAttrs(node.attrs, NODES[type]);
    if (Object.keys(attrs).length) out.attrs = attrs;

    if (type === 'text') {
      if (typeof node.text !== 'string' || node.text.length > MAX_TEXT) {
        throw new InvalidEditorContent('Invalid text.');
      }
      out.text = node.text;
      if (node.marks !== undefined) {
        if (!Array.isArray(node.marks) || node.marks.length > 10) throw new InvalidEditorContent('Invalid marks.');
        out.marks = node.marks.map((m) => {
          const mark = m as Record<string, unknown>;
          const mType = mark?.type;
          if (typeof mType !== 'string' || !Object.prototype.hasOwnProperty.call(MARKS, mType)) {
            throw new InvalidEditorContent(`Unsupported formatting "${String(mType).slice(0, 30)}".`);
          }
          const mAttrs = pickAttrs(mark.attrs, MARKS[mType]);
          if (mType === 'link' && !mAttrs.href) throw new InvalidEditorContent('Only http, https and mailto links are allowed.');
          return Object.keys(mAttrs).length ? { type: mType, attrs: mAttrs } : { type: mType };
        });
      }
      return out;
    }

    if (node.content !== undefined) {
      if (!Array.isArray(node.content)) throw new InvalidEditorContent('Invalid content.');
      out.content = node.content.map((child) => walk(child, depth + 1));
    }
    return out;
  };

  const root = walk(input, 0);
  if (root.type !== 'doc') throw new InvalidEditorContent('The root must be a document.');
  return root;
}
