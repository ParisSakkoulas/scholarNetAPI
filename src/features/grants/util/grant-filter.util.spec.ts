import { buildGrantFilter, daysLeft, escapeRegex } from './grant-filter.util';

const NOW = new Date('2026-06-01T00:00:00Z');
const clauses = (f: Record<string, any>) => f.$and as Record<string, any>[];

describe('buildGrantFilter', () => {
  it('shows only open calls with a future deadline by default, so closed calls disappear', () => {
    const f = buildGrantFilter({}, NOW);
    expect(clauses(f)).toEqual([{ status: 'open', deadline: { $gte: NOW } }]);
  });

  it('includes closed calls only when asked', () => {
    const f = buildGrantFilter({ includeClosed: true }, NOW);
    expect(clauses(f)[0]).toEqual({ status: { $in: ['open', 'closed'] } });
  });

  it('never lets pending or rejected calls through', () => {
    for (const includeClosed of [false, true]) {
      const first = JSON.stringify(clauses(buildGrantFilter({ includeClosed }, NOW))[0]);
      expect(first).not.toContain('pending');
      expect(first).not.toContain('rejected');
    }
  });

  it('treats an empty country or career-stage list as "any"', () => {
    const f = buildGrantFilter({ country: 'gr', careerStage: 'phd' }, NOW);
    expect(clauses(f)).toContainEqual({ $or: [{ countries: 'GR' }, { countries: { $size: 0 } }] });
    expect(clauses(f)).toContainEqual({ $or: [{ careerStages: 'phd' }, { careerStages: { $size: 0 } }] });
  });

  it('matches field and funding type, and a deadline range', () => {
    const from = new Date('2026-07-01');
    const to = new Date('2026-08-01');
    const f = buildGrantFilter({ field: 'Machine learning', fundingType: 'fellowship', deadlineFrom: from, deadlineTo: to }, NOW);
    expect(clauses(f)).toContainEqual({ fields: { $regex: '^Machine learning$', $options: 'i' } });
    expect(clauses(f)).toContainEqual({ fundingType: 'fellowship' });
    expect(clauses(f)).toContainEqual({ deadline: { $gte: from, $lte: to } });
  });

  it('searches title, funder and description, with regex characters escaped', () => {
    const f = buildGrantFilter({ search: 'a.b(c' }, NOW);
    const or = clauses(f).find((c) => c.$or?.[0]?.title)!.$or;
    expect(or.map((c: any) => Object.keys(c)[0])).toEqual(['title', 'funder', 'description']);
    expect(or[0].title.$regex).toBe('a\\.b\\(c');
  });

  it('ignores a blank search', () => {
    expect(clauses(buildGrantFilter({ search: '   ' }, NOW))).toHaveLength(1);
  });
});

describe('helpers', () => {
  it('escapeRegex neutralises special characters', () => {
    expect(new RegExp(escapeRegex('.*+?')).test('x')).toBe(false);
    expect(new RegExp(escapeRegex('.*+?')).test('.*+?')).toBe(true);
  });

  it('daysLeft counts whole days, negative after the deadline', () => {
    expect(daysLeft(new Date('2026-06-11T00:00:00Z'), NOW)).toBe(10);
    expect(daysLeft(new Date('2026-06-01T06:00:00Z'), NOW)).toBe(1);
    expect(daysLeft(new Date('2026-05-30T00:00:00Z'), NOW)).toBeLessThan(0);
  });
});
