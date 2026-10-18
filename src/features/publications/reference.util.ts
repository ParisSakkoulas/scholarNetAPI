import { createHash } from 'crypto';

export function normalizeDoi(doi?: string | null): string | undefined {
  const v = doi
    ?.trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .toLowerCase();
  return v || undefined;
}

/** "https://openalex.org/W123" -> "W123" */
export function shortOpenAlexId(id?: string | null): string | undefined {
  const v = id?.trim().split('/').pop();
  return v ? v.toUpperCase() : undefined;
}

const norm = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9α-ω]+/g, ' ')
    .trim();

/** Dedupe key: DOI, then OpenAlex id, then hash of title + year + first author. */
export function makeReferenceKey(ref: {
  doi?: string;
  openalexId?: string;
  title?: string;
  year?: number;
  authors?: string[];
  raw?: string;
}): string {
  const doi = normalizeDoi(ref.doi);
  if (doi) return `doi:${doi}`;
  const oa = shortOpenAlexId(ref.openalexId);
  if (oa) return `oa:${oa}`;
  const basis = ref.title
    ? `${norm(ref.title)}|${ref.year ?? ''}|${norm(ref.authors?.[0] ?? '')}`
    : norm(ref.raw ?? '');
  return `h:${createHash('sha1').update(basis).digest('hex').slice(0, 24)}`;
}

/** Minimal BibTeX reader: entries -> flat lowercase field map. Handles nested braces and quotes. */
export function parseBibtex(src: string): Record<string, string>[] {
  const entries: Record<string, string>[] = [];
  const entryRe = /@(\w+)\s*[{(]/g;
  let m: RegExpExecArray | null;

  while ((m = entryRe.exec(src))) {
    if (/^(comment|string|preamble)$/i.test(m[1])) continue;
    const start = entryRe.lastIndex;
    let i = start;
    let depth = 1;
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    }
    const body = src.slice(start, i - 1);
    entryRe.lastIndex = i;

    const fields: Record<string, string> = { entrytype: m[1].toLowerCase() };
    const fieldRe = /(\w+)\s*=\s*/g;
    let f: RegExpExecArray | null;
    while ((f = fieldRe.exec(body))) {
      let j = fieldRe.lastIndex;
      let value: string;
      if (body[j] === '{') {
        let d = 0;
        const s = j;
        for (; j < body.length; j++) {
          if (body[j] === '{') d++;
          else if (body[j] === '}' && --d === 0) break;
        }
        value = body.slice(s + 1, j);
        j++;
      } else if (body[j] === '"') {
        const end = body.indexOf('"', j + 1);
        value = body.slice(j + 1, end < 0 ? body.length : end);
        j = end < 0 ? body.length : end + 1;
      } else {
        const rel = body.slice(j).search(/[,\s}]/);
        value = body.slice(j, rel < 0 ? undefined : j + rel);
        j += value.length;
      }
      fields[f[1].toLowerCase()] = value.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
      fieldRe.lastIndex = j;
    }
    entries.push(fields);
  }
  return entries;
}
