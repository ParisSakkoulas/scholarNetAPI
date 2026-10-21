import { PublicationType } from 'src/common/enums/publication-type.enum';
import { MAX_AUTHORS } from './author.util';
import { ImportSource } from './dto/import-publication.dto';
import { normalizeDoi, shortOpenAlexId } from './reference.util';

/** A publication as found in an external source, shaped like `CreatePublicationDto`. */
export interface ImportDraft {
  source: ImportSource;
  sourceUrl?: string;
  /** Things the user should know before agreeing (author list cut, imported as "Other"...). */
  warnings: string[];
  type: PublicationType;
  title: string;
  abstract?: string;
  year: number;
  publishedAt?: string;
  language?: string;
  keywords: string[];
  fields: string[];
  identifiers: { doi: string; openalexId?: string };
  url?: string;
  /** Always outside authors: the importer links the current user afterwards. */
  authors: DraftAuthor[];
  /** Type-specific fields (journalName, conferenceName, publisher...) sit flat next to the rest. */
  [typeSpecific: string]: unknown;
}

export interface DraftAuthor {
  name: string;
  orcid?: string;
  affiliation?: string;
  order: number;
}

// ---------------- SMALL HELPERS ----------------

const cut = (v: string | undefined | null, max: number) => v?.trim().slice(0, max) || undefined;

export function cleanOrcid(raw?: string | null): string | undefined {
  return raw?.match(/\d{4}-\d{4}-\d{4}-\d{3}[\dX]/i)?.[0].toUpperCase();
}

/** Drops nameless entries and repeated ORCIDs, and caps the list at what a publication allows. */
function finishAuthors(authors: Omit<DraftAuthor, 'order'>[], warnings: string[]): DraftAuthor[] {
  const seen = new Set<string>();
  const out: DraftAuthor[] = [];
  for (const a of authors) {
    const name = cut(a.name, 200);
    if (!name) continue;
    const orcid = a.orcid && !seen.has(a.orcid) ? a.orcid : undefined;
    if (orcid) seen.add(orcid);
    out.push({ name, orcid, affiliation: cut(a.affiliation, 300), order: out.length });
  }
  if (out.length > MAX_AUTHORS) {
    warnings.push(`The source lists ${out.length} authors; only the first ${MAX_AUTHORS} were kept.`);
    out.length = MAX_AUTHORS;
  }
  return out;
}

/** OpenAlex stores the abstract as { word: [positions] }. */
export function abstractFromIndex(index?: Record<string, number[]> | null): string | undefined {
  if (!index) return undefined;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) for (const p of positions) words[p] = word;
  return cut(words.filter(Boolean).join(' '), 10000);
}

function preprintServer(doi: string, venue = ''): string {
  if (doi.startsWith('10.48550/arxiv') || /arxiv/i.test(venue)) return 'arxiv';
  if (/biorxiv/i.test(venue)) return 'biorxiv';
  if (/medrxiv/i.test(venue)) return 'medrxiv';
  if (doi.startsWith('10.2139/') || /ssrn/i.test(venue)) return 'ssrn';
  if (doi.startsWith('10.21203/') || /research\s?square/i.test(venue)) return 'researchsquare';
  return 'other';
}

/** Falls back to "Other" when a type's required fields are missing, and tells the user why. */
function otherOf(label: string, missing: string, warnings: string[]) {
  warnings.push(`Imported as "Other": the source has no ${missing} for a ${label}.`);
  return { type: PublicationType.OTHER, customType: label };
}

// ---------------- OPENALEX ----------------

export interface OpenAlexWork {
  id?: string;
  doi?: string | null;
  title?: string | null;
  display_name?: string | null;
  type?: string | null;
  publication_year?: number | null;
  publication_date?: string | null;
  language?: string | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  authorships?: {
    author?: { display_name?: string | null; orcid?: string | null } | null;
    raw_author_name?: string | null;
    raw_orcid?: string | null;
    institutions?: { display_name?: string | null }[];
    raw_affiliation_strings?: string[];
  }[];
  primary_location?: {
    landing_page_url?: string | null;
    source?: { display_name?: string | null; host_organization_name?: string | null } | null;
  } | null;
  biblio?: { volume?: string | null; issue?: string | null; first_page?: string | null; last_page?: string | null };
  keywords?: { display_name?: string | null }[];
  primary_topic?: { field?: { display_name?: string | null } | null } | null;
}

