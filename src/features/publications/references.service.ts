import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Publication } from './schemas/publication.schema';
import {
  PublicationReference,
  ReferenceSnapshot,
  ReferenceSource,
  ReferenceStatus,
} from './schemas/publication-reference.schema';
import { PublicationsService } from './publications.service';
import { CreateReferenceDto, ImportReferencesDto, UpdateReferenceDto } from './dto/reference.dto';
import {
  makeReferenceKey,
  normalizeDoi,
  parseBibtex,
  shortOpenAlexId,
} from './reference.util';

const OPENALEX_URL = 'https://api.openalex.org';
const OPENALEX_BATCH = 100;
const WORK_CARD_FIELDS = 'title type year authors.name identifiers.doi';

/** A reference ready to be written, before it is matched against local publications. */
interface ReferenceDraft {
  snapshot: ReferenceSnapshot;
  raw?: string;
  source: ReferenceSource;
  locked: boolean;
  position: number;
  citedId?: Types.ObjectId;
}

@Injectable()
export class ReferencesService {
  private readonly logger = new Logger(ReferencesService.name);

  constructor(
    @InjectModel(Publication.name) private publicationModel: Model<Publication>,
    @InjectModel(PublicationReference.name) private referenceModel: Model<PublicationReference>,
    private publicationsService: PublicationsService,
    private config: ConfigService,
  ) {}

  // ---------------- READ ----------------

  /** The reference list of a publication, in order. */
  async list(me: string, publicationId: string, page: number, limit: number, skip: number) {
    await this.publicationsService.assertCanView(me, publicationId);
    const filter = { citing: publicationId };
    const [data, total] = await Promise.all([
      this.referenceModel
        .find(filter)
        .sort({ position: 1, _id: 1 })
        .skip(skip)
        .limit(limit)
        .populate('cited', WORK_CARD_FIELDS)
        .lean(),
      this.referenceModel.countDocuments(filter),
    ]);
    return { data, total, page, limit };
  }

  /** Publications on scholarNet that cite this one (only those the viewer may see). */
  async citedBy(me: string, publicationId: string, page: number, limit: number, skip: number) {
    await this.publicationsService.assertCanView(me, publicationId);
    const visible = await this.publicationsService.visibleTo(me);
    const edges = await this.referenceModel.find({ cited: publicationId }).select('citing').lean();
    const filter = { $and: [{ _id: { $in: edges.map((e) => e.citing) } }, visible] };

    const [data, total] = await Promise.all([
      this.publicationModel
        .find(filter)
        .sort({ year: -1 })
        .skip(skip)
        .limit(limit)
        .select(WORK_CARD_FIELDS)
        .lean(),
      this.publicationModel.countDocuments(filter),
    ]);
    return { data, total, page, limit };
  }

  // ---------------- MANUAL EDITS (uploader only) ----------------

  async add(me: string, publicationId: string, dto: CreateReferenceDto) {
    await this.publicationsService.findOwned(me, publicationId);
    const draft = await this.draftFromInput(publicationId, dto);

    const [{ removedReferenceKeys }, last] = await Promise.all([
      this.publicationModel.findById(publicationId).select('+removedReferenceKeys').lean().orFail(),
      this.referenceModel.findOne({ citing: publicationId }).sort({ position: -1 }).select('position').lean(),
    ]);
    draft.position = (last?.position ?? -1) + 1;
    const key = makeReferenceKey({ ...draft.snapshot, raw: draft.raw });

    try {
      const created = await this.referenceModel.create(this.toDocument(publicationId, key, draft));
      // re-adding something previously deleted: sync may manage it again
      if (removedReferenceKeys?.includes(key)) {
        await this.publicationModel.updateOne({ _id: publicationId }, { $pull: { removedReferenceKeys: key } });
      }
      if (created.cited) await this.refreshCitationCounts([created.cited]);
      return created.toObject();
    } catch (err) {
      this.rethrowDuplicate(err);
    }
  }

