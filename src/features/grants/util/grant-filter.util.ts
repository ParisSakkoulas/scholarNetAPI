export interface GrantFilterInput {
  country?: string;
  careerStage?: string;
  field?: string;
  fundingType?: string;
  deadlineFrom?: Date;
  deadlineTo?: Date;
  search?: string;
  includeClosed?: boolean;
}

/** Escapes regex special characters so user text cannot break or hijack the query. */
export const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Mongo filter for the public list. Rules:
 * - only approved calls: `open`, or `closed` when asked for;
 * - a call whose deadline has passed counts as closed even before the daily job runs;
 * - an empty `countries` / `careerStages` list means "any", so it matches every filter value.
 */
export function buildGrantFilter(input: GrantFilterInput, now = new Date()): Record<string, any> {
  const and: Record<string, any>[] = [];

  if (input.includeClosed) {
    and.push({ status: { $in: ['open', 'closed'] } });
  } else {
    and.push({ status: 'open', deadline: { $gte: now } });
  }

  if (input.country) {
    and.push({
      $or: [{ countries: input.country.toUpperCase() }, { countries: { $size: 0 } }],
    });
  }
  if (input.careerStage) {
    and.push({ $or: [{ careerStages: input.careerStage }, { careerStages: { $size: 0 } }] });
  }
  if (input.field) {
    and.push({ fields: { $regex: `^${escapeRegex(input.field.trim())}$`, $options: 'i' } });
  }
  if (input.fundingType) and.push({ fundingType: input.fundingType });

  if (input.deadlineFrom || input.deadlineTo) {
    const range: Record<string, Date> = {};
    if (input.deadlineFrom) range.$gte = input.deadlineFrom;
    if (input.deadlineTo) range.$lte = input.deadlineTo;
    and.push({ deadline: range });
  }

  if (input.search?.trim()) {
    const rx = { $regex: escapeRegex(input.search.trim()), $options: 'i' };
    and.push({ $or: [{ title: rx }, { funder: rx }, { description: rx }] });
  }

  return { $and: and };
}

/** Whole days between now and the deadline (negative once it has passed). */
export const daysLeft = (deadline: Date, now = new Date()) =>
  Math.ceil((deadline.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
