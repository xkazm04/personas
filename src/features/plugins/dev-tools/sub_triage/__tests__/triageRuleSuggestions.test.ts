import { describe, it, expect } from 'vitest';

import { suggestTriageRules } from '../triageRuleSuggestions';
import type { DevIdea } from '@/lib/bindings/DevIdea';

function idea(over: Partial<DevIdea>): DevIdea {
  return {
    id: Math.random().toString(36),
    category: 'technical',
    status: 'rejected',
    // The neutral fixture sits at the MIDPOINT of the 1-5 scale, so a test
    // about one pattern does not silently satisfy the other two. It read 5
    // back when the column carried a ten-point scale; on a five-point one that
    // is the ceiling, and every "neutral" idea would have counted as heavy,
    // high-impact and risky at the same time.
    effort: 3,
    impact: 3,
    risk: 3,
    origin: null,
    ...over,
  } as unknown as DevIdea;
}

// B3 — rejection learning across the findings spine. A sensor whose findings the user
// keeps saying no to is mis-thresholded; the honest response is to SUGGEST a rule, not
// to quietly retune the sensor behind their back.
describe('suggestTriageRules — reject_origin (B3)', () => {
  it('suggests auto-rejecting a sensor the user consistently says no to', () => {
    const ideas = Array.from({ length: 6 }, () => idea({ origin: 'llm_cost', status: 'rejected' }));
    const s = suggestTriageRules(ideas, []).find((x) => x.kind === 'reject_origin');
    expect(s).toBeDefined();
    expect(s!.origin).toBe('llm_cost');
    expect(s!.action).toBe('reject');
    // Must map onto the `origin` rule condition the backend matcher understands.
    expect(s!.conditions).toEqual([{ field: 'origin', op: 'eq', value: 'llm_cost' }]);
    expect(s!.matched).toBe(6);
    expect(s!.total).toBe(6);
  });

  it('stays quiet when the sensor is mostly accepted', () => {
    const ideas = [
      ...Array.from({ length: 5 }, () => idea({ origin: 'llm_cost', status: 'accepted' })),
      idea({ origin: 'llm_cost', status: 'rejected' }),
    ];
    expect(suggestTriageRules(ideas, []).some((x) => x.kind === 'reject_origin')).toBe(false);
  });

  it('stays quiet on too small a sample — a couple of no’s is not a pattern', () => {
    const ideas = Array.from({ length: 2 }, () => idea({ origin: 'sentry_spike', status: 'rejected' }));
    // pad to clear MIN_SAMPLE for the function overall, with unrelated decisions
    const padded = [...ideas, ...Array.from({ length: 4 }, () => idea({ status: 'accepted' }))];
    expect(suggestTriageRules(padded, []).some((x) => x.kind === 'reject_origin')).toBe(false);
  });

  it('never fires on classic scanner ideas (they have no origin)', () => {
    const ideas = Array.from({ length: 6 }, () => idea({ origin: null, status: 'rejected' }));
    expect(suggestTriageRules(ideas, []).some((x) => x.kind === 'reject_origin')).toBe(false);
  });
});