  /** Editing locks the reference so a re-sync can never overwrite it. */
  async update(me: string, publicationId: string, refId: string, dto: UpdateReferenceDto) {
    await this.publicationsService.findOwned(me, publicationId);
    const ref = await this.findEdge(publicationId, refId);

    const snapshot: ReferenceSnapshot = { ...ref.snapshot };
    if (dto.title !== undefined) snapshot.title = dto.title;
    if (dto.authors !== undefined) snapshot.authors = dto.authors;
    if (dto.year !== undefined) snapshot.year = dto.year;
    if (dto.venue !== undefined) snapshot.venue = dto.venue;
    if (dto.doi !== undefined) snapshot.doi = normalizeDoi(dto.doi);
    const raw = dto.raw ?? ref.raw;

    const key = makeReferenceKey({ ...snapshot, raw });
    const resolved = ref.cited ? null : await this.matchLocal([snapshot], publicationId);
    const citedId = ref.cited ?? this.lookup(resolved, snapshot);

    try {
      await this.referenceModel.updateOne(
        { _id: refId },
        {
          $set: {
            snapshot,
            raw,
            key,
            locked: true,
            ...(citedId && { cited: citedId, status: ReferenceStatus.RESOLVED }),
          },
        },
      );
    } catch (err) {
      this.rethrowDuplicate(err);
    }

    // the provider's original entry must not reappear on the next sync
    if (key !== ref.key && ref.source !== ReferenceSource.MANUAL) {
      await this.publicationModel.updateOne({ _id: publicationId }, { $addToSet: { removedReferenceKeys: ref.key } });
    }
    if (citedId) await this.refreshCitationCounts([citedId]);
    return this.referenceModel.findById(refId).populate('cited', WORK_CARD_FIELDS).lean();
  }

  async remove(me: string, publicationId: string, refId: string) {
    await this.publicationsService.findOwned(me, publicationId);
    const ref = await this.findEdge(publicationId, refId);
    await this.referenceModel.deleteOne({ _id: refId });

    // synced entries are remembered, otherwise the next sync would add them back
    if (ref.source === ReferenceSource.OPENALEX || ref.source === ReferenceSource.CROSSREF) {
      await this.publicationModel.updateOne({ _id: publicationId }, { $addToSet: { removedReferenceKeys: ref.key } });
    }
    if (ref.cited) await this.refreshCitationCounts([ref.cited]);
    return { deleted: true };
  }

