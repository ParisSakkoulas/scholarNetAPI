import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PublicationAuthorDto } from './dto/create-publication.dto';
import { AuthorStatus, PublicationAuthor } from './schemas/publication.schema';

export const MAX_AUTHORS = 200;

/** Minimal shape needed to tell whether an author entry counts (works on lean documents). */
type AuthorLike = Pick<PublicationAuthor, 'status' | 'confirmed'>;

/** Entries written before `status` existed only have the `confirmed` flag. */
export function authorStatus(a: AuthorLike): AuthorStatus {
  return a.status ?? (a.confirmed ? AuthorStatus.CONFIRMED : AuthorStatus.PENDING);
}

export const isConfirmedAuthor = (a: AuthorLike) => authorStatus(a) === AuthorStatus.CONFIRMED;

/**
 * Publications that count for this user: the ones they uploaded plus the ones where they are
 * a listed author who has not declined or is still undecided. Shared by profile stats and
 * `PublicationsService.recomputeStats` so both agree.
 */
export function authoredBy(userId: string | Types.ObjectId) {
  const uid = new Types.ObjectId(String(userId));
  return {
    $or: [
      { uploadedBy: uid },
      {
        authors: {
          $elemMatch: {
            user: uid,
            status: { $nin: [AuthorStatus.PENDING, AuthorStatus.DECLINED] },
          },
        },
      },
    ],
  };
}

/** Users who may see/open the publication because they are listed on it (not declined). */
export function listedAuthor(userId: string | Types.ObjectId) {
  return {
    authors: {
      $elemMatch: { user: new Types.ObjectId(String(userId)), status: { $ne: AuthorStatus.DECLINED } },
    },
  };
}

/** Ids of every user whose cached profile stats depend on this publication. */
export function statUsers(pub: { uploadedBy: unknown; authors?: PublicationAuthor[] }): string[] {
  const ids = new Set<string>([String(pub.uploadedBy)]);
  for (const a of pub.authors ?? []) if (a.user && isConfirmedAuthor(a)) ids.add(String(a.user));
  return [...ids];
}

/** Rejects duplicate members / ORCIDs. Used for new author lists and for single additions. */
export function assertNoDuplicates(authors: { user?: string | Types.ObjectId | null; orcid?: string }[]) {
  const users = new Set<string>();
  const orcids = new Set<string>();
  for (const a of authors) {
    if (a.user) {
      if (users.has(String(a.user))) throw new BadRequestException('The same user is listed twice.');
      users.add(String(a.user));
    }
    if (a.orcid) {
      const key = a.orcid.toUpperCase();
      if (orcids.has(key)) throw new BadRequestException('The same ORCID is listed twice.');
      orcids.add(key);
    }
  }
}

/**
 * Builds the stored author list from client input.
 * - the uploader's own entry is confirmed; other members stay `pending` until they accept
 * - outside co-authors (no `user`) have nobody to confirm them, so they are `confirmed`
 * - order is rewritten as 0..n-1 (the client order is only a sort hint)
 * `names` maps user id -> display name, used when the client left `name` out.
 */
export function buildAuthors(
  authors: PublicationAuthorDto[],
  me: string,
  names: Map<string, string>,
) {
  assertNoDuplicates(authors);
  return authors
    .map((a, i) => ({ a, key: a.order ?? i, i }))
    .sort((x, y) => x.key - y.key || x.i - y.i)
    .map(({ a }, order) => {
      const status = !a.user || String(a.user) === me ? AuthorStatus.CONFIRMED : AuthorStatus.PENDING;
      return {
        ...(a.user && { user: new Types.ObjectId(a.user) }),
        name: (a.name?.trim() || (a.user && names.get(String(a.user))) || '').trim(),
        affiliation: a.affiliation,
        orcid: a.orcid,
        isCorresponding: a.isCorresponding ?? false,
        order,
        status,
        confirmed: status === AuthorStatus.CONFIRMED,
        ...(status === AuthorStatus.CONFIRMED && a.user && { respondedAt: new Date() }),
      };
    });
}
