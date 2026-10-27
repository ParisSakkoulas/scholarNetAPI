import {
  isCheckoutWindowOpen,
  isGoalWindowOpen,
  isValidTimezone,
  nextOccurrence,
  occurrences,
} from './schedule.util';

const HOUR = 60 * 60 * 1000;

describe('occurrences (time zones and daylight saving)', () => {
  it('keeps the local time across the New York spring-forward change', () => {
    // Mondays 09:00 New York. US clocks move forward on Sunday 2026-03-08.
    const schedule = { weekday: 1, time: '09:00', timezone: 'America/New_York' };
    const starts = occurrences(schedule, new Date('2026-03-01T00:00:00Z'), 14).map((d) =>
      d.toISOString(),
    );
    expect(starts).toEqual([
      '2026-03-02T14:00:00.000Z', // EST, UTC-5
      '2026-03-09T13:00:00.000Z', // EDT, UTC-4: one hour earlier in UTC
    ]);
  });

  it('keeps the local time across the Athens autumn change', () => {
    // Wednesdays 18:00 Athens. Summer time (UTC+3) ends on Sunday 2026-10-25.
    const schedule = { weekday: 3, time: '18:00', timezone: 'Europe/Athens' };
    const starts = occurrences(schedule, new Date('2026-10-19T00:00:00Z'), 14).map((d) =>
      d.toISOString(),
    );
    expect(starts).toEqual([
      '2026-10-21T15:00:00.000Z', // still summer time
      '2026-10-28T16:00:00.000Z', // winter time, UTC+2
    ]);
  });

  it('returns one start per week for four weeks and never one in the past', () => {
    const schedule = { weekday: 2, time: '10:00', timezone: 'UTC' };
    const from = new Date('2026-06-02T11:00:00Z'); // a Tuesday, after the slot
    const starts = occurrences(schedule, from, 28);
    expect(starts).toHaveLength(4);
    expect(starts.every((d) => d.getTime() >= from.getTime())).toBe(true);
  });

  it('nextOccurrence finds the upcoming slot', () => {
    const schedule = { weekday: 5, time: '08:30', timezone: 'UTC' };
    expect(nextOccurrence(schedule, new Date('2026-06-01T00:00:00Z'))?.toISOString()).toBe(
      '2026-06-05T08:30:00.000Z',
    );
  });

  it('validates IANA zones', () => {
    expect(isValidTimezone('Europe/Athens')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
  });
});

describe('goal and checkout windows', () => {
  const startsAt = new Date('2026-06-10T10:00:00Z');
  const durationMin = 90;
  const end = startsAt.getTime() + durationMin * 60 * 1000;

  it('opens goals 24 hours before the start and closes them at the end', () => {
    expect(isGoalWindowOpen(startsAt, durationMin, new Date(startsAt.getTime() - 25 * HOUR))).toBe(false);
    expect(isGoalWindowOpen(startsAt, durationMin, new Date(startsAt.getTime() - 23 * HOUR))).toBe(true);
    expect(isGoalWindowOpen(startsAt, durationMin, new Date(end))).toBe(true);
    expect(isGoalWindowOpen(startsAt, durationMin, new Date(end + 1))).toBe(false);
  });

  it('opens checkout at the start and closes it 24 hours after the end', () => {
    expect(isCheckoutWindowOpen(startsAt, durationMin, new Date(startsAt.getTime() - 1))).toBe(false);
    expect(isCheckoutWindowOpen(startsAt, durationMin, startsAt)).toBe(true);
    expect(isCheckoutWindowOpen(startsAt, durationMin, new Date(end + 23 * HOUR))).toBe(true);
    expect(isCheckoutWindowOpen(startsAt, durationMin, new Date(end + 25 * HOUR))).toBe(false);
  });
});
