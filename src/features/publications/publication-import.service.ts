import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Publication } from './schemas/publication.schema';
import { User } from '../users/schema/user.schema';
import { Profile } from '../profile/schemas/profile.schema';
import { PublicationsService } from './publications.service';
import { ReferencesService } from './references.service';
import { CreatePublicationDto } from './dto/create-publication.dto';
import { SourceCache } from './schemas/source-cache.schema';
import { DOI_PATTERN, ImportPublicationDto, ImportSource } from './dto/import-publication.dto';
import { normalizeDoi, shortOpenAlexId } from './reference.util';
import { fetchWithRetry } from './source-http.util';
import {
  CrossrefWork,
  DblpInfo,
  ImportDraft,
  OPENALEX_SELECT,
  OpenAlexAuthor,
  OpenAlexWork,
  cleanOrcid,
  dblpHasDoi,
  findSelf,
  fromCrossref,
  fromDblp,
  fromOpenAlex,
} from './import.util';

const DBLP_URL = 'https://dblp.org/search/publ/api';
const CROSSREF_URL = 'https://api.crossref.org/works';
const SOURCE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type SourceResult =
  | { status: 'found'; draft: ImportDraft }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

/**
 * Import a publication by DOI: look it up in OpenAlex and DBLP, show what each one has, and after
 * the user picks one, store it with the current user as uploader and author. Everybody else on the
 * author list is added as an outside author (no account).
 */
@Injectable()
export class PublicationImportService {
  private readonly logger = new Logger(PublicationImportService.name);