  /** Paste BibTeX, or plain text with one reference per line. Existing keys are skipped. */
  async importReferences(me: string, publicationId: string, dto: ImportReferencesDto) {
    await this.publicationsService.findOwned(me, publicationId);

    const last = await this.referenceModel
      .findOne({ citing: publicationId })
      .sort({ position: -1 })
      .select('position')
      .lean();
    let position = (last?.position ?? -1) + 1;

    const drafts: ReferenceDraft[] =
      dto.format === 'bibtex'
        ? parseBibtex(dto.content).map((e) => ({
            snapshot: {
              title: e.title,
              authors: e.author ? e.author.split(/\s+and\s+/i).map((a) => a.trim()) : undefined,
              year: parseInt(e.year, 10) || undefined,
              doi: normalizeDoi(e.doi),
              venue: e.journal || e.booktitle || e.publisher,
            },
            source: ReferenceSource.BIBTEX,
            locked: true,
            position: position++,
          }))
        : dto.content
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean)
            .map((line) => ({
              snapshot: { doi: normalizeDoi(line.match(/10\.\d{4,9}\/\S+/)?.[0]?.replace(/[.,;)]+$/, '')) },
              raw: line,
              source: ReferenceSource.MANUAL,
              locked: true,
              position: position++,
            }));

    const usable = drafts.filter((d) => d.snapshot.title || d.snapshot.doi || d.raw);
    if (!usable.length) throw new BadRequestException('No references found in the pasted content.');

    const result = await this.writeDrafts(publicationId, usable);
    return { found: usable.length, added: result.added };
  }

  // ---------------- OPENALEX SYNC ----------------

  /** "Refresh from OpenAlex": adds missing references, never touches locked or deleted ones. */
  async syncFromOpenAlex(me: string, publicationId: string) {
    await this.publicationsService.findOwned(me, publicationId);
    return this.runOpenAlexSync(publicationId);
  }

  /**
   * Called after a publication is created or its identifiers change: links references that
   * were waiting for it, and pulls its own reference list when it has a DOI/OpenAlex id.
   * Never throws; this runs in the background of the request.
   */
  async onPublicationSaved(publicationId: string) {
    try {
      await this.resolveInbound(publicationId);
      const pub = await this.publicationModel.findById(publicationId).select('identifiers').lean();
      if (pub?.identifiers?.doi || pub?.identifiers?.openalexId) {
        await this.runOpenAlexSync(publicationId);
      }
    } catch (err) {
      this.logger.warn(`Reference sync for ${publicationId} failed: ${(err as Error).message}`);
    }
  }

  /** Links references from other publications that were waiting for this one. Never throws. */
  async linkIncoming(publicationId: string) {
    try {
      await this.resolveInbound(publicationId);
    } catch (err) {
      this.logger.warn(`Linking references to ${publicationId} failed: ${(err as Error).message}`);
    }
  }

  private async runOpenAlexSync(publicationId: string) {
    const pub = await this.publicationModel
      .findById(publicationId)
      .select('identifiers +removedReferenceKeys')
      .lean();
    if (!pub) throw new NotFoundException('Publication not found.');

    const openalexId = shortOpenAlexId(pub.identifiers?.openalexId);
    const doi = normalizeDoi(pub.identifiers?.doi);
    if (!openalexId && !doi) {
      throw new BadRequestException('Add a DOI or OpenAlex id to the publication to sync references.');
    }

    const work = await this.openAlex<{ id: string; referenced_works?: string[] }>(
      openalexId ? `/works/${openalexId}` : `/works/https://doi.org/${doi}`,
    );
    if (!work) throw new NotFoundException('This work was not found in OpenAlex.');

    if (!openalexId) {
      await this.publicationModel.updateOne(
        { _id: publicationId },
        { $set: { 'identifiers.openalexId': shortOpenAlexId(work.id) } },
      );
    }

    const refIds = (work.referenced_works ?? []).map((id) => shortOpenAlexId(id)!);
    const details = await this.fetchOpenAlexWorks(refIds);
    const removed = new Set(pub.removedReferenceKeys ?? []);

    const drafts: ReferenceDraft[] = refIds.map((id, position) => ({
      snapshot: details.get(id) ?? { openalexId: id },
      source: ReferenceSource.OPENALEX,
      locked: false,
      position,
    }));
    const wanted = drafts.filter((d) => !removed.has(makeReferenceKey(d.snapshot)));

    const result = await this.writeDrafts(publicationId, wanted);
    return {
      total: refIds.length,
      added: result.added,
      skippedDeleted: drafts.length - wanted.length,
    };
  }

  /** Metadata for many works at once: `filter=openalex:W1|W2|...`, 100 ids per call. */
  private async fetchOpenAlexWorks(ids: string[]) {
    const out = new Map<string, ReferenceSnapshot>();
    for (let i = 0; i < ids.length; i += OPENALEX_BATCH) {
      const batch = ids.slice(i, i + OPENALEX_BATCH);
      const res = await this.openAlex<{ results: OpenAlexWork[] }>('/works', {
        filter: `openalex:${batch.join('|')}`,
        'per-page': String(OPENALEX_BATCH),
        select: 'id,doi,title,publication_year,authorships,primary_location',
      });
      for (const w of res?.results ?? []) {
        const id = shortOpenAlexId(w.id)!;
        out.set(id, {
          openalexId: id,
          doi: normalizeDoi(w.doi),
          title: w.title ?? undefined,
          year: w.publication_year ?? undefined,
          authors: w.authorships?.map((a) => a.author?.display_name).filter(Boolean) as string[],
          venue: w.primary_location?.source?.display_name ?? undefined,
        });
      }
    }
    return out;
  }

  /** Shared with the DOI importer. Returns null on 404. */
  async openAlex<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
    const url = new URL(OPENALEX_URL + path);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const mailto = this.config.get<string>('OPENALEX_MAILTO');
    if (mailto) url.searchParams.set('mailto', mailto);

    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    } catch {
      throw new BadGatewayException('Could not reach OpenAlex.');
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new BadGatewayException(`OpenAlex responded with ${res.status}.`);
    return (await res.json()) as T;
  }

  // ---------------- SHARED WRITE LOGIC ----------------

  /**
   * Matches drafts to local publications, then upserts by {citing, key}. `$setOnInsert` means
   * existing edges (locked, edited or already synced) are never overwritten, so it is idempotent.
   */
  private async writeDrafts(publicationId: string, drafts: ReferenceDraft[]) {
    if (!drafts.length) return { added: 0 };
    const local = await this.matchLocal(
      drafts.map((d) => d.snapshot),
      publicationId,
    );

    const ops = drafts.map((d) => {
      const citedId = d.citedId ?? this.lookup(local, d.snapshot);
      const key = makeReferenceKey({ ...d.snapshot, raw: d.raw });
      // citing/key come from the filter on insert
      const { citing: _citing, key: _key, ...fields } = this.toDocument(publicationId, key, { ...d, citedId });
      return {
        updateOne: {
          filter: { citing: new Types.ObjectId(publicationId), key },
          update: { $setOnInsert: fields },
          upsert: true,
        },
      };
    });

    const res = await this.referenceModel.bulkWrite(ops, { ordered: false });
    const cited = drafts
      .map((d) => d.citedId ?? this.lookup(local, d.snapshot))
      .filter((id): id is Types.ObjectId => !!id);
    if (cited.length) await this.refreshCitationCounts(cited);
    return { added: res.upsertedCount };
  }

  private toDocument(publicationId: string, key: string, d: ReferenceDraft) {
    return {
      citing: publicationId,
      cited: d.citedId ?? null,
      key,
      position: d.position,
      raw: d.raw,
      snapshot: d.snapshot,
      source: d.source,
      locked: d.locked,
      status: d.citedId ? ReferenceStatus.RESOLVED : ReferenceStatus.UNRESOLVED,
    };
  }

  /** Turns manual input into a draft; a given scholarNet id (or matching DOI) becomes resolved. */
  private async draftFromInput(publicationId: string, dto: CreateReferenceDto): Promise<ReferenceDraft> {
    let snapshot: ReferenceSnapshot = {
      title: dto.title?.trim(),
      authors: dto.authors,
      year: dto.year,
      doi: normalizeDoi(dto.doi),
      venue: dto.venue,
    };
    let citedId: Types.ObjectId | undefined;

    if (dto.citedPublicationId) {
      if (dto.citedPublicationId === publicationId) {
        throw new BadRequestException('A publication cannot cite itself.');
      }
      const target = await this.publicationModel
        .findById(dto.citedPublicationId)
        .select('title year authors identifiers')
        .lean();
      if (!target) throw new NotFoundException('The cited publication was not found.');
      citedId = target._id as Types.ObjectId;
      snapshot = {
        title: target.title,
        authors: target.authors.map((a) => a.name),
        year: target.year,
        doi: normalizeDoi(target.identifiers?.doi),
        openalexId: shortOpenAlexId(target.identifiers?.openalexId),
      };
    } else if (!snapshot.title && !snapshot.doi && !dto.raw) {
      throw new BadRequestException('Provide a publication id, a DOI, a title or a raw citation.');
    }

    return { snapshot, raw: dto.raw, source: ReferenceSource.MANUAL, locked: true, position: 0, citedId };
  }

  // ---------------- MATCHING & COUNTS ----------------

  /** Finds scholarNet publications matching these snapshots by DOI or OpenAlex id. */
  private async matchLocal(snapshots: ReferenceSnapshot[], excludeId: string) {
    const dois = [...new Set(snapshots.map((s) => normalizeDoi(s.doi)).filter(Boolean))] as string[];
    const oaIds = [...new Set(snapshots.map((s) => shortOpenAlexId(s.openalexId)).filter(Boolean))] as string[];
    const byDoi = new Map<string, Types.ObjectId>();
    const byOa = new Map<string, Types.ObjectId>();
    if (!dois.length && !oaIds.length) return { byDoi, byOa };

    const found = await this.publicationModel
      .find({
        _id: { $ne: excludeId },
        $or: [{ 'identifiers.doi': { $in: dois } }, { 'identifiers.openalexId': { $in: oaIds } }],
      })
      .select('identifiers')
      .lean();
    for (const p of found) {
      const doi = normalizeDoi(p.identifiers?.doi);
      const oa = shortOpenAlexId(p.identifiers?.openalexId);
      if (doi) byDoi.set(doi, p._id as Types.ObjectId);
      if (oa) byOa.set(oa, p._id as Types.ObjectId);
    }
    return { byDoi, byOa };
  }

  private lookup(
    local: { byDoi: Map<string, Types.ObjectId>; byOa: Map<string, Types.ObjectId> } | null,
    s: ReferenceSnapshot,
  ) {
    if (!local) return undefined;
    const doi = normalizeDoi(s.doi);
    const oa = shortOpenAlexId(s.openalexId);
    return (doi && local.byDoi.get(doi)) || (oa && local.byOa.get(oa)) || undefined;
  }

  /** References from other publications that were waiting for this one to exist. */
  private async resolveInbound(publicationId: string) {
    const pub = await this.publicationModel.findById(publicationId).select('identifiers').lean();
    if (!pub) return;
    const doi = normalizeDoi(pub.identifiers?.doi);
    const oa = shortOpenAlexId(pub.identifiers?.openalexId);
    const or = [
      ...(doi ? [{ 'snapshot.doi': doi }] : []),
      ...(oa ? [{ 'snapshot.openalexId': oa }] : []),
    ];
    if (!or.length) return;

    const res = await this.referenceModel.updateMany(
      { cited: null, citing: { $ne: publicationId }, $or: or },
      { $set: { cited: publicationId, status: ReferenceStatus.RESOLVED } },
    );
    if (res.modifiedCount) await this.refreshCitationCounts([new Types.ObjectId(publicationId)]);
  }

  /** Keeps the denormalised `metrics.citations` equal to the number of incoming edges. */
  async refreshCitationCounts(ids: (Types.ObjectId | string)[]) {
    const unique = [...new Set(ids.map(String))].map((id) => new Types.ObjectId(id));
    if (!unique.length) return;
    const counts = await this.referenceModel.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { cited: { $in: unique } } },
      { $group: { _id: '$cited', n: { $sum: 1 } } },
    ]);
    const byId = new Map(counts.map((c) => [String(c._id), c.n]));
    await this.publicationModel.bulkWrite(
      unique.map((id) => ({
        updateOne: {
          filter: { _id: id },
          update: { $set: { 'metrics.citations': byId.get(String(id)) ?? 0 } },
        },
      })),
    );
    // citation totals / h-index on the owners' profiles depend on these counts
    const owners = await this.publicationModel.distinct('uploadedBy', { _id: { $in: unique } });
    await Promise.all(owners.map((owner) => this.publicationsService.recomputeStats(owner)));
  }

  // ---------------- HELPERS ----------------

  private async findEdge(publicationId: string, refId: string) {
    if (!Types.ObjectId.isValid(refId)) throw new BadRequestException('Invalid reference id.');
    const ref = await this.referenceModel.findOne({ _id: refId, citing: publicationId }).lean();
    if (!ref) throw new NotFoundException('Reference not found.');
    return ref;
  }

  private rethrowDuplicate(err: unknown): never {
    if ((err as { code?: number })?.code === 11000) {
      throw new ConflictException('This reference is already in the list.');
    }
    throw err;
  }
}

interface OpenAlexWork {
  id: string;
  doi?: string | null;
  title?: string | null;
  publication_year?: number | null;
  authorships?: { author?: { display_name?: string } }[];
  primary_location?: { source?: { display_name?: string } | null } | null;
}
