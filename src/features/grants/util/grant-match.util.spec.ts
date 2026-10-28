import { changedFields, deadlineStage } from './grant-alerts.util';
import { buildMatchFilter, scoreCall } from './grant-match.util';

const call = (over: Record<string, unknown> = {}) => ({
  countries: [] as string[],
  careerStages: [] as string[],
  fields: ['Machine learning'],
  fundingType: 'project',
  ...over,
});
const pref = (over: Record<string, unknown> = {}) => ({
  countries: [] as string[],
  careerStage: undefined as string | undefined,
  fields: [] as string[],
  fundingTypes: [] as string[],
  ...over,
});

describe('scoreCall (hard rules, then fields overlap)', () => {
  it('rejects a call that is closed to the user\'s country', () => {
    expect(scoreCall(pref({ countries: ['GR'] }), call({ countries: ['DE'] }))).toBeNull();
  });

  it('treats a call with no country list as open to everybody', () => {
    expect(scoreCall(pref({ countries: ['GR'] }), call({ countries: [] }))).not.toBeNull();
  });

  it('rejects a call for other career stages, accepts one with no stage list', () => {
    expect(scoreCall(pref({ careerStage: 'phd' }), call({ careerStages: ['postdoc'] }))).toBeNull();
    expect(scoreCall(pref({ careerStage: 'phd' }), call({ careerStages: [] }))).not.toBeNull();
    expect(scoreCall(pref({ careerStage: 'phd' }), call({ careerStages: ['phd', 'postdoc'] }))).not.toBeNull();
  });

  it('needs at least one field in common when the user named fields', () => {
    expect(scoreCall(pref({ fields: ['Biology'] }), call())).toBeNull();
    expect(scoreCall(pref({ fields: ['machine LEARNING'] }), call())).not.toBeNull();
  });

  it('scores field overlap highest and adds a little for a preferred funding type', () => {
    const one = scoreCall(pref({ fields: ['Machine learning'] }), call())!;
    const both = scoreCall(pref({ fields: ['Machine learning'], fundingTypes: ['project'] }), call())!;
    expect(one.score).toBe(40);
    expect(both.score).toBe(60);
    const two = scoreCall(pref({ fields: ['A', 'B'] }), call({ fields: ['a', 'b', 'c'] }))!;
    expect(two.score).toBe(80);
  });

  it('explains the match in a short reason', () => {
    const fit = scoreCall(pref({ fields: ['Machine learning'] }), call())!;
    expect(fit.reasons[0]).toBe('Matches your field: Machine learning');
  });

  it('with no fields named, a call that passes the hard rules fits with score 0', () => {
    const fit = scoreCall(pref(), call())!;
    expect(fit.score).toBe(0);
    expect(fit.reasons).toEqual(['Fits your country and career stage']);
  });
});

describe('buildMatchFilter', () => {
  const NOW = new Date('2026-06-01T00:00:00Z');

  it('always limits to open calls with a deadline ahead', () => {
    expect(buildMatchFilter(pref(), NOW).$and[0]).toEqual({ status: 'open', deadline: { $gte: NOW } });
  });

  it('adds country, career stage and field clauses only when the user set them', () => {
    expect(buildMatchFilter(pref(), NOW).$and).toHaveLength(1);
    const f = buildMatchFilter(pref({ countries: ['gr'], careerStage: 'phd', fields: ['Biology'] }), NOW);
    expect(f.$and).toContainEqual({ $or: [{ countries: { $in: ['GR'] } }, { countries: { $size: 0 } }] });
    expect(f.$and).toContainEqual({ $or: [{ careerStages: 'phd' }, { careerStages: { $size: 0 } }] });
    expect(f.$and).toContainEqual({ $or: [{ fields: { $regex: '^Biology$', $options: 'i' } }] });
  });
});

describe('deadlineStage', () => {
  it('is the 14 day reminder from 14 down to 4 days, then the 3 day one', () => {
    expect([15, 14, 10, 4, 3, 1, 0].map(deadlineStage)).toEqual([null, 14, 14, 14, 3, 3, 3]);
  });

  it('is null once the deadline has passed', () => {
    expect(deadlineStage(-1)).toBeNull();
  });
});

describe('changedFields', () => {
  const base = {
    title: 'T',
    url: 'https://x.org/a',
    description: 'd',
    fundingType: 'project',
    deadline: new Date('2026-09-01'),
    amount: { min: 1, max: 2, currency: 'EUR' },
    countries: ['GR', 'DE'],
    careerStages: ['phd'],
  };

  it('is empty when only the last-checked date moved', () => {
    expect(changedFields(base, { ...base })).toEqual([]);
  });

  it('names what changed, ignoring the order of lists', () => {
    const after = { ...base, deadline: new Date('2026-10-01'), url: 'https://x.org/b', countries: ['DE', 'GR'], amount: { min: 1, max: 5, currency: 'EUR' } };
    expect(changedFields(base, after)).toEqual(['deadline', 'official link', 'amount']);
  });
});
