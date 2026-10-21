import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Publication, AuthorStatus } from './schemas/publication.schema';
import { User } from '../users/schema/user.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification-type.enum';
import { PublicationsService } from './publications.service';
import { AddAuthorDto, UpdateAuthorDto } from './dto/publication-author.dto';
import { MAX_AUTHORS, assertNoDuplicates, authorStatus } from './author.util';

const USER_CARD_FIELDS = 'firstName lastName username profilePhotoUrl';

/**
 * Author list of one publication. The uploader manages it; a listed member answers an invitation
 * (accept / decline) or leaves. Every write is a single atomic update on the array element, so two
 * people answering at the same time cannot overwrite each other.
 */
@Injectable()
export class PublicationAuthorsService {
  constructor(
    @InjectModel(Publication.name) private publicationModel: Model<Publication>,
    @InjectModel(User.name) private userModel: Model<User>,
    private publicationsService: PublicationsService,
    private notificationsService: NotificationsService,
  ) {}

  // ---------------- INVITATIONS ----------------

  /** Tells every invited member (not the uploader) that they were listed. Never blocks the caller. */
  async notifyInvites(me: string, publicationId: string) {
    const pub = await this.publicationModel.findById(publicationId).select('title authors').lean();
    if (!pub) return;
    const name = await this.displayName(me);
    await Promise.all(
      pub.authors
        .filter((a) => a.user && authorStatus(a) === AuthorStatus.PENDING)
        .map((a) => this.invite(me, name, publicationId, pub.title, a.user!)),
    );
  }

