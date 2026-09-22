import { describe, it, expect } from 'vitest';

import { COUNCIL_STATES } from '@/api/devTools/council';
import {
  COUNCIL_GLYPH_KINDS,
  councilCta,
  councilCtaLabel,
  councilLabel,
  councilVisual,
  toCouncilState,
  type CouncilGlyphKind,
} from '../councilGlyph';

// The whole point of the two lookups is that they are TOTAL over the closed
// set and carry an explicit unknown arm. A kind that resolves to `undefined` is
// a glyph that renders as nothing, which is exactly the failure the tables were
// written to prevent — so the test drives every member, not a sample.
const t = {
  council_state_none: 'Not reviewed',
  council_state_running: 'Council running',
  council_state_fail: 'Failed a floor',
  council_state_incomplete: 'Evidence incomplete',
  council_state_stalled: 'Stalled after round 3',
  council_state_ready: 'Awaiting your decision',
  council_state_machine_pass: 'Machine pass',
  council_state_approved: 'Approved',
  council_state_approved_drifted: 'Approved, the code has moved since',
  council_state_rejected: 'Rejected',
  council_state_unknown: 'State not recognised',
  council_cta_run: 'Run council',
  council_cta_next_round: 'Run next round',
  council_cta_promote: 'Promote to major',
  council_cta_awaiting: 'Awaiting your decision',
  // INVARIANT: the glyph helpers read only these `council_*` leaves, so a
  // partial slice is a faithful stand-in for the generated catalog here.
} as unknown as Parameters<typeof councilLabel>[1];

describe('council glyph vocabulary', () => {
  it('covers the nine derived states plus the running overlay', () => {
    expect(COUNCIL_GLYPH_KINDS).toHaveLength(COUNCIL_STATES.length + 1);
    expect(COUNCIL_STATES).toHaveLength(9);
    expect(COUNCIL_GLYPH_KINDS).toContain('running');
  });

  it('resolves an icon, a tone and a translated label for every kind', () => {
    for (const kind of COUNCIL_GLYPH_KINDS) {
      const visual = councilVisual(kind);
      expect(visual.icon, kind).toBeTruthy();
      expect(visual.tone, kind).toMatch(/^text-/);
      const label = councilLabel(kind, t);
      expect(label, kind).toBeTruthy();
      expect(label, kind).not.toBe('State not recognised');
    }
  });

  it('falls to the explicit unknown arm rather than a vocabulary member', () => {
    expect(councilVisual(null).tone).toMatch(/^text-/);
    expect(councilLabel(null, t)).toBe('State not recognised');
    expect(councilCta(null)).toBe('none');
  });

  it('narrows the wire string and refuses anything outside the closed set', () => {
    expect(toCouncilState('approved')).toBe('approved');
    expect(toCouncilState('machine_pass')).toBe('machine_pass');
    expect(toCouncilState('Approved')).toBeNull();
    expect(toCouncilState('shipped')).toBeNull();
    expect(toCouncilState(null)).toBeNull();
    expect(toCouncilState(undefined)).toBeNull();
  });

  it('gives the machine pass a glyph distinct from the approval checkmark', () => {
    expect(councilVisual('machine_pass').icon).not.toBe(councilVisual('approved').icon);
    // ...and rejection a glyph distinct from a floor failure.
    expect(councilVisual('rejected').icon).not.toBe(councilVisual('fail').icon);
  });

  it('marks the drifted approval as a checkmark that carries a drift mark', () => {
    const drifted = councilVisual('approved_drifted');
    expect(drifted.icon).toBe(councilVisual('approved').icon);
    expect(drifted.mark).toBeTruthy();
    expect(councilVisual('approved').mark).toBeUndefined();
  });
});

describe('the CTA table', () => {
  const expected: Record<CouncilGlyphKind, string> = {
    none: 'run',
    running: 'none',
    fail: 'next_round',
    incomplete: 'next_round',
    stalled: 'none',
    ready: 'awaiting',
    machine_pass: 'promote',
    approved: 'none',
    approved_drifted: 'next_round',
    rejected: 'next_round',
  };

  it('matches the contract for every state and the running overlay', () => {
    for (const kind of COUNCIL_GLYPH_KINDS) {
      expect(councilCta(kind), kind).toBe(expected[kind]);
    }
  });

  it('an approval offers nothing; a drifted approval and a rejection re-arm', () => {
    expect(councilCta('approved')).toBe('none');
    expect(councilCta('approved_drifted')).toBe('next_round');
    expect(councilCta('rejected')).toBe('next_round');
  });

  it('labels every CTA it can offer, and nothing for none', () => {
    for (const kind of COUNCIL_GLYPH_KINDS) {
      const cta = councilCta(kind);
      const label = councilCtaLabel(cta, t);
      if (cta === 'none') expect(label).toBe('');
      else expect(label, kind).toBeTruthy();
    }
  });
});
