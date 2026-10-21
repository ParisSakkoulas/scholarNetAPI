import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AuthorStatus } from './schemas/publication.schema';
import { authorStatus, buildAuthors, statUsers } from './author.util';

const me = new Types.ObjectId().toString();
const other = new Types.ObjectId().toString();

describe('buildAuthors', () => {
  const names = new Map([[other, 'Ada Lovelace']]);

  it('confirms the uploader and outside authors, keeps other members pending', () => {
    const out = buildAuthors(
      [{ user: me, name: 'Me' }, { user: other }, { name: 'External Person' }],
      me,
      names,
    );
    expect(out.map((a) => a.status)).toEqual([
      AuthorStatus.CONFIRMED,
      AuthorStatus.PENDING,
      AuthorStatus.CONFIRMED,
    ]);
    expect(out[1].name).toBe('Ada Lovelace'); // filled from the account
    expect(out[1].confirmed).toBe(false);
  });

  it('rewrites order as 0..n-1 following the client hint', () => {
    const out = buildAuthors([{ name: 'B', order: 5 }, { name: 'A', order: 1 }], me, names);
    expect(out.map((a) => [a.name, a.order])).toEqual([['A', 0], ['B', 1]]);
  });

  it('rejects the same user or ORCID twice', () => {
    expect(() => buildAuthors([{ user: other }, { user: other }], me, names)).toThrow(BadRequestException);
    const orcid = '0000-0002-1825-0097';
    expect(() => buildAuthors([{ name: 'A', orcid }, { name: 'B', orcid }], me, names)).toThrow(
      BadRequestException,
    );
  });
});

describe('author status helpers', () => {
  it('falls back to the legacy confirmed flag', () => {
    expect(authorStatus({ confirmed: true })).toBe(AuthorStatus.CONFIRMED);
    expect(authorStatus({ confirmed: false })).toBe(AuthorStatus.PENDING);
    expect(authorStatus({ status: AuthorStatus.DECLINED, confirmed: true })).toBe(AuthorStatus.DECLINED);
  });

  it('refreshes stats for the uploader and confirmed members only', () => {
    const ids = statUsers({
      uploadedBy: me,
      authors: [
        { name: 'x', order: 0, user: new Types.ObjectId(me), status: AuthorStatus.CONFIRMED },
        { name: 'y', order: 1, user: new Types.ObjectId(other), status: AuthorStatus.PENDING },
      ],
    });
    expect(ids).toEqual([me]);
  });
});
