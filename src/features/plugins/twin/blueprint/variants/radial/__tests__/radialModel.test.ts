/**
 * Radial (WP10): the pure arithmetic and geometry behind the ring. Domains
 * are declared (never the sample's own range), `null` stays "not measured",
 * the monogram never splits a surrogate pair, and the L1 layout keeps every
 * full-size label clear of the ring and inside the canvas.
 */
import { describe, expect, it } from 'vitest';

import { SECTION_IDS } from '../../../blueprintContract';
import { FIXTURE_DELTA_INSTANT, FIXTURE_RICH } from '../../../__fixtures__/blueprintFixtures';
import { polar, sectorPath } from '../radialGeometry';
import { overviewLayout, stageLayout } from '../radialLayout';
import { channelLabel, deltaTarget, memoryParts, monogram, topicShares } from '../radialModel';

describe('radialModel', () => {
  it('cuts the monogram on a code point, not a UTF-16 unit', () => {
    expect(monogram('ada')).toBe('A');
    expect(monogram('\u{1D49C}da')).toBe('\u{1D49C}');
    expect(monogram('  ')).toBe('');
  });

  it('writes channel names as their product does', () => {
    expect(channelLabel('sms', 'Everywhere')).toBe('SMS');
    expect(channelLabel('whatsapp', 'Everywhere')).toBe('WhatsApp');
    expect(channelLabel('generic', 'Everywhere')).toBe('Everywhere');
    expect(channelLabel('matrix', 'Everywhere')).toBe('Matrix');
  });

  it('scales a topic on the declared 0..5 domain and flags overflow', () => {
    const some = topicShares({ id: 'values', approved: 2, awaiting: 1, tier: 'some' });
    expect(some.solid).toBeCloseTo(0.4);
    expect(some.extra).toBeCloseTo(0.2);
    expect(some.overflow).toBe(false);
    const over = topicShares({ id: 'expertise', approved: 12, awaiting: 1, tier: 'covered' });
    expect(over).toEqual({ solid: 1, extra: 0, overflow: true });
  });

  it('keeps an unmeasured memory set null, and a measured empty one at zero', () => {
    expect(memoryParts({ approved: null, pending: null, rejected: null })).toBeNull();
    expect(memoryParts({ approved: 0, pending: 0, rejected: 0 })).toEqual({ approved: 0, pending: 0, rejected: 0, total: 0 });
  });

  it('routes a delta to the goal slot first, then the channel, topic and kind', () => {
    expect(deltaTarget(FIXTURE_DELTA_INSTANT, FIXTURE_RICH)).toMatchObject({ section: 'training', topicId: 'opinions' });
    expect(deltaTarget({ ...FIXTURE_DELTA_INSTANT, goalId: 'g2' }, FIXTURE_RICH).section).toBe('voice');
    const noGoal = { ...FIXTURE_DELTA_INSTANT, goalId: null, topicId: null };
    expect(deltaTarget({ ...noGoal, kind: 'fact' }, FIXTURE_RICH).section).toBe('knowledge');
    expect(deltaTarget({ ...noGoal, channel: 'email' }, FIXTURE_RICH).section).toBe('voice');
  });
});

describe('radialGeometry', () => {
  it('draws nothing for an empty sector and a ring for a full turn', () => {
    expect(sectorPath(0, 0, 10, 20, 30, 30)).toBe('');
    expect(sectorPath(0, 0, 10, 20, 0, 360).match(/M/g)).toHaveLength(2);
  });

  it.each([
    [950, 750],
    [1110, 760],
    [1590, 1030],
  ])('L1 at %ix%i: every label sits outside the ring and inside the canvas', (w, h) => {
    const layout = overviewLayout(w, h);
    for (const s of SECTION_IDS) {
      const box = layout.labels[s];
      const d = Math.hypot(box.x - layout.cx, box.y - layout.cy);
      expect(d).toBeGreaterThan(layout.R);
      expect(box.maxW).toBeGreaterThanOrEqual(200);
      expect(box.x).toBeGreaterThan(0);
      expect(box.x).toBeLessThan(w);
    }
    expect(layout.cy + layout.R).toBeLessThanOrEqual(h);
  });

  it('stage keeps the ring left of the centred question card', () => {
    for (const [w, h] of [[950, 750], [1590, 1030]] as const) {
      const s = stageLayout(w, h);
      expect(s.behind).toBe(false);
      expect(s.cx + s.R).toBeLessThanOrEqual((w - 520) / 2);
      expect(s.readout.top).toBeGreaterThan(s.cy + s.R);
    }
  });

  it('measures angles clockwise from 12 o’clock', () => {
    const p = polar(0, 0, 10, 90);
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(0);
  });
});
