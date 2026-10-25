import { InvalidEditorContent, sanitizeEditorContent } from './editor-content.util';

const doc = (...content: unknown[]) => ({ type: 'doc', content });
const p = (...content: unknown[]) => ({ type: 'paragraph', content });
const text = (t: string, marks?: unknown[]) => ({ type: 'text', text: t, ...(marks && { marks }) });

describe('sanitizeEditorContent', () => {
  it('keeps normal content: headings, lists, tables, formatting, safe links', () => {
    const input = doc(
      { type: 'heading', attrs: { level: 2 }, content: [text('Intro')] },
      p(text('bold', [{ type: 'bold' }]), text(' site', [{ type: 'link', attrs: { href: 'https://a.org' } }])),
      { type: 'bulletList', content: [{ type: 'listItem', content: [p(text('x'))] }] },
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [p()] }] },
        ],
      },
    );
    expect(sanitizeEditorContent(input)).toEqual(input);
  });

  it('rejects javascript: and data: links', () => {
    for (const href of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:x']) {
      const bad = doc(p(text('x', [{ type: 'link', attrs: { href } }])));
      expect(() => sanitizeEditorContent(bad)).toThrow(InvalidEditorContent);
    }
  });

  it('rejects unknown nodes and marks (no raw HTML, scripts or iframes)', () => {
    expect(() => sanitizeEditorContent(doc({ type: 'script', content: [] }))).toThrow(InvalidEditorContent);
    expect(() => sanitizeEditorContent(doc({ type: 'image', attrs: { src: 'x' } }))).toThrow(InvalidEditorContent);
    expect(() => sanitizeEditorContent(doc(p(text('x', [{ type: 'spoiler' }]))))).toThrow(InvalidEditorContent);
  });

  it('drops attributes that are not whitelisted or have bad values', () => {
    const out = sanitizeEditorContent(
      doc({ type: 'heading', attrs: { level: 99, onclick: 'x', style: 'color:red' }, content: [text('t')] }),
    );
    expect(out.content?.[0].attrs).toBeUndefined();
  });

  it('requires a doc root and rejects non-objects', () => {
    expect(() => sanitizeEditorContent({ type: 'paragraph' })).toThrow(InvalidEditorContent);
    expect(() => sanitizeEditorContent('<script>')).toThrow(InvalidEditorContent);
    expect(() => sanitizeEditorContent(null)).toThrow(InvalidEditorContent);
  });

  it('limits nesting depth and size', () => {
    let deep: unknown = p(text('x'));
    for (let i = 0; i < 40; i++) deep = { type: 'blockquote', content: [deep] };
    expect(() => sanitizeEditorContent(doc(deep))).toThrow(InvalidEditorContent);
    expect(() => sanitizeEditorContent(doc(p(text('a'.repeat(1024 * 1024)))))).toThrow(InvalidEditorContent);
  });

  it('does not let __proto__ keys through', () => {
    const evil = JSON.parse('{"type":"doc","content":[{"type":"paragraph","attrs":{"__proto__":{"polluted":true}}}]}');
    sanitizeEditorContent(evil);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('accepts Word-style formatting: alignment, font, size, colour, highlight, sub/superscript', () => {
    const input = doc(
      { type: 'paragraph', attrs: { textAlign: 'center' }, content: [
        text('x', [
          { type: 'textStyle', attrs: { fontFamily: 'Georgia', fontSize: '14pt', color: '#1a2b3c' } },
          { type: 'highlight', attrs: { color: '#fef08a' } },
          { type: 'superscript' },
        ]),
      ] },
    );
    expect(sanitizeEditorContent(input)).toEqual(input);
  });

  it('drops style values that are not on the allow-lists (no CSS injection)', () => {
    const out = sanitizeEditorContent(
      doc({ type: 'paragraph', attrs: { textAlign: 'center; position:fixed' }, content: [
        text('x', [{ type: 'textStyle', attrs: {
          fontFamily: 'x; background:url(//evil)', fontSize: '999px', color: 'red; x:y',
        } }]),
      ] }),
    );
    const para = out.content![0];
    expect(para.attrs).toBeUndefined();
    expect(para.content![0].marks).toEqual([{ type: 'textStyle' }]);
    expect(JSON.stringify(out)).not.toContain('evil');
  });
});
