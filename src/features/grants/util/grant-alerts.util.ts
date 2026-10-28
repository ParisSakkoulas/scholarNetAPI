export type DeadlineStage = 14 | 3;

/**
 * Which reminder a saved call is due for: 14 days out (4 to 14 days left) or 3 days out (0 to 3).
 * Null when the deadline is further away or already behind us.
 */
export function deadlineStage(daysLeft: number): DeadlineStage | null {
  if (daysLeft < 0 || daysLeft > 14) return null;
  return daysLeft <= 3 ? 3 : 14;
}

interface Comparable {
  title?: string;
  url?: string;
  description?: string;
  fundingType?: string;
  deadline?: Date;
  opensAt?: Date | null;
  amount?: { min?: number; max?: number; currency?: string } | null;
  countries?: string[];
  careerStages?: string[];
}

const time = (d?: Date | null) => (d ? new Date(d).getTime() : 0);
const sorted = (l?: string[]) => [...(l ?? [])].sort().join(',');

/**
 * What a saved-call alert should mention. Only fields a researcher would act on count;
 * re-checking a call against the official page (lastCheckedAt) is not an edit.
 */
export function changedFields(before: Comparable, after: Comparable): string[] {
  const changed: string[] = [];
  if (time(before.deadline) !== time(after.deadline)) changed.push('deadline');
  if (time(before.opensAt) !== time(after.opensAt)) changed.push('opening date');
  if (before.url !== after.url) changed.push('official link');
  if (before.title !== after.title) changed.push('title');
  if (JSON.stringify(before.amount ?? null) !== JSON.stringify(after.amount ?? null)) changed.push('amount');
  if (sorted(before.countries) !== sorted(after.countries)) changed.push('eligible countries');
  if (sorted(before.careerStages) !== sorted(after.careerStages)) changed.push('career stages');
  if (before.fundingType !== after.fundingType) changed.push('funding type');
  if (before.description !== after.description) changed.push('description');
  return changed;
}