  constructor(
    @InjectModel(Publication.name) private publicationModel: Model<Publication>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Profile.name) private profileModel: Model<Profile>,
    @InjectModel(SourceCache.name) private cacheModel: Model<SourceCache>,
    private publicationsService: PublicationsService,
    private referencesService: ReferencesService,
    private config: ConfigService,
  ) {}

  // ---------------- STEP 1: LOOKUP ----------------

  async lookup(me: string, rawDoi: string) {
    const doi = this.parseDoi(rawDoi);
    const [openalex, dblpByDoi, crossref, existing] = await Promise.all([
      this.fromOpenAlexSafe(doi),
      this.fromDblpSafe(doi),
      this.fromCrossrefSafe(doi),
      this.findExisting(me, doi),
    ]);

    // DBLP's search is full-text and does not always index the DOI: retry with the title
    let dblp = dblpByDoi;
    if (dblp.status === 'not_found' && openalex.status === 'found') {
      dblp = await this.fromDblpSafe(doi, openalex.draft.title);
    }
    return { doi, existing, sources: { openalex, dblp, crossref } };
  }

  // ---------------- BY AUTHOR NAME ----------------

  /** OpenAlex authors matching a name, so the user can pick which one is them. */
  async searchAuthors(name: string) {
    const q = name?.trim();
    if (!q || q.length < 2) throw new BadRequestException('Enter at least 2 characters of the name.');

    const res = await this.referencesService.openAlex<{ results: OpenAlexAuthor[] }>('/authors', {
      search: q,
      'per-page': '10',
      select: 'id,display_name,orcid,works_count,cited_by_count,last_known_institutions',
    });
    return (res?.results ?? []).map((a) => ({
      id: shortOpenAlexId(a.id),
      name: a.display_name,
      orcid: cleanOrcid(a.orcid),
      worksCount: a.works_count ?? 0,
      citedBy: a.cited_by_count ?? 0,
      institution: a.last_known_institutions?.[0]?.display_name,
    }));
  }

  /** One page of an author's works that have a DOI, marking the ones already in scholarNet. */
  async authorWorks(me: string, authorId: string, page = 1) {
    if (!/^A\d+$/.test(authorId)) throw new BadRequestException('Invalid OpenAlex author id.');
    const res = await this.referencesService.openAlex<{
      meta: { count: number };
      results: OpenAlexWork[];
    }>('/works', {
      filter: `author.id:${authorId},has_doi:true`,
      sort: 'publication_year:desc',
      'per-page': '25',
      page: String(Math.max(1, page)),
      select: 'id,doi,title,display_name,type,publication_year,primary_location',
    });

    const works = (res?.results ?? [])
      .map((w) => ({
        doi: normalizeDoi(w.doi ?? undefined),
        title: w.title ?? w.display_name ?? '',
        year: w.publication_year ?? undefined,
        type: w.type ?? undefined,
        venue: w.primary_location?.source?.display_name ?? undefined,
      }))
      .filter((w): w is typeof w & { doi: string } => !!w.doi && !!w.title);

    const visible = await this.publicationsService.visibleTo(me);
    const found = await this.publicationModel
      .find({ $and: [{ 'identifiers.doi': { $in: works.map((w) => w.doi) } }, visible] })
      .select('identifiers.doi')
      .lean();
    const have = new Set(found.map((p) => p.identifiers?.doi));

    return {
      total: res?.meta?.count ?? 0,
      page,
      pageSize: 25,
      works: works.map((w) => ({ ...w, existing: have.has(w.doi) })),
    };
  }

  // ---------------- STEP 2: IMPORT (the user agreed) ----------------

  async importPublication(me: string, dto: ImportPublicationDto) {
    const doi = this.parseDoi(dto.doi);
    // fetched again on the server so the client cannot import data that no source returned
    const result = await this.fetchFrom(dto.source, doi);
    if (result.status === 'error') throw new BadGatewayException(result.message);
    if (result.status === 'not_found') {
      throw new NotFoundException(`No record for ${doi} was found in ${dto.source}.`);
    }

    const draft = result.draft;
    const { source, sourceUrl, fetchedAt, warnings, authors, ...fields } = draft;
    void source, sourceUrl, fetchedAt; // only for the preview, not stored
    const created = await this.publicationsService.create(me, {
      ...fields,
      authors: await this.withCurrentUser(me, authors),
      ...(dto.visibility && { visibility: dto.visibility }),
    } as unknown as CreatePublicationDto);

    // same background work as a manually created publication: link and pull its references
    void this.referencesService.onPublicationSaved(String(created!._id));
    return { publication: created, source: dto.source, warnings };
  }

  // ---------------- AUTHORS ----------------

  /**
   * The current user becomes an author: the entry that matches their ORCID or name is linked to
   * their account, otherwise they are appended. The rest stay outside authors.
   */
  private async withCurrentUser(me: string, authors: ImportDraft['authors']) {
    const [user, profile] = await Promise.all([
      this.userModel.findById(me).select('firstName lastName orcidId').lean(),
      this.profileModel.findOne({ user: me }).select('orcidId').lean(),
    ]);
    if (!user) throw new BadRequestException('Unknown user.');

    const list: CreatePublicationDto['authors'] = authors.map((a) => ({ ...a }));
    const at = findSelf(authors, {
      firstName: user.firstName,
      lastName: user.lastName,
      orcid: profile?.orcidId ?? user.orcidId,
    });
    if (at >= 0) list[at] = { ...list[at], user: me };
    else list.push({ user: me, name: `${user.firstName} ${user.lastName}`.trim(), order: list.length });
    return list;
  }

  // ---------------- SOURCES ----------------

  private fetchFrom(source: ImportPublicationDto['source'], doi: string) {
    if (source === 'openalex') return this.fromOpenAlexSafe(doi);
    if (source === 'crossref') return this.fromCrossrefSafe(doi);
    return this.fromDblpWithFallback(doi);
  }

  /** DBLP by DOI, then by the OpenAlex title (used on import, where only DBLP was picked). */
  private async fromDblpWithFallback(doi: string): Promise<SourceResult> {
    const byDoi = await this.fromDblpSafe(doi);
    if (byDoi.status !== 'not_found') return byDoi;
    const oa = await this.fromOpenAlexSafe(doi);
    return oa.status === 'found' ? this.fromDblpSafe(doi, oa.draft.title) : byDoi;
  }

  private fromOpenAlexSafe(doi: string) {
    return this.cached('openalex', doi, () => this.fetchOpenAlex(doi));
  }

  private fromDblpSafe(doi: string, title?: string) {
    return this.cached('dblp', doi, () => this.fetchDblp(doi, title));
  }

  private fromCrossrefSafe(doi: string) {
    return this.cached('crossref', doi, () => this.fetchCrossref(doi));
  }

  /**
   * Found records are kept for a day so the same DOI is not fetched twice (the preview and the
   * import both ask). Misses and errors are never cached. The cache is best effort: if MongoDB
   * fails, the source is queried as before.
   */
  private async cached(
    source: ImportSource,
    doi: string,
    load: () => Promise<SourceResult>,
  ): Promise<SourceResult> {
    try {
      const hit = await this.cacheModel.findOne({ source, doi, expiresAt: { $gt: new Date() } }).lean();
      if (hit) return { status: 'found', draft: hit.draft as unknown as ImportDraft };
    } catch (err) {
      this.logger.warn(`Source cache read failed for ${source} ${doi}: ${(err as Error).message}`);
    }

    const result = await load();
    if (result.status !== 'found') return result;

    result.draft.fetchedAt = new Date().toISOString();
    try {
      await this.cacheModel.updateOne(
        { source, doi },
        { $set: { draft: result.draft, expiresAt: new Date(Date.now() + SOURCE_CACHE_TTL_MS) } },
        { upsert: true },
      );
    } catch (err) {
      this.logger.warn(`Source cache write failed for ${source} ${doi}: ${(err as Error).message}`);
    }
    return result;
  }

  private async fetchCrossref(doi: string): Promise<SourceResult> {
    try {
      const url = new URL(`${CROSSREF_URL}/${encodeURIComponent(doi)}`);
      const mailto = this.config.get<string>('OPENALEX_MAILTO');
      if (mailto) url.searchParams.set('mailto', mailto); // polite pool

      const res = await fetchWithRetry(url, {
        headers: {
          'User-Agent': `ScholarNet/1.0${mailto ? ` (mailto:${mailto})` : ''}`,
          Accept: 'application/json',
        },
      });
      if (res.status === 404) return { status: 'not_found' };
      if (!res.ok) {
        this.logger.warn(`Crossref answered ${res.status} for ${doi}`);
        return { status: 'error', message: 'Crossref is not available right now.' };
      }

      const body = (await res.json()) as { message?: CrossrefWork };
      if (!body.message) return { status: 'not_found' };
      const draft = fromCrossref(body.message, doi);
      if (!draft) return { status: 'error', message: 'Crossref has no title or year for this DOI.' };
      return { status: 'found', draft };
    } catch (err) {
      this.logger.warn(`Crossref lookup failed for ${doi}: ${(err as Error).message}`);
      return { status: 'error', message: 'Could not reach Crossref.' };
    }
  }

  private async fetchOpenAlex(doi: string): Promise<SourceResult> {
    try {
      const work = await this.referencesService.openAlex<OpenAlexWork>(`/works/https://doi.org/${doi}`, {
        select: OPENALEX_SELECT,
      });
      if (!work) return { status: 'not_found' };
      const draft = fromOpenAlex(work, doi);
      if (!draft) return { status: 'error', message: 'OpenAlex has no title or year for this DOI.' };
      return { status: 'found', draft };
    } catch (err) {
      this.logger.warn(`OpenAlex lookup failed for ${doi}: ${(err as Error).message}`);
      return { status: 'error', message: 'Could not reach OpenAlex.' };
    }
  }

  /** Searches by DOI, or by `title` when given. Only a hit carrying exactly this DOI counts. */
  private async fetchDblp(doi: string, title?: string): Promise<SourceResult> {
    try {
      const url = new URL(DBLP_URL);
      url.searchParams.set('q', title ?? doi);
      url.searchParams.set('format', 'json');
      url.searchParams.set('h', '20');

      const mailto = this.config.get<string>('OPENALEX_MAILTO');
      const res = await fetchWithRetry(url, {
        headers: {
          'User-Agent': `ScholarNet/1.0${mailto ? ` (mailto:${mailto})` : ''}`,
          Accept: 'application/json',
        },
      });
      // dblp.org sometimes answers with an HTML bot-check page instead of JSON
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || !type.includes('json')) {
        this.logger.warn(`DBLP answered ${res.status} (${type}) for ${doi}`);
        return { status: 'error', message: 'DBLP is not available right now.' };
      }

      const body = (await res.json()) as { result?: { hits?: { hit?: { info: DblpInfo }[] } } };
      const hit = (body.result?.hits?.hit ?? []).find((h) => dblpHasDoi(h.info, doi));
      if (!hit) return { status: 'not_found' };
      const draft = fromDblp(hit.info, doi);
      if (!draft) return { status: 'error', message: 'DBLP has no title or year for this DOI.' };
      return { status: 'found', draft };
    } catch (err) {
      this.logger.warn(`DBLP lookup failed for ${doi}: ${(err as Error).message}`);
      return { status: 'error', message: 'Could not reach DBLP.' };
    }
  }

  // ---------------- HELPERS ----------------

  /** The publication already in scholarNet with this DOI, if the viewer is allowed to see it. */
  private async findExisting(me: string, doi: string) {
    const visible = await this.publicationsService.visibleTo(me);
    const pub = await this.publicationModel
      .findOne({ $and: [{ 'identifiers.doi': doi }, visible] })
      .select('_id title')
      .lean();
    return pub ? { id: String(pub._id), title: pub.title } : null;
  }

  private parseDoi(raw: string) {
    const doi = normalizeDoi(raw?.trim().replace(/^doi:\s*/i, ''));
    if (!doi || !DOI_PATTERN.test(doi)) {
      throw new BadRequestException('Enter a valid DOI, for example 10.1038/nature14539.');
    }
    return doi;
  }
}
