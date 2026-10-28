import { escapeRegex } from './grant-filter.util';

export interface PrefLike {
  countries: string[];
  careerStage?: string | null;
  fields: string[];
  fundingTypes: string[];
}

export interface CallLike {
  countries: string[];
  careerStages: string[];
  fields: string[];
  fundingType: string;
}

export interface Fit {
  /** 0 to 100. Only a rough ordering: field overlap counts most, a preferred funding type adds a little. */
  score: number;
  /** Short, human reasons, e.g. "Matches your fields: Machine learning". */
  reasons: string[];
}

const lower = (list: string[]) => list.map((s) => s.trim().toLowerCase());

/** An empty list on either side means "any", so it always fits. */
const overlapsOrAny = (wanted: string[], offered: string[]) =>
  !wanted.length || !offered.length || offered.some((o) => wanted.includes(o));

/** Mongo version of the hard rules: open, deadline ahead, country and career stage compatible. */
export function buildMatchFilter(pref: PrefLike, now = new Date()): Record<string, any> {
  const and: Record<string, any>[] = [{ status: 'open', deadline: { $gte: now } }];

  if (pref.countries.length) {
    and.push({ $or: [{ countries: { $in: pref.countries.map((c) => c.toUpperCase()) } }, { countries: { $size: 0 } }] });
  }
  if (pref.careerStage) {
    and.push({ $or: [{ careerStages: pref.careerStage }, { careerStages: { $size: 0 } }] });
  }
  if (pref.fields.length) {
    and.push({
      $or: pref.fields.map((f) => ({ fields: { $regex: `^${escapeRegex(f.trim())}$`, $options: 'i' } })),
    });
  }
  return { $and: and };
}

/**
 * Hard rules first (country, career stage), then the soft match on fields (no embeddings here, so
 * it is a plain overlap). Returns null when the call does not fit. When the user named fields, at
 * least one has to overlap; with no fields named, every call that passes the hard rules fits.
 */
export function scoreCall(pref: PrefLike, call: CallLike): Fit | null {
  if (!overlapsOrAny(pref.countries.map((c) => c.toUpperCase()), call.countries.map((c) => c.toUpperCase()))) return null;
  if (pref.careerStage && call.careerStages.length && !call.careerStages.includes(pref.careerStage)) return null;

  const reasons: string[] = [];
  let score = 0;

  const wantedFields = lower(pref.fields);
  const hits = call.fields.filter((f) => wantedFields.includes(f.trim().toLowerCase()));
  if (wantedFields.length) {
    if (!hits.length) return null;
    score += Math.min(80, hits.length * 40);
    reasons.push(`Matches your ${hits.length > 1 ? 'fields' : 'field'}: ${hits.join(', ')}`);
  }

  if (pref.fundingTypes.includes(call.fundingType)) {
    score += 20;
    reasons.push(`Funding type you prefer: ${call.fundingType}`);
  }
  if (pref.careerStage && call.careerStages.includes(pref.careerStage)) {
    reasons.push('Aimed at your career stage');
  }
  if (pref.countries.length && call.countries.length) reasons.push('Open to your country');
  if (!reasons.length) reasons.push('Fits your country and career stage');

  return { score: Math.min(100, score), reasons };
}
