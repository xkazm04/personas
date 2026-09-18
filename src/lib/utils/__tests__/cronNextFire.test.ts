import { describe, it, expect } from 'vitest';
import { nextFireAt, parseCron } from '../cronNextFire';
import { CRON_PRESETS } from '../cronPresets';

const iso = (d: Date | null) => d?.toISOString() ?? null;

describe('nextFireAt', () => {
  it('reports the same day when the time is still ahead', () => {
    expect(iso(nextFireAt('0 9 * * *', 'UTC', new Date('2026-03-10T07:00:00Z')))).toBe(
      '2026-03-10T09:00:00.000Z',
    );
  });

  it('rolls to the next day once the time has passed', () => {
    expect(iso(nextFireAt('0 9 * * *', 'UTC', new Date('2026-03-10T09:00:00Z')))).toBe(
      '2026-03-11T09:00:00.000Z',
    );
  });

  it('evaluates the preset in the named zone, not the OS zone', () => {
    // 2026-01-14 22:00 in New York (EST, UTC-5).
    const from = new Date('2026-01-15T03:00:00Z');
    const preset = CRON_PRESETS.find((p) => p.id === 'daily_9am')!;
    const next = nextFireAt(preset.cron, 'America/New_York', from);
    // 09:00 ET the following morning === 14:00Z, NOT 09:00Z.
    expect(iso(next)).toBe('2026-01-15T14:00:00.000Z');
    expect(iso(nextFireAt(preset.cron, 'UTC', from))).toBe('2026-01-15T09:00:00.000Z');
  });

  it('keeps the wall-clock time across a DST transition', () => {
    // 2026-03-08 is the US spring-forward; 00:00 EST === 05:00Z.
    const next = nextFireAt('0 9 * * *', 'America/New_York', new Date('2026-03-08T05:00:00Z'));
    // Still 09:00 local, now EDT (UTC-4).
    expect(iso(next)).toBe('2026-03-08T13:00:00.000Z');
  });

  it('skips to the next weekday for a weekday-only preset', () => {
    // 2026-03-14 is a Saturday.
    const next = nextFireAt('0 9 * * 1-5', 'UTC', new Date('2026-03-14T00:00:00Z'));
    expect(iso(next)).toBe('2026-03-16T09:00:00.000Z'); // Monday
  });

  it('honours cron OR semantics when both day fields are restricted', () => {
    // Day-of-month 13 OR Friday. 2026-03-11 is a Wednesday, so Friday the 13th
    // satisfies both and the 12th satisfies neither.
    expect(iso(nextFireAt('0 0 13 * 5', 'UTC', new Date('2026-03-11T12:00:00Z')))).toBe(
      '2026-03-13T00:00:00.000Z',
    );
  });

  it('previews every_minute less than a minute ahead', () => {
    const from = new Date('2026-03-10T07:00:30Z');
    const next = nextFireAt('* * * * *', 'UTC', from);
    expect(next).not.toBeNull();
    const delta = next!.getTime() - from.getTime();
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThan(60_000);
  });

  it('returns null for an expression that is not a 5-field cron', () => {
    const from = new Date('2026-03-10T07:00:00Z');
    expect(nextFireAt('not a cron', 'UTC', from)).toBeNull();
    expect(nextFireAt('0 9 * *', 'UTC', from)).toBeNull();
    expect(nextFireAt('99 9 * * *', 'UTC', from)).toBeNull();
    expect(nextFireAt('0 9 * * 9', 'UTC', from)).toBeNull();
    expect(nextFireAt('', 'UTC', from)).toBeNull();
  });

  it('returns null for an unusable timezone instead of throwing', () => {
    expect(nextFireAt('0 9 * * *', 'Mars/Olympus', new Date('2026-03-10T07:00:00Z'))).toBeNull();
  });

  it('falls back to the system zone when none is given', () => {
    expect(nextFireAt('0 9 * * *', undefined, new Date('2026-03-10T07:00:00Z'))).toBeInstanceOf(
      Date,
    );
  });

  it('answers for every shipped preset', () => {
    const from = new Date('2026-03-10T07:00:00Z');
    for (const preset of CRON_PRESETS) {
      const next = nextFireAt(preset.cron, 'UTC', from);
      expect(next, preset.id).toBeInstanceOf(Date);
      expect(next!.getTime(), preset.id).toBeGreaterThan(from.getTime());
    }
  });
});

describe('parseCron', () => {
  it('expands steps, ranges and lists', () => {
    expect([...parseCron('*/15 * * * *')!.minutes]).toEqual([0, 15, 30, 45]);
    expect([...parseCron('0 9,17 * * *')!.hours]).toEqual([9, 17]);
    expect([...parseCron('0 0 * * 1-5')!.daysOfWeek]).toEqual([1, 2, 3, 4, 5]);
  });

  it('treats day-of-week 7 as Sunday', () => {
    expect([...parseCron('0 0 * * 7')!.daysOfWeek]).toEqual([0]);
  });

  it('records which day fields are restricted', () => {
    const both = parseCron('0 0 13 * 5')!;
    expect(both.domRestricted).toBe(true);
    expect(both.dowRestricted).toBe(true);
    const neither = parseCron('0 0 * * *')!;
    expect(neither.domRestricted).toBe(false);
    expect(neither.dowRestricted).toBe(false);
  });
});