export interface OpenAlexAuthor {
  id: string;
  display_name: string;
  orcid?: string | null;
  works_count?: number;
  cited_by_count?: number;
  last_known_institutions?: { display_name?: string }[] | null;
}

export const OPENALEX_SELECT =
  'id,doi,title,display_name,type,publication_year,publication_date,language,abstract_inverted_index,' +
  'authorships,primary_location,biblio,keywords,primary_topic';

export function fromOpenAlex(w: OpenAlexWork, doi: string): ImportDraft | null {
  const title = cut(w.title ?? w.display_name, 500);
  const year = w.publication_year ?? parseInt(w.publication_date ?? '', 10);
  if (!title || !year || year < 1800) return null; // cannot be stored without them

  const warnings: string[] = [];
  const venue = cut(w.primary_location?.source?.display_name, 300);
  const publisher = cut(w.primary_location?.source?.host_organization_name, 300);
  const { volume, issue, first_page: first, last_page: last } = w.biblio ?? {};
  const pages = first ? (last && last !== first ? `${first}-${last}` : first) : undefined;

  let specific: Record<string, unknown>;
  switch (w.type) {
    case 'article':
    case 'review':
    case 'letter':
    case 'editorial':
    case 'erratum':
      specific = venue
        ? { type: PublicationType.JOURNAL_ARTICLE, journalName: venue, volume, issue, pages, publisher }
        : otherOf('journal article', 'journal name', warnings);
      break;
    case 'conference-paper':
    case 'proceedings-article':
      specific = venue
        ? { type: PublicationType.CONFERENCE_PAPER, conferenceName: venue, proceedingsTitle: venue, pages, publisher }
        : otherOf('conference paper', 'conference name', warnings);
      break;
    case 'book':
      specific = publisher
        ? { type: PublicationType.BOOK, publisher }
        : otherOf('book', 'publisher', warnings);
      break;
    case 'book-chapter':
      specific =
        venue && publisher
          ? { type: PublicationType.BOOK_CHAPTER, bookTitle: venue, publisher, pages }
          : otherOf('book chapter', 'book title or publisher', warnings);
      break;
    case 'preprint':
      specific = { type: PublicationType.PREPRINT, server: preprintServer(doi, venue) };
      break;
    case 'dataset':
      specific =
        venue || publisher
          ? { type: PublicationType.DATASET, repository: venue ?? publisher }
          : otherOf('dataset', 'repository', warnings);
      break;
    case 'report':
      specific =
        publisher || venue
          ? { type: PublicationType.TECHNICAL_REPORT, institution: publisher ?? venue }
          : otherOf('report', 'institution', warnings);
      break;
    case 'dissertation':
      // the degree level and institution are not in the record
      specific = { type: PublicationType.OTHER, customType: 'Dissertation' };
      warnings.push('Imported as "Other": the source does not say which degree this thesis is for.');
      break;
    default:
      specific = { type: PublicationType.OTHER, customType: w.type ?? undefined };
  }

  const authors = finishAuthors(
    (w.authorships ?? []).map((a) => ({
      name: a.author?.display_name || a.raw_author_name || '',
      orcid: cleanOrcid(a.author?.orcid ?? a.raw_orcid),
      affiliation: a.institutions?.[0]?.display_name || a.raw_affiliation_strings?.[0] || undefined,
    })),
    warnings,
  );
  const field = cut(w.primary_topic?.field?.display_name, 100);

  return {
    source: 'openalex',
    sourceUrl: w.id ?? undefined,
    warnings,
    title,
    abstract: abstractFromIndex(w.abstract_inverted_index),
    year,
    publishedAt: w.publication_date ?? undefined,
    language: /^[a-z]{2}$/i.test(w.language ?? '') ? w.language!.toLowerCase() : undefined,
    keywords: (w.keywords ?? []).map((k) => cut(k.display_name, 100)).filter(Boolean).slice(0, 20) as string[],
    fields: field ? [field] : [],
    identifiers: { doi, openalexId: shortOpenAlexId(w.id) },
    url: w.primary_location?.landing_page_url ?? `https://doi.org/${doi}`,
    authors,
    ...specific,
  } as unknown as ImportDraft;
}

