import { describe, it, expect } from 'vitest';
import { parseLastRunMs } from './useHealthDigestScheduler';

describe('parseLastRunMs', () => {
  it('parses a valid ISO stamp', () => {
    const iso = '2026-01-02T03:04:05.000Z';
    expect(parseLastRunMs(iso)).toBe(Date.parse(iso));
  });

  it('treats missing / empty / unparseable values as never run', () => {
    expect(parseLastRunMs(null)).toBeNull();
    expect(parseLastRunMs(undefined)).toBeNull();
    expect(parseLastRunMs('')).toBeNull();
    expect(parseLastRunMs('not a date')).toBeNull();
  });

  it('treats a future stamp as never run rather than as permanently fresh', () => {
    // A clock that ran ahead once (or a bad write) stamps a future date. The
    // due-check is `now - lastRun < ONE_WEEK`, which a future stamp satisfies
    // forever - the weekly digest would never fire again on that machine.
    const future = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    expect(parseLastRunMs(future)).toBeNull();
  });

  it('tolerates small forward skew without discarding the stamp', () => {
    const nearFuture = new Date(Date.now() + 30 * 1000).toISOString();
    expect(parseLastRunMs(nearFuture)).not.toBeNull();
  });
});
