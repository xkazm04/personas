import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { deriveScene } from '../lib/deriveScene';
import type { DimStatus } from '../lib/types';
import { makePassport } from './passportFactory';

const NOW = new Date('2026-07-23T12:00:00.000Z').getTime();
const DAY = 86_400_000;

/** Resolve the Ideas dim for a project last scanned `daysAgo` days ago
 *  (null = never scanned), evaluated against the frozen NOW. */
function ideas(daysAgo: number | null): { status: DimStatus; detail: string | null; days: number | null } {
  const at = daysAgo === null ? null : new Date(NOW - daysAgo * DAY).toISOString();
  const map = new Map<string, string | null>([['s', at]]);
  const scene = deriveScene([makePassport({ slug: 's' })], null, false, undefined, map);
  const node = scene.islands[0].nodes.find((n) => n.key === 'ideas')!;
  return { status: node.status, detail: node.detail, days: node.days ?? null };
}

describe('deriveScene — Ideas freshness boundaries', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('never scanned → absent', () => {
    expect(ideas(null)).toEqual({ status: 'absent', detail: null, days: null });
  });

  it('today (0d) → solid, detail "today"', () => {
    const r = ideas(0);
    expect(r.status).toBe('solid');
    expect(r.detail).toBe('today');
  });

  it('6 days → solid (still fresh)', () => {
    expect(ideas(6).status).toBe('solid');
  });

  it('7 days → risk (crosses the amber boundary)', () => {
    expect(ideas(7).status).toBe('risk');
  });

  it('30 days → risk (upper amber edge, inclusive)', () => {
    expect(ideas(30).status).toBe('risk');
  });

  it('31 days → alert (crosses the red boundary)', () => {
    expect(ideas(31).status).toBe('alert');
  });

  it('reports the day count in detail', () => {
    expect(ideas(12).detail).toBe('12d ago');
  });
});