// ---------------- DBLP ----------------

export interface DblpInfo {
  title?: string;
  venue?: string | string[];
  year?: string;
  type?: string;
  volume?: string;
  number?: string;
  pages?: string;
  doi?: string;
  ee?: string;
  url?: string;
  authors?: { author?: DblpAuthor | DblpAuthor[] };
}
type DblpAuthor = { text?: string; '@pid'?: string };

/** DBLP appends "0001" to tell apart people who share a name. */
const dblpName = (n?: string) => n?.replace(/\s+\d{4}$/, '').trim() ?? '';

export function fromDblp(info: DblpInfo, doi: string): ImportDraft | null {
  const title = cut(info.title?.replace(/\.$/, ''), 500);
  const year = parseInt(info.year ?? '', 10);
  if (!title || !year || year < 1800) return null;

  const warnings: string[] = [];
  const venue = cut(Array.isArray(info.venue) ? info.venue[0] : info.venue, 300);
  const pages = info.pages;

  let specific: Record<string, unknown>;
  switch (info.type) {
    case 'Journal Articles':
      specific = venue
        ? { type: PublicationType.JOURNAL_ARTICLE, journalName: venue, volume: info.volume, issue: info.number, pages }
        : otherOf('journal article', 'journal name', warnings);
      break;
    case 'Conference and Workshop Papers':
      specific = venue
        ? { type: PublicationType.CONFERENCE_PAPER, conferenceName: venue, pages }
        : otherOf('conference paper', 'conference name', warnings);
      break;
    case 'Informal and Other Publications':
      // CoRR is DBLP's name for arXiv
      specific =
        venue === 'CoRR'
          ? { type: PublicationType.PREPRINT, server: 'arxiv' }
          : { type: PublicationType.OTHER, customType: 'Informal publication' };
      break;
    default:
      // books, chapters and theses have no publisher / degree in DBLP's search result
      specific = { type: PublicationType.OTHER, customType: info.type };
      if (info.type && /Book|Part/.test(info.type)) {
        warnings.push(`Imported as "Other": DBLP does not give the publisher for "${info.type}".`);
      }
  }

  const raw = info.authors?.author;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const authors = finishAuthors(list.map((a) => ({ name: dblpName(a.text) })), warnings);
  warnings.push('DBLP has no abstract, so the imported record will not have one.');

  return {
    source: 'dblp',
    sourceUrl: info.url,
    warnings,
    title,
    year,
    keywords: [],
    fields: [],
    identifiers: { doi },
    url: info.ee?.startsWith('http') ? info.ee : `https://doi.org/${doi}`,
    authors,
    ...specific,
  } as unknown as ImportDraft;
}

/** Whether a DBLP hit is the record for this DOI (the search itself is only full-text). */
export const dblpHasDoi = (info: DblpInfo, doi: string) => normalizeDoi(info.doi) === doi;

/** Lowercase, no accents or punctuation: used to compare names and titles. */
export const plain = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Index of the author that is the current user: same ORCID, otherwise the same name
 * ("First Last" or "Last First"). -1 when nobody matches.
 */
export function findSelf(
  authors: DraftAuthor[],
  me: { firstName: string; lastName: string; orcid?: string },
): number {
  if (me.orcid) {
    const byOrcid = authors.findIndex((a) => a.orcid === cleanOrcid(me.orcid));
    if (byOrcid >= 0) return byOrcid;
  }
  const mine = [...plain(me.firstName).split(' '), ...plain(me.lastName).split(' ')]
    .filter(Boolean)
    .sort()
    .join(' ');
  return authors.findIndex((a) => plain(a.name).split(' ').sort().join(' ') === mine);
}
