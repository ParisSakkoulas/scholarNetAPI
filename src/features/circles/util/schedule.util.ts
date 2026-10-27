import { DateTime, IANAZone } from 'luxon';

export interface ScheduleLike {
  weekday: number; // ISO: 1 = Monday ... 7 = Sunday
  time: string; // "HH:mm" local to `timezone`
  timezone: string; // IANA zone
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Goals open this long before a session starts. */
export const GOAL_OPENS_BEFORE_MS = DAY_MS;
/** Checkout stays open this long after a session ends. */
export const CHECKOUT_OPEN_AFTER_MS = DAY_MS;

export const isValidTimezone = (zone: string) => IANAZone.isValidZone(zone);

export const isValidTime = (time: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time);

/**
 * UTC start times of every occurrence of `schedule` between `from` and `from + days`.
 * Each local date is converted on its own, so a daylight-saving change moves the UTC
 * instant (18:00 Athens is 15:00Z in summer and 16:00Z in winter) while the local time stays put.
 */
export function occurrences(schedule: ScheduleLike, from: Date, days: number): Date[] {
  const [hour, minute] = schedule.time.split(':').map(Number);
  const first = DateTime.fromJSDate(from, { zone: schedule.timezone }).startOf('day');
  const result: Date[] = [];

  for (let i = 0; i <= days; i++) {
    const day = first.plus({ days: i });
    if (day.weekday !== schedule.weekday) continue;
    // set() on the local date, so a missing local time (spring forward) lands on the next valid minute
    const start = day.set({ hour, minute, second: 0, millisecond: 0 });
    if (start.toMillis() >= from.getTime()) result.push(start.toUTC().toJSDate());
  }
  return result;
}

export function nextOccurrence(schedule: ScheduleLike, now = new Date()): Date | null {
  return occurrences(schedule, now, 8)[0] ?? null;
}

export const sessionEnd = (startsAt: Date, durationMin: number) =>
  new Date(startsAt.getTime() + durationMin * 60 * 1000);

/** A goal can be set from 24 hours before the session until it ends. */
export function isGoalWindowOpen(startsAt: Date, durationMin: number, now = new Date()): boolean {
  const t = now.getTime();
  return (
    t >= startsAt.getTime() - GOAL_OPENS_BEFORE_MS && t <= sessionEnd(startsAt, durationMin).getTime()
  );
}

/** Checkout opens when the session starts and closes 24 hours after it ends. */
export function isCheckoutWindowOpen(
  startsAt: Date,
  durationMin: number,
  now = new Date(),
): boolean {
  const t = now.getTime();
  return (
    t >= startsAt.getTime() &&
    t <= sessionEnd(startsAt, durationMin).getTime() + CHECKOUT_OPEN_AFTER_MS
  );
}
