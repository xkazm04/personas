// The Cadastre's geometry: every context lands on the map exactly once, a
// district keeps every letter of its name when it wraps, and the survey line
// starts at the deed's primary parcel.
import { describe, expect, it } from 'vitest';

import type { BoardContext } from '@/lib/bindings/BoardContext';
import type { BoardGroup } from '@/lib/bindings/BoardGroup';

import { computeLayout, surveyOrder, wrapWords, type Measure } from '../cadastre/cadastreLayout';
import type { ParcelCat } from '../cadastre/cadastreModel';
import { squarify } from '../cadastre/squarify';
import type { GroupPlot } from '../featuresModel';

/** A monospaced stand-in: 8px a character, whatever the weight. */
const mono: Measure = (text) => text.length * 8;

function plot(name: string, n: number): GroupPlot {
  const group: BoardGroup = { id: name, name, domain: null, contextCount: n, featureCount: 0, untouched: false };
  const cells = Array.from({ length: n }, (_, i) => {
    const context: BoardContext = { id: `${name}-${i}`, name: `${name}-${i}`, groupId: name, category: null, role: i % 3 === 0 ? 'platform' : 'core', featureSlugs: [] };
    return { context, role: null, claimants: [], claimMove: null };
  });
  return { group, cells };
}

describe('wrapWords', () => {
  it('keeps every letter, hyphenating a word wider than the line', () => {
    const name = 'Communications & Scheduling';
    const lines = wrapWords(name, 64, 700, mono);
    expect(lines.every((l) => mono(l, 700) <= 64 + 8)).toBe(true);
    expect(lines.join('').replace(/-/g, '').replace(/\s+/g, '')).toBe(name.replace(/\s+/g, ''));
    expect(lines.some((l) => l.includes('…'))).toBe(false);
  });

  it('carries a lone ampersand with the word after it', () => {
    expect(wrapWords('Billing & Subscriptions', 200, 700, mono)).toEqual(['Billing & Subscriptions']);
    expect(wrapWords('Billing & Subscriptions', 130, 700, mono)).toEqual(['Billing', '& Subscriptions']);
  });
});

describe('computeLayout', () => {
  const plots = [plot('Alpha', 12), plot('Beta', 5), plot('Gamma Delta Epsilon', 1), plot('Empty', 0)];
  const cats = new Map<string, ParcelCat>();

  it('places every context once and skips an empty group', () => {
    const lay = computeLayout(plots, cats, 900, 600, mono, { labels: true });
    expect(lay.districts.map((d) => d.name)).not.toContain('Empty');
    expect(lay.parcels).toHaveLength(18);
    expect(new Set(lay.parcels.map((p) => p.id)).size).toBe(18);
  });

  it('orders parcels by role then name, never by standing', () => {
    const lay = computeLayout(plots, cats, 900, 600, mono);
    const alpha = lay.parcels.filter((p) => p.groupName === 'Alpha');
    const roles = alpha.map((p) => p.role);
    expect(roles.indexOf('platform')).toBeGreaterThan(roles.lastIndexOf('core'));
  });

  it('tiles the whole box', () => {
    const rects = squarify([{ v: 3 }, { v: 2 }, { v: 1 }], 0, 0, 300, 200);
    expect(rects.reduce((a, r) => a + r.w * r.h, 0)).toBeCloseTo(60000, 3);
  });
});

describe('surveyOrder', () => {
  it('starts at the primary and visits every claimed parcel', () => {
    const lay = computeLayout([plot('Alpha', 12)], new Map(), 900, 600, mono);
    const ids = ['Alpha-7', 'Alpha-1', 'Alpha-11'];
    const order = surveyOrder(ids, 'Alpha-11', lay);
    expect(order[0]?.id).toBe('Alpha-11');
    expect(order.map((p) => p.id).sort()).toEqual([...ids].sort());
  });
});
