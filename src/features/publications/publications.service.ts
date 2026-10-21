import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { QueryFilter, Model, Types } from 'mongoose';
import { PublicationType } from 'src/common/enums/publication-type.enum';
import { Publication, PublicationVisibility, AuthorStatus } from './schemas/publication.schema';
import { User } from '../users/schema/user.schema';
import { authoredBy, buildAuthors, isConfirmedAuthor, listedAuthor, statUsers } from './author.util';
import { PublicationReference, ReferenceStatus } from './schemas/publication-reference.schema';
import { Follow } from '../follows/schemas/follow.schema';
import { Profile } from '../profile/schemas/profile.schema';
import { CreatePublicationDto } from './dto/create-publication.dto';
import { UpdatePublicationDto } from './dto/update-publication.dto';

const USER_CARD_FIELDS = 'firstName lastName username profilePhotoUrl';
/** Never send where a file is stored on disk. */
const PUBLIC_PROJECTION = '-files.storageKey';

/** Fields a client may never set directly (managed by the server or by other endpoints). */
const PROTECTED_FIELDS = [
  '_id',
  'type',
  'uploadedBy',
  'metrics',
  'files',
  'createdAt',
  'updatedAt',
  '__v',
];

export interface PublicationQuery {
  page: number;
  limit: number;
  skip: number;
  q?: string;
  type?: PublicationType;
  yearFrom?: number;
  yearTo?: number;
  field?: string;
  keyword?: string;
  authorId?: string;
}

@Injectable()
export class PublicationsService {
  constructor(
    @InjectModel(Publication.name) private publicationModel: Model<Publication>,
    @InjectModel(Follow.name) private followModel: Model<Follow>,
    @InjectModel(PublicationReference.name) private referenceModel: Model<PublicationReference>,
    @InjectModel(Profile.name) private profileModel: Model<Profile>,
    @InjectModel(User.name) private userModel: Model<User>,
  ) {}

  // ---------------- CREATE ----------------

  async create(me: string, dto: CreatePublicationDto) {
    const data = this.stripProtected({ ...dto });
    for (const key of Object.keys(data)) if (this.isBlank(data[key])) delete data[key];
    const doc = {
      ...data,
      type: dto.type,
      uploadedBy: me,
      authors: await this.buildAuthorList(dto.authors, me),
      ...(dto.identifiers && { identifiers: this.normalizeIdentifiers(dto.identifiers) }),
    };

    try {
      // the base model picks the right discriminator from `type`
      const created = await this.publicationModel.create(doc);
      await this.recomputeStats(me);
      return this.getOwnedView(created._id);
    } catch (err) {
      this.rethrowDuplicate(err);
    }
  }

  // ---------------- READ ----------------

  /** Search / browse everything the viewer is allowed to see. */
  async search(me: string, query: PublicationQuery) {
    const visible = await this.visibleTo(me);
    return this.page({ $and: [visible, this.buildFilters(query)] }, query, me);
  }

  /** Everything I uploaded, including private ones. */
  async getMine(me: string, query: PublicationQuery) {
    return this.page({ $and: [{ uploadedBy: me }, this.buildFilters(query)] }, query, me);
  }

  /** A user's publications as seen by the viewer (profile page). */
  async getByUser(me: string, userId: string, query: PublicationQuery) {
    this.assertId(userId, 'user');
    const visible = await this.visibleTo(me);
    return this.page(
      {
        $and: [
          visible,
          authoredBy(userId),
          this.buildFilters(query),
        ],
      },
      query,
      me,
    );
  }

  async getOne(me: string, id: string) {
    this.assertId(id, 'publication');
    const visible = await this.visibleTo(me);
    const pub = await this.publicationModel
      .findOne({ $and: [{ _id: id }, visible] })
      .select(PUBLIC_PROJECTION)
      .populate('uploadedBy', USER_CARD_FIELDS)
      .lean();
    if (!pub) throw new NotFoundException('Publication not found.');

    // owners opening their own page should not inflate the numbers
    const ownerId = String((pub.uploadedBy as { _id?: Types.ObjectId })._id ?? pub.uploadedBy);
    if (ownerId !== me) {
      await this.publicationModel.updateOne({ _id: id }, { $inc: { 'metrics.views': 1 } });
      pub.metrics = { ...pub.metrics, views: (pub.metrics?.views ?? 0) + 1 };
    }
    return this.hideDeclined(pub, me);
  }

  // ---------------- UPDATE ----------------

