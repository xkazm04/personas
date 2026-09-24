// Soundings — the pure core: the urgency formula the owner reviewed, the fixed
// station order, the ranking, the reasons, and the chart geometry.
import { describe, expect, it } from 'vitest';

import type { DimKey } from '../lib/dimRegistry';
import type { DimNode, DimStatus, Island } from '../lib/types';
import {
  buoyDepth,
  cardBox,
  chartGeometry,
  layoutColumn,
  spatialMove,
  stationSpan,
  type ColumnReading,
} from '../soundings/soundingsGeometry';
import {
  bandForUrgency,
  buildStations,
  daysLate,
  rankStations,
  relatedStations,
  stationMetrics,
  stationReasons,
  topReading,
  visibleEdges,
} from '../soundings/soundingsModel';

const node = (key: DimKey, status: DimStatus, detail: string | null = null): DimNode => ({ key, label: key, status, detail, reached: 0, steps: 2 });

const island = (over: Partial<Island> = {}): Island => ({
  slug: 'calm',
  name: 'Calm',
  purpose: '',
  x: 0,
  y: 0,
  state: 'healthy',
  autoScore: 80,
  prodScore: 80,
  lifecycle: 'live',
  automationLabel: '',
  blockers: 0,
  nodes: [node('db', 'solid'), node('ci', 'solid')],
  fleet: [],
  personasRunning: [],
  runners: [],
  attention: false,
  monitorErrors: 0,
  stateSource: 'readiness',
  stats: [],
  ship: null,
  ...over,
});

describe('stationMetrics — the reviewed urgency formula', () => {
  it('scores 3 per alert, 1 per risk, 2 late, 2 waiting, 3 critical, 1 unbound, a quarter per gap', () => {
    const m = stationMetrics(island({
      state: 'critical',
      nodes: [node('db', 'alert'), node('ci', 'alert'), node('tests', 'risk'), node('auth', 'absent'), node('kpi', 'unknown')],
      fleet: [{ id: 'f', label: 'otter', state: 'awaiting_input' }],
      ship: { next: 'v1', nextStatus: 'active', shipped: 1, total: 3, targetDate: '2026-09-01', forecastDate: null, late: true },
      monitorErrors: null,
    }));
    // 3*2 + 1 + 2 + 2 + 3 = 14, + 1 unbound + 0.25*2 gaps
    expect(m.urgency).toBe(15.5);
    expect(m.band).toBe(0);
    expect(m.mark).toBe('alert');
    expect(m.waiting?.label).toBe('otter');
  });

  it('a calm, bound project sits in the Deep', () => {
    const m = stationMetrics(island());
    expect(m.urgency).toBe(0);
    expect(m.band).toBe(3);
    expect(m.mark).toBe('calm');
  });

  it('a provisional island is not scored on gaps it does not have', () => {
    const m = stationMetrics(island({ provisional: true, nodes: [node('db', 'unknown'), node('ci', 'unknown')], monitorErrors: null }));
    expect(m.urgency).toBe(0);
  });

  it('band edges are 6, 2 and 1', () => {
    expect([6, 5.99, 2, 1.99, 1, 0.99].map(bandForUrgency)).toEqual([0, 1, 1, 2, 2, 3]);
  });
});

describe('stations and ranking', () => {
  const islands = [
    island({ slug: 'zeta', name: 'Zeta' }),
    island({ slug: 'alpha', name: 'Alpha', nodes: [node('db', 'alert')] }),
    island({ slug: 'mid', name: 'Mid', nodes: [node('db', 'risk')] }),
    island({ slug: 'ghost', name: 'Beta', provisional: true }),
  ];

  it('orders stations by name, not by urgency — positions never move', () => {
    expect(buildStations(islands).map((s) => s.island.slug)).toEqual(['alpha', 'ghost', 'mid', 'zeta']);
  });

  it('ranks by urgency, ties in fixed order, ghosts last', () => {
    const st = buildStations(islands);
    expect(rankStations(st).map((i) => st[i]!.island.slug)).toEqual(['alpha', 'mid', 'zeta', 'ghost']);
  });

  it('gives at most three reasons, heaviest first', () => {
    const [s] = buildStations([island({
      state: 'critical',
      lifecycle: 'stalled',
      nodes: [node('db', 'alert'), node('ci', 'risk')],
      fleet: [{ id: 'f', label: 'otter', state: 'awaiting_input' }],
      monitorErrors: null,
    })]);
    expect(stationReasons(s!).map((r) => r.kind)).toEqual(['alerts', 'stalled', 'waiting']);
  });

  it('relations resolve to station indices and drop hidden ends', () => {
    const st = buildStations(islands);
    const idx = new Map(st.map((s) => [s.island.slug, s.index]));
    const edges = visibleEdges([
      { from: 'alpha', to: 'zeta', kind: 'relation', strength: 1, label: 'api' },
      { from: 'alpha', to: 'hidden', kind: 'relation', strength: 1, label: null },
    ], idx);
    expect(edges).toHaveLength(1);
    expect(relatedStations(idx.get('alpha')!, edges, idx)).toEqual([idx.get('zeta')]);
  });

  it('opens a station on its most urgent reading', () => {
    expect(topReading(island({ nodes: [node('db', 'solid'), node('ci', 'risk'), node('tests', 'alert')] }))).toBe('tests');
  });

  it('counts whole days late, never negative', () => {
    expect(daysLate('2026-09-20', Date.UTC(2026, 8, 24))).toBe(4);
    expect(daysLate('2026-09-30', Date.UTC(2026, 8, 24))).toBe(0);
    expect(daysLate(null, 0)).toBe(0);
  });
});

