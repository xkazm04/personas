import { describe, expect, it } from 'vitest';

import { parseLocalDateTime, validateSetup, type SetupDraft } from '../model/setupValidation';

const seat = (model: string, label: string | null = null) => ({
  engine: 'claude' as const,
  model,
  effort: 'high' as const,
  label,
});

const ok: SetupDraft = {
  title: 'Landing page',
  projectId: 'p1',
  brief: '## The idea',
  seats: [seat('opus'), seat('sonnet')],
  variantsPerSeat: 3,
  timeoutMin: 60,
  judgesEnabled: false,
  judges: [],
  notBeforeMs: null,
};

const codes = (d: SetupDraft) => validateSetup(d, 1_000).errors.map((e) => e.code);

describe('validateSetup', () => {
  it('accepts a complete draft', () => {
    expect(validateSetup(ok)).toEqual({ errors: [], fewSeats: false, ok: true });
  });

  it('requires title, project, brief and a seat', () => {
    expect(codes({ ...ok, title: ' ', projectId: null, brief: '', seats: [] })).toEqual([
      'title-missing',
      'project-missing',
      'brief-missing',
      'seats-missing',
    ]);
  });

  it('warns — but allows — a single seat', () => {
    const v = validateSetup({ ...ok, seats: [seat('opus')] });
    expect(v.ok).toBe(true);
    expect(v.fewSeats).toBe(true);
  });

  it('refuses duplicate seats and names them', () => {
    const v = validateSetup({ ...ok, seats: [seat('opus'), seat('opus')] });
    expect(v.errors).toEqual([{ code: 'seats-duplicate', ids: ['claude-opus_high'] }]);
    expect(validateSetup({ ...ok, seats: [seat('opus'), seat('opus', '2')] }).ok).toBe(true);
  });

  it('refuses tokens the arena cannot name', () => {
    expect(codes({ ...ok, seats: [seat('op us')] })).toContain('seat-token-invalid');
    expect(codes({ ...ok, seats: [seat('opus', 'a/b')] })).toContain('seat-token-invalid');
  });

  it('bounds variants and the time limit', () => {
    expect(codes({ ...ok, variantsPerSeat: 0 })).toEqual(['variants-range']);
    expect(codes({ ...ok, variantsPerSeat: 6 })).toEqual(['variants-range']);
    expect(codes({ ...ok, timeoutMin: 2 })).toEqual(['timeout-range']);
  });

  it('judges only matter when enabled', () => {
    expect(codes({ ...ok, judges: [seat('x'), seat('x')] })).toEqual([]);
    expect(codes({ ...ok, judgesEnabled: true })).toEqual(['judges-missing']);
    expect(codes({ ...ok, judgesEnabled: true, judges: [seat('x'), seat('x')] })).toEqual(['judges-duplicate']);
  });

  it('refuses a start time in the past', () => {
    expect(codes({ ...ok, notBeforeMs: 500 })).toEqual(['start-in-past']);
    expect(codes({ ...ok, notBeforeMs: 5_000 })).toEqual([]);
  });

  it('parses a datetime-local value', () => {
    expect(parseLocalDateTime('')).toBeNull();
    expect(parseLocalDateTime('not a date')).toBeNull();
    expect(parseLocalDateTime('2026-09-24T18:30')).toBe(new Date('2026-09-24T18:30').getTime());
  });
});
