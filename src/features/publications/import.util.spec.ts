import { PublicationType } from 'src/common/enums/publication-type.enum';
import { abstractFromIndex, dblpHasDoi, findSelf, fromCrossref, fromDblp, fromOpenAlex } from './import.util';

const doi = '10.1000/xyz';

describe('fromOpenAlex', () => {
  const work = {
    id: 'https://openalex.org/W123',
    title: 'A Paper',
    type: 'article',
    publication_year: 2021,
    publication_date: '2021-05-04',
    language: 'en',
    abstract_inverted_index: { Hello: [0], world: [1] },
    biblio: { volume: '3', issue: '2', first_page: '10', last_page: '20' },
    primary_location: { source: { display_name: 'Nature', host_organization_name: 'Springer' } },
    authorships: [
      { author: { display_name: 'Ada Lovelace', orcid: 'https://orcid.org/0000-0002-1825-0097' }, institutions: [{ display_name: 'Uni A' }] },
      { author: { display_name: 'Twin', orcid: 'https://orcid.org/0000-0002-1825-0097' } },
      { author: { display_name: '' }, raw_author_name: '' },
    ],
  };

  it('maps a journal article with outside authors only', () => {
    const d = fromOpenAlex(work, doi)!;
    expect(d.type).toBe(PublicationType.JOURNAL_ARTICLE);
    expect(d.journalName).toBe('Nature');
    expect(d.pages).toBe('10-20');
    expect(d.abstract).toBe('Hello world');
    expect(d.identifiers).toEqual({ doi, openalexId: 'W123' });
    expect(d.authors).toEqual([
      { name: 'Ada Lovelace', orcid: '0000-0002-1825-0097', affiliation: 'Uni A', order: 0 },
      { name: 'Twin', orcid: undefined, affiliation: undefined, order: 1 }, // repeated ORCID dropped
    ]);
  });

  it('falls back to "Other" with a warning when the venue is missing', () => {
    const d = fromOpenAlex({ ...work, primary_location: null }, doi)!;
    expect(d.type).toBe(PublicationType.OTHER);
    expect(d.warnings[0]).toMatch(/Other/);
  });

  it('returns null without a title or year', () => {
    expect(fromOpenAlex({ ...work, title: null, display_name: null }, doi)).toBeNull();
    expect(fromOpenAlex({ ...work, publication_year: null, publication_date: null }, doi)).toBeNull();
  });

  it('maps preprints to their server', () => {
    const d = fromOpenAlex({ ...work, type: 'preprint' }, '10.48550/arxiv.1706.03762')!;
    expect(d.type).toBe(PublicationType.PREPRINT);
    expect(d.server).toBe('arxiv');
  });

  it('keeps at most 200 authors and says so', () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ author: { display_name: `Author ${i}` } }));
    const d = fromOpenAlex({ ...work, authorships: many }, doi)!;
    expect(d.authors).toHaveLength(200);
    expect(d.warnings.some((w) => w.includes('250'))).toBe(true);
  });
});

describe('fromDblp', () => {
  it('maps a conference paper and strips name suffixes and the trailing dot', () => {
    const info = {
      title: 'Great Work.',
      venue: 'NeurIPS',
      year: '2017',
      type: 'Conference and Workshop Papers',
      doi,
      ee: 'https://doi.org/10.1000/xyz',
      authors: { author: [{ text: 'Wei Wang 0001' }, { text: 'Jane Roe' }] },
    };
    const d = fromDblp(info, doi)!;
    expect(d.type).toBe(PublicationType.CONFERENCE_PAPER);
    expect(d.title).toBe('Great Work');
    expect(d.authors.map((a) => a.name)).toEqual(['Wei Wang', 'Jane Roe']);
    expect(dblpHasDoi(info, doi)).toBe(true);
    expect(dblpHasDoi({ ...info, doi: 'https://doi.org/10.1000/OTHER' }, doi)).toBe(false);
  });

  it('accepts a single author object and maps CoRR to arXiv', () => {
    const d = fromDblp(
      { title: 'T', venue: 'CoRR', year: '2020', type: 'Informal and Other Publications', authors: { author: { text: 'Solo' } } },
      doi,
    )!;
    expect(d.type).toBe(PublicationType.PREPRINT);
    expect(d.authors).toHaveLength(1);
  });
});

describe('fromCrossref', () => {
  const work = {
    URL: 'https://doi.org/10.1000/xyz',
    type: 'journal-article',
    title: ['A Paper'],
    'container-title': ['Nature'],
    publisher: 'Springer',
    volume: '3',
    issue: '2',
    page: '10-20',
    issued: { 'date-parts': [[2021, 5, 4]] },
    author: [
      { given: 'Ada', family: 'Lovelace', ORCID: 'http://orcid.org/0000-0002-1825-0097', affiliation: [{ name: 'Uni A' }] },
      { name: 'The Consortium' },
    ],
  };

  it('maps a journal article without an abstract', () => {
    const d = fromCrossref(work, doi)!;
    expect(d.type).toBe(PublicationType.JOURNAL_ARTICLE);
    expect(d.journalName).toBe('Nature');
    expect(d.year).toBe(2021);
    expect(d.publishedAt).toBe('2021-05-04');
    expect(d.abstract).toBeUndefined();
    expect(d.authors).toEqual([
      { name: 'Ada Lovelace', orcid: '0000-0002-1825-0097', affiliation: 'Uni A', order: 0 },
      { name: 'The Consortium', orcid: undefined, affiliation: undefined, order: 1 },
    ]);
  });

  it('keeps only the year when the date is partial, and returns null without title or year', () => {
    expect(fromCrossref({ ...work, issued: { 'date-parts': [[2020]] } }, doi)!.publishedAt).toBeUndefined();
    expect(fromCrossref({ ...work, title: [] }, doi)).toBeNull();
    expect(fromCrossref({ ...work, issued: undefined }, doi)).toBeNull();
  });

  it('maps preprints and falls back to "Other" with a warning', () => {
    const pre = fromCrossref({ ...work, type: 'posted-content', subtype: 'preprint', 'container-title': [] }, '10.48550/arxiv.1');
    expect(pre!.type).toBe(PublicationType.PREPRINT);
    expect(pre!.server).toBe('arxiv');
    const other = fromCrossref({ ...work, 'container-title': [] }, doi)!;
    expect(other.type).toBe(PublicationType.OTHER);
    expect(other.warnings[0]).toMatch(/Other/);
  });
});

describe('helpers', () => {
  it('rebuilds an abstract from the inverted index', () => {
    expect(abstractFromIndex({ b: [1], a: [0], c: [2] })).toBe('a b c');
    expect(abstractFromIndex(null)).toBeUndefined();
  });

  it('finds the current user by ORCID first, then by name in either order', () => {
    const authors = [
      { name: 'Someone Else', order: 0 },
      { name: 'Παρις Παοκαρα', order: 1, orcid: '0000-0002-1825-0097' },
      { name: 'Doe, Jöhn'.replace(',', ''), order: 2 },
    ];
    expect(findSelf(authors, { firstName: 'X', lastName: 'Y', orcid: '0000-0002-1825-0097' })).toBe(1);
    expect(findSelf(authors, { firstName: 'John', lastName: 'Doe' })).toBe(2);
    expect(findSelf(authors, { firstName: 'No', lastName: 'Match' })).toBe(-1);
  });
});
