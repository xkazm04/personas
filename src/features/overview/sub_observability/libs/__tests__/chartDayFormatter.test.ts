// @vitest-environment node
// Chart buckets are UTC days: a viewer west of UTC must still read the bucket's own date.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chartDayFormatter } from '../chartAnnotations';

const savedTz = process.env.TZ;
beforeAll(() => { process.env.TZ = 'America/New_York'; });
afterAll(() => { if (savedTz === undefined) delete process.env.TZ; else process.env.TZ = savedTz; });

describe('chartDayFormatter', () => {
  it('labels a UTC day bucket with its own date in a zone behind UTC', () => {
    expect(chartDayFormatter('en')('2026-10-19')).toBe('Oct 19');
    expect(chartDayFormatter('en')('2026-01-01')).toBe('Jan 1');
  });
  it('passes an unparseable value through instead of printing Invalid Date', () => {
    expect(chartDayFormatter('en')('not-a-day')).toBe('not-a-day');
  });
});