describe('geometry', () => {
  const g = chartGeometry(1192, 552, 10);

  it('tiles the station area exactly at L0', () => {
    const spans = Array.from({ length: 10 }, (_, i) => stationSpan(g, i, 0, 0, 10));
    for (let i = 1; i < spans.length; i++) expect(spans[i]!.l).toBe(spans[i - 1]!.l + spans[i - 1]!.w);
    expect(spans[9]!.l + spans[9]!.w).toBe(Math.round(g.x1));
  });

  it('widens the open station and keeps the others as slivers in order', () => {
    const open = stationSpan(g, 4, 1, 4, 10);
    expect(stationSpan(g, 3, 1, 4, 10).w).toBe(g.sliver);
    expect(open.w).toBe(g.x1 - g.x0 - 9 * g.sliver);
    expect(stationSpan(g, 5, 1, 4, 10).l).toBeGreaterThanOrEqual(open.l + open.w);
  });

  it('floats more urgent buoys higher', () => {
    const ys = [12, 6, 3, 1.5, 0].map((u) => buoyDepth(g, u));
    for (let i = 1; i < ys.length; i++) expect(ys[i]!).toBeGreaterThan(ys[i - 1]!);
    expect(buoyDepth(g, 6)).toBeLessThan(g.wl);
  });

  it('packs every reading into its lane and band without overlap', () => {
    const readings: ColumnReading[] = [
      { key: 'db', status: 'alert', category: 'runtime', twoLine: true },
      { key: 'monitoring', status: 'risk', category: 'runtime', twoLine: true },
      { key: 'ci', status: 'solid', category: 'delivery', twoLine: true },
      { key: 'tests', status: 'partial', category: 'delivery', twoLine: false },
      { key: 'agents', status: 'absent', category: 'agentic', twoLine: false },
      { key: 'kpi', status: 'unknown', category: 'product', twoLine: true },
    ];
    const open = stationSpan(g, 0, 1, 0, 10);
    const col = layoutColumn(g, open.w, readings);
    expect(Object.keys(col.frames).sort()).toEqual(readings.map((r) => r.key).sort());
    // Surface readings sit above the waterline, done readings below the last edge.
    expect(col.frames.db!.y + col.frames.db!.h).toBeLessThanOrEqual(g.wl);
    expect(col.frames.ci!.y).toBeGreaterThanOrEqual(col.b2);
    const boxes = Object.values(col.frames);
    for (const a of boxes) for (const b of boxes) {
      if (a === b) continue;
      const apart = a!.x + a!.w <= b!.x || b!.x + b!.w <= a!.x || a!.y + a!.h <= b!.y || b!.y + b!.h <= a!.y;
      expect(apart).toBe(true);
    }
    // Arrow keys move to the nearest frame that way, never backwards.
    const right = spatialMove(col.frames, 'db', 'ArrowRight');
    expect(right).not.toBeNull();
    expect(col.frames[right!]!.x).toBeGreaterThan(col.frames.db!.x);
    expect(spatialMove(col.frames, 'db', 'ArrowLeft')).toBeNull();
  });

  it('the card fits inside the chart', () => {
    const c = cardBox(g);
    expect(c.x + c.w).toBeLessThanOrEqual(g.W);
    expect(c.y + c.h).toBeLessThanOrEqual(g.H);
  });
});