  /**
   * The uploader and confirmed co-authors can edit. Co-authors cannot change visibility.
   * `type` cannot change and the author list has its own endpoints.
   */
  async update(me: string, id: string, dto: UpdatePublicationDto) {
    const existing = await this.findEditable(me, id);
    if (existing.role === 'coauthor' && dto.visibility !== undefined) {
      throw new ForbiddenException('Only the uploader can change visibility.');
    }

    const changes: Record<string, unknown> = this.stripProtected({ ...dto }, ['authors']);
    if (dto.identifiers) changes.identifiers = this.normalizeIdentifiers(dto.identifiers);

    // null / "" from the form means "clear this field"
    const unset: Record<string, 1> = {};
    for (const key of Object.keys(changes)) {
      if (this.isBlank(changes[key])) {
        unset[key] = 1;
        delete changes[key];
      }
    }
    if (!Object.keys(changes).length && !Object.keys(unset).length) {
      throw new BadRequestException('Nothing to update.');
    }

    try {
      // `type` in the filter makes Mongoose cast/validate against that type's discriminator
      await this.publicationModel.updateOne(
        { _id: id, type: existing.type },
        {
          ...(Object.keys(changes).length && { $set: changes }),
          ...(Object.keys(unset).length && { $unset: unset }),
        },
        { runValidators: true },
      );
    } catch (err) {
      this.rethrowDuplicate(err);
    }
    if ('year' in changes) await this.recomputeStatsFor(existing);
    return this.getOwnedView(existing._id);
  }

  // ---------------- DELETE ----------------

  async remove(me: string, id: string) {
    const pub = await this.findOwned(me, id);
    await Promise.all([
      this.publicationModel.deleteOne({ _id: id }),
      // its own reference list goes away; edges from others that pointed here become unresolved
      this.referenceModel.deleteMany({ citing: id }),
      this.referenceModel.updateMany(
        { cited: id },
        { $set: { cited: null, status: ReferenceStatus.UNRESOLVED } },
      ),
    ]);
    // publications that this one cited lose an incoming edge; co-authors lose the paper too
    await this.recomputeStatsFor(pub);
    return { deleted: true };
  }

  // ---------------- PROFILE STATS ----------------

  /**
   * Rebuilds the cached numbers on the owner's profile (publication count, citations, h-index,
   * i10-index, per-year counts) so a profile read never has to touch the publications collection.
   * Call after anything that adds/removes a publication or changes its citation count.
   */
  async recomputeStats(userId: string | Types.ObjectId) {
    const pubs = await this.publicationModel
      .find(authoredBy(userId))
      .select('year metrics.citations')
      .lean();

    const cites = pubs.map((p) => p.metrics?.citations ?? 0).sort((a, b) => b - a);
    const yearly = new Map<number, number>();
    for (const p of pubs) yearly.set(p.year, (yearly.get(p.year) ?? 0) + 1);

    await this.profileModel.updateOne(
      { user: userId },
      {
        $set: {
          publicationCount: pubs.length,
          citationCount: cites.reduce((sum, c) => sum + c, 0),
          hIndex: cites.filter((c, i) => c >= i + 1).length,
          i10Index: cites.filter((c) => c >= 10).length,
          yearlyPublications: [...yearly]
            .map(([year, count]) => ({ year, count }))
            .sort((a, b) => a.year - b.year),
        },
      },
    );
  }

  /** Refreshes the cached stats of the uploader and every confirmed co-author. */
  async recomputeStatsFor(pub: { uploadedBy: unknown; authors?: Publication['authors'] }) {
    await Promise.all(statUsers(pub).map((uid) => this.recomputeStats(uid)));
  }

  /** Storage keys of an owned publication's files (the controller deletes them from storage). */
  async fileKeys(me: string, id: string) {
    await this.findOwned(me, id);
    const pub = await this.publicationModel.findById(id).select('files.storageKey').lean();
    return (pub?.files ?? []).map((f) => ({ storageKey: f.storageKey }));
  }

  /** Throws unless the viewer is allowed to see this publication. */
  async assertCanView(me: string, id: string) {
    this.assertId(id, 'publication');
    const visible = await this.visibleTo(me);
    const exists = await this.publicationModel.exists({ $and: [{ _id: id }, visible] });
    if (!exists) throw new NotFoundException('Publication not found.');
  }

  // ---------------- HELPERS ----------------

  async findOwned(me: string, id: string) {
    this.assertId(id, 'publication');
    const pub = await this.publicationModel.findById(id).select('uploadedBy type authors').lean();
    if (!pub) throw new NotFoundException('Publication not found.');
    if (String(pub.uploadedBy) !== me) {
      throw new ForbiddenException('You can only modify your own publications.');
    }
    return pub;
  }

