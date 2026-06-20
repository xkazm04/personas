import { describe, expect, it } from 'vitest';
import { summarizeEvidence } from '../kpiMeasurementProvenance';

describe('summarizeEvidence', () => {
  it('returns nulls for empty/missing evidence', () => {
    expect(summarizeEvidence(null)).toEqual({ summary: null, full: null });
    expect(summarizeEvidence(undefined)).toEqual({ summary: null, full: null });
    expect(summarizeEvidence('')).toEqual({ summary: null, full: null });
  });

  it('prefers the cmd field for evaluator command evidence', () => {
    const r = summarizeEvidence('{"cmd":"npx vitest run --coverage","output_tail":"…"}');
    expect(r.summary).toBe('npx vitest run --coverage');
    expect(r.full).toContain('"output_tail"');
  });

  it('uses basis for derived-metric evidence', () => {
    expect(summarizeEvidence('{"basis":"failed=8 total=38 window=7d","metric":"exec_failure_rate"}').summary).toBe(
      'failed=8 total=38 window=7d',
    );
  });

  it('falls back to metric when no cmd/basis', () => {
    expect(summarizeEvidence('{"metric":"qa_bounce_rate"}').summary).toBe('qa_bounce_rate');
  });

  it('shows the first key:value for an unrecognised object', () => {
    expect(summarizeEvidence('{"rows":42,"window":"30d"}').summary).toBe('rows: 42');
  });

  it('shows raw text for non-JSON evidence', () => {
    expect(summarizeEvidence('measured by hand on 2026-06-01').summary).toBe('measured by hand on 2026-06-01');
  });

  it('truncates long raw text', () => {
    const long = 'x'.repeat(200);
    const r = summarizeEvidence(long);
    expect(r.summary?.endsWith('…')).toBe(true);
    expect(r.summary?.length).toBeLessThanOrEqual(81);
    expect(r.full).toBe(long); // full is preserved
  });
});