  /** Publications where I am listed and have not answered yet. */
  async invitations(me: string, page: number, limit: number, skip: number) {
    const filter = { authors: { $elemMatch: { user: new Types.ObjectId(me), status: AuthorStatus.PENDING } } };
    const [data, total] = await Promise.all([
      this.publicationModel
        .find(filter)
        .select('title type year authors uploadedBy createdAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('uploadedBy', USER_CARD_FIELDS)
        .lean(),
      this.publicationModel.countDocuments(filter),
    ]);
    return { data, total, page, limit };
  }

  // ---------------- UPLOADER: MANAGE THE LIST ----------------

  async add(me: string, publicationId: string, dto: AddAuthorDto) {
    const pub = await this.publicationsService.findOwned(me, publicationId);
    if (pub.authors.length >= MAX_AUTHORS) {
      throw new BadRequestException(`A publication can have at most ${MAX_AUTHORS} authors.`);
    }
    assertNoDuplicates([...pub.authors, dto]);

    let name = dto.name?.trim() ?? '';
    if (dto.user) {
      const user = await this.userModel.findById(dto.user).select('firstName lastName').lean();
      if (!user) throw new BadRequestException('Unknown user.');
      name ||= `${user.firstName} ${user.lastName}`.trim();
    }
    const status =
      !dto.user || dto.user === me ? AuthorStatus.CONFIRMED : AuthorStatus.PENDING;
    const entry = {
      ...(dto.user && { user: new Types.ObjectId(dto.user) }),
      name,
      affiliation: dto.affiliation,
      orcid: dto.orcid,
      isCorresponding: dto.isCorresponding ?? false,
      order: pub.authors.reduce((max, a) => Math.max(max, a.order), -1) + 1,
      status,
      confirmed: status === AuthorStatus.CONFIRMED,
    };

    await this.publicationModel.updateOne({ _id: publicationId, type: pub.type }, { $push: { authors: entry } });

    const full = await this.publicationModel.findById(publicationId).select('title').lean();
    if (status === AuthorStatus.PENDING && dto.user) {
      await this.invite(me, await this.displayName(me), publicationId, full?.title ?? '', dto.user);
    }
    return this.view(publicationId);
  }

  /** The uploader edits any entry; a listed member edits only their own details. */
  async update(me: string, publicationId: string, authorId: string, dto: UpdateAuthorDto) {
    this.assertId(authorId);
    const pub = await this.getAuthors(publicationId);
    const entry = pub.authors.find((a) => String(a._id) === authorId);
    if (!entry) throw new NotFoundException('Author not found.');

    const isOwner = String(pub.uploadedBy) === me;
    const isSelf = !!entry.user && String(entry.user) === me;
    if (!isOwner && !isSelf) throw new ForbiddenException('You cannot edit this author.');
    if (!isOwner && dto.isCorresponding !== undefined) {
      throw new ForbiddenException('Only the uploader can set the corresponding author.');
    }

    assertNoDuplicates(
      pub.authors.map((a) => (String(a._id) === authorId ? { ...a, orcid: dto.orcid ?? a.orcid } : a)),
    );

    const set: Record<string, unknown> = {};
    const unset: Record<string, 1> = {};
    for (const [key, value] of Object.entries(dto)) {
      if (value === undefined) continue;
      // an empty string clears an optional detail; the name can never be empty
      if (value === '' && key !== 'name') unset[`authors.$[a].${key}`] = 1;
      else if (value === '') throw new BadRequestException('name cannot be empty.');
      else set[`authors.$[a].${key}`] = typeof value === 'string' ? value.trim() : value;
    }
    if (!Object.keys(set).length && !Object.keys(unset).length) {
      throw new BadRequestException('Nothing to update.');
    }

    await this.publicationModel.updateOne(
      { _id: publicationId, type: pub.type },
      {
        ...(Object.keys(set).length && { $set: set }),
        ...(Object.keys(unset).length && { $unset: unset }),
      },
      { arrayFilters: [{ 'a._id': new Types.ObjectId(authorId) }] },
    );
    return this.view(publicationId);
  }

  /** `order` must contain every author `_id` exactly once. */
  async reorder(me: string, publicationId: string, order: string[]) {
    const pub = await this.publicationsService.findOwned(me, publicationId);
    const ids = pub.authors.map((a) => String(a._id));
    if (order.length !== ids.length || new Set(order).size !== ids.length || order.some((id) => !ids.includes(id))) {
      throw new BadRequestException('order must list every author exactly once.');
    }

    // one positional update per author instead of rewriting the array, so a concurrent
    // accept / decline is not overwritten
    const set: Record<string, number> = {};
    order.forEach((_, i) => (set[`authors.$[a${i}].order`] = i));
    await this.publicationModel.updateOne(
      { _id: publicationId, type: pub.type },
      { $set: set },
      { arrayFilters: order.map((id, i) => ({ [`a${i}._id`]: new Types.ObjectId(id) })) },
    );
    return this.view(publicationId);
  }

  /** The uploader removes anyone; a listed member removes themselves (leave). */
  async remove(me: string, publicationId: string, authorId: string) {
    this.assertId(authorId);
    const pub = await this.getAuthors(publicationId);
    const entry = pub.authors.find((a) => String(a._id) === authorId);
    if (!entry) throw new NotFoundException('Author not found.');

    const isOwner = String(pub.uploadedBy) === me;
    const isSelf = !!entry.user && String(entry.user) === me;
    if (!isOwner && !isSelf) throw new ForbiddenException('You cannot remove this author.');

    // `authors.1` exists = at least two entries, so the last author can never be removed
    const res = await this.publicationModel.updateOne(
      { _id: publicationId, 'authors.1': { $exists: true } },
      { $pull: { authors: { _id: new Types.ObjectId(authorId) } } },
    );
    if (!res.modifiedCount) throw new BadRequestException('A publication needs at least one author.');

    if (entry.user) {
      await this.publicationsService.recomputeStats(entry.user);
      const name = await this.displayName(me);
      // whoever did not do it hears about it
      const recipient = isSelf ? pub.uploadedBy : entry.user;
      await this.notificationsService.create({
        recipientId: recipient,
        actorId: me,
        type: NotificationType.PUBLICATION_AUTHOR_REMOVED,
        message: isSelf
          ? `${name} left the authors of "${pub.title}"`
          : `${name} removed you from the authors of "${pub.title}"`,
        entityType: 'publication',
        entityId: publicationId,
      });
    }
    return this.view(publicationId);
  }

  // ---------------- LISTED MEMBER: ANSWER ----------------

  accept(me: string, publicationId: string) {
    return this.respond(me, publicationId, true);
  }

  decline(me: string, publicationId: string) {
    return this.respond(me, publicationId, false);
  }

  private async respond(me: string, publicationId: string, accept: boolean) {
    const pub = await this.getAuthors(publicationId);
    const mine = pub.authors.find((a) => a.user && String(a.user) === me);
    if (!mine) throw new NotFoundException('You are not listed as an author of this publication.');

    const target = accept ? AuthorStatus.CONFIRMED : AuthorStatus.DECLINED;
    if (authorStatus(mine) === target) throw new ConflictException(`You already ${target} this authorship.`);

    // the filter makes a double click (or a race with a removal) update nothing
    const res = await this.publicationModel.updateOne(
      {
        _id: publicationId,
        authors: { $elemMatch: { user: new Types.ObjectId(me), status: { $ne: target } } },
      },
      {
        $set: {
          'authors.$.status': target,
          'authors.$.confirmed': accept,
          'authors.$.respondedAt': new Date(),
        },
      },
    );
    if (!res.matchedCount) throw new ConflictException('Your authorship changed, please reload.');

    await this.publicationsService.recomputeStats(me);
    const name = await this.displayName(me);
    await this.notificationsService.create({
      recipientId: pub.uploadedBy,
      actorId: me,
      type: accept ? NotificationType.PUBLICATION_AUTHOR_ACCEPTED : NotificationType.PUBLICATION_AUTHOR_DECLINED,
      message: `${name} ${accept ? 'confirmed' : 'declined'} authorship of "${pub.title}"`,
      entityType: 'publication',
      entityId: publicationId,
    });
    return this.view(publicationId);
  }

  // ---------------- HELPERS ----------------

  private invite(me: string, actorName: string, publicationId: string, title: string, user: Types.ObjectId | string) {
    return this.notificationsService.create({
      recipientId: user,
      actorId: me,
      type: NotificationType.PUBLICATION_AUTHOR_INVITE,
      message: `${actorName} listed you as an author of "${title}"`,
      entityType: 'publication',
      entityId: publicationId,
    });
  }

  /** The author list and just enough to authorize and notify; fails for unknown ids. */
  private async getAuthors(publicationId: string) {
    this.assertId(publicationId);
    const pub = await this.publicationModel.findById(publicationId).select('title type uploadedBy authors').lean();
    if (!pub) throw new NotFoundException('Publication not found.');
    return pub;
  }

  private async view(publicationId: string) {
    const pub = await this.publicationModel.findById(publicationId).select('authors').lean();
    return { authors: pub?.authors ?? [] };
  }

  private async displayName(userId: string) {
    const user = await this.userModel.findById(userId).select('firstName lastName').lean();
    return user ? `${user.firstName} ${user.lastName}`.trim() : 'Someone';
  }

  private assertId(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid id.');
  }
}