  /** Uploader or confirmed co-author; says which one so callers can narrow what is allowed. */
  async findEditable(me: string, id: string) {
    this.assertId(id, 'publication');
    const pub = await this.publicationModel.findById(id).select('uploadedBy type authors').lean();
    if (!pub) throw new NotFoundException('Publication not found.');
    if (String(pub.uploadedBy) === me) return { ...pub, role: 'owner' as const };
    const isCoauthor = pub.authors.some((a) => String(a.user) === me && isConfirmedAuthor(a));
    if (!isCoauthor) throw new ForbiddenException('Only the uploader or a confirmed co-author can edit.');
    return { ...pub, role: 'coauthor' as const };
  }

  private getOwnedView(id: Types.ObjectId | string) {
    return this.publicationModel
      .findById(id)
      .select(PUBLIC_PROJECTION)
      .populate('uploadedBy', USER_CARD_FIELDS)
      .lean();
  }

  /** Public ones, my own, and followers-only ones from people I follow. */
  async visibleTo(me: string): Promise<QueryFilter<Publication>> {
    const following = await this.followModel.find({ follower: me }).select('following').lean();
    return {
      $or: [
        { visibility: PublicationVisibility.PUBLIC },
        { uploadedBy: me },
        // listed authors can open it even when private, so they can accept or decline
        listedAuthor(me),
        {
          visibility: PublicationVisibility.FOLLOWERS,
          uploadedBy: { $in: following.map((f) => f.following) },
        },
      ],
    };
  }

  private buildFilters(q: PublicationQuery): QueryFilter<Publication> {
    const filter: QueryFilter<Publication> = {};
    if (q.q?.trim()) filter.$text = { $search: q.q.trim() };
    if (q.type) filter.type = q.type;
    if (q.field) filter.fields = q.field;
    if (q.keyword) filter.keywords = q.keyword;
    if (q.authorId) {
      this.assertId(q.authorId, 'author');
      filter['authors.user'] = new Types.ObjectId(q.authorId);
    }
    if (q.yearFrom || q.yearTo) {
      filter.year = {
        ...(q.yearFrom && { $gte: q.yearFrom }),
        ...(q.yearTo && { $lte: q.yearTo }),
      };
    }
    return filter;
  }

  private async page(filter: QueryFilter<Publication>, q: PublicationQuery, me: string) {
    const [data, total] = await Promise.all([
      this.publicationModel
        .find(filter)
        .select(PUBLIC_PROJECTION)
        .sort({ year: -1, createdAt: -1 })
        .skip(q.skip)
        .limit(q.limit)
        .populate('uploadedBy', USER_CARD_FIELDS)
        .lean(),
      this.publicationModel.countDocuments(filter),
    ]);
    return { data: data.map((p) => this.hideDeclined(p, me)), total, page: q.page, limit: q.limit };
  }

  /** Checks that linked users exist, then builds the stored list (see `buildAuthors`). */
  private async buildAuthorList(authors: CreatePublicationDto['authors'], me: string) {
    const ids = [...new Set(authors.flatMap((a) => (a.user ? [a.user] : [])))];
    const users = ids.length
      ? await this.userModel.find({ _id: { $in: ids } }).select('firstName lastName').lean()
      : [];
    if (users.length !== ids.length) throw new BadRequestException('An author refers to an unknown user.');
    const names = new Map(users.map((u) => [String(u._id), `${u.firstName} ${u.lastName}`.trim()]));
    return buildAuthors(authors, me, names);
  }

  /** Declined authors stay on the record but only the uploader sees them. */
  private hideDeclined<T extends { uploadedBy?: unknown; authors?: Publication['authors'] }>(
    pub: T,
    me: string,
  ): T {
    const owner = String((pub.uploadedBy as { _id?: unknown })?._id ?? pub.uploadedBy);
    if (owner === me || !pub.authors) return pub;
    return { ...pub, authors: pub.authors.filter((a) => a.status !== AuthorStatus.DECLINED) };
  }

  /** Lowercase DOI without the resolver URL, ISBN/ISSN without dashes; empty values dropped. */
  private normalizeIdentifiers(ids: object) {
    const out: Record<string, string> = {};
    for (const [key, raw] of Object.entries(ids as Record<string, string | undefined>)) {
      let value = raw?.trim();
      if (!value) continue;
      if (key === 'doi') value = value.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').toLowerCase();
      if (key === 'isbn' || key === 'issn') value = value.replace(/[\s-]/g, '');
      out[key] = value;
    }
    return out;
  }

  private isBlank(v: unknown) {
    return v === null || v === '';
  }

  private stripProtected<T extends Record<string, unknown>>(obj: T, extra: string[] = []): T {
    for (const key of [...PROTECTED_FIELDS, ...extra]) delete obj[key];
    return obj;
  }

  private rethrowDuplicate(err: unknown): never {
    if ((err as { code?: number })?.code === 11000) {
      throw new ConflictException('A publication with this DOI already exists.');
    }
    throw err;
  }

  private assertId(id: string, what: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException(`Invalid ${what} id.`);
  }
}
