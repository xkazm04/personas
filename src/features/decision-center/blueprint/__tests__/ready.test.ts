// @vitest-environment node
/**
 * Readiness (model/ready.ts), held by bp's own cases: bp scripts/check-readiness.ts @ 93f30b0, parts 1 (five features)
 * and 2 (cross-lens conflicts). Part 3 drives bp's Engine (G, the hash, the dimming) and belongs to WP2. Readiness
 * returns data here; `lineText` / `conflictText` / `blockText` re-compose bp's English from it and must equal bp's
 * pinned strings.
 */
import { describe, expect, it } from 'vitest';
import { evaluateLens } from '../standard/health';
import type { ClearBlock } from '../standard/clear';
import { readiness, readinessLine, type ReadyBlock, type ReadyConflict, type ReadyPart, type Readiness } from '../model/ready';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const NOW = '2026-10-31';
const lat = { key: 'latency', label: 'Latency', type: 'number', unit: 'ms', metric: { method: 'probe', better: 'down' } };
const err = { key: 'errors', label: 'Errors', type: 'integer', metric: { method: 'probe', better: 'down' } };
const stg = { key: 'stage', label: 'Stage', type: 'enum', values: ['beta', 'live'], source: { feature: 'stage' } };
const perf: Any = { id: 'perf', name: 'Performance', headline: lat, manifest: { fields: [lat, err, stg], health: { default: 'good', rules: [
  { when: { field: 'stage', eq: 'beta' }, health: 'bad', reason: 'Still in beta' },
  { when: { field: 'latency', gt: 300 }, health: 'bad', reason: 'Latency {latency} ms' },
  { when: { field: 'errors', gt: 5 }, health: 'watch', reason: '{errors} errors' },
] } } };
const feature = (id: string, lenses: Any[], v: Record<string, Any>, stage = 'live'): Any => {
  const lens: Any = {};
  for (const d of lenses) {
    const e = evaluateLens(d.manifest, { values: v }, NOW, { feature: { stage } as Any });
    lens[d.id] = { h: e.health, v: e.values, why: null, short: null, whyFields: [], ov: null, facet: { values: v } };
  }
  return { id, stage, lens, revs: [] };
};
let mid = 0;
const r = (f: string, lens: string, metric: string, value: number, at: string, x: Any = {}) => ({ id: ++mid, run_id: 'r', feature: f, lens, metric, value, measured_at: at + 'T08:00:00Z', ...x });
const prop = (id: string, f: string, delta: number) => ({ id, run_id: 'r', feature: f, lens: 'perf', metric: 'latency', title: id, standard: 's', kind: 'fix', status: 'proposed', expected_delta: delta, created_at: NOW, updated_at: NOW });

// bp's English, re-composed from the data (bp ready.ts / clear.ts @ 93f30b0)
const plural = (n: number, w: string) => n + ' ' + w + (n === 1 ? '' : 's');
function partText(p: ReadyPart, long: boolean): string {
  switch (p.kind) {
    case 'clear': return long ? plural(p.n, 'feature') + ': ' + p.clear + ' clear every lens' : p.clear + ' of ' + p.n + ' clear';
    case 'unproven': return p.n + ' unproven' + (long ? ' (readings older than ' + p.maxAgeDays + ' d, or none)' : '');
    case 'steps': return plural(p.steps, 'step') + ', ' + p.covered + ' covered, ' + p.short + ' short';
    case 'blocked': return p.n + ' blocked';
    case 'conflicts': return p.n + ' with a cross-lens conflict';
  }
}
const lineText = (R: Readiness, long = false) => readinessLine(R, long).map((p) => partText(p, long)).join(' · ');
function clearText(b: ClearBlock): string {
  if (b.kind === 'bound') return '"' + b.why + '" turns on ' + b.labels.join(' and ') + ' alone: no measured value clears it.';
  if (b.kind === 'no-value') return '"' + b.why + '" waits on ' + b.label + ', which has no value to change.';
  if (b.kind === 'no-single') return 'No single value of ' + b.label + ' clears "' + b.why + '".';
  return 'Clearing each rule on its own still leaves it unwell: it needs more than one value changed.';
}
const blockText = (name: string, w: ReadyBlock) => (w.kind === 'no-rules' ? name + ' has no rules to clear by.'
  : w.kind === 'path' ? name + ': ' + clearText(w.block) : name + ' reads ' + w.health + (w.override ? ' by an override' : '') + ': no rule to clear matches.');
function conflictText(c: ReadyConflict, name: (id: string) => string): string {
  if (c.kind === 'clash') {
    const ask = c.ask.op === 'set' ? 'set to ' + String(c.ask.a) + ' and to ' + String(c.ask.b) : 'at least ' + c.ask.lo + ' and at most ' + c.ask.hi;
    return c.field + ': ' + c.lenses.map(name).join(' and ') + ' ask for ' + ask + ': both cannot hold';
  }
  if (c.kind === 'worse') return 'Clearing ' + c.by.map(name).join(' and ') + ' makes ' + name(c.lens) + ' ' + c.health;
  return 'With every step applied ' + name(c.lens) + ' still reads ' + c.health;
}

describe('readiness over five features (bp check-readiness part 1)', () => {
  const F: Any = {
    a: feature('a', [perf], { latency: 100, errors: 0 }),
    b: feature('b', [perf], { latency: 100, errors: 0 }),
    c: feature('c', [perf], { latency: 400, errors: 0 }),
    d: feature('d', [perf], { latency: 400, errors: 9 }),
    e: feature('e', [perf], { latency: 100, errors: 0 }, 'beta'),
  };
  const scan: Any = { measurements: [
    r('a', 'perf', 'latency', 100, '2026-10-26'),
    r('b', 'perf', 'latency', 100, '2026-09-16'), r('b', 'perf', 'latency', 90, '2026-10-30', { phase: 'after', proposal_id: 'pb' }),
    r('c', 'perf', 'latency', 400, '2026-10-29'), r('d', 'perf', 'latency', 400, '2026-10-29'), r('e', 'perf', 'latency', 100, '2026-10-29'),
  ], proposals: [prop('pc', 'c', -150), prop('pd', 'd', -50)] };
  const R = readiness({ lenses: [perf], F }, scan, ['a', 'b', 'c', 'd', 'e'], { maxAgeDays: 30, now: NOW });

  it('the 5-feature summary', () => {
    expect(lineText(R)).toBe('1 of 5 clear · 1 unproven · 3 steps, 1 covered, 1 short · 1 blocked');
    expect(readinessLine(R).map((p) => p.kind)).toEqual(['clear', 'unproven', 'steps', 'blocked']);
  });
  it('per feature: a clear, b unproven, c and d steps, e blocked', () => {
    expect(R.features.map((f) => f.id + ':' + f.kind).join(' ')).toBe('a:clear b:unproven c:steps d:steps e:blocked');
  });
  it("b's newest current reading is the 45-day-old one; the fresh after-phase reading never counts", () => {
    expect(R.features.find((f) => f.id === 'b')!.lenses[0]).toEqual({ lens: 'perf', kind: 'unproven', newest: '2026-09-16', ageDays: 45 });
  });
  it('an after-phase reading alone never makes a feature clear (an old current one stays unproven)', () => {
    const only: Any = { measurements: [r('a', 'perf', 'latency', 100, '2026-10-30', { phase: 'after', proposal_id: 'x' }), r('a', 'perf', 'latency', 100, '2026-08-01')], proposals: [] };
    const o = readiness({ lenses: [perf], F }, only, ['a'], { maxAgeDays: 30, now: NOW });
    expect(o.clear).toBe(0);
    expect(o.unproven).toBe(1);
  });
  it("e is blocked with clearPath's reason", () => {
    const e = R.features.find((f) => f.id === 'e')!.lenses[0]!;
    expect(e.kind).toBe('blocked');
    if (e.kind !== 'blocked') return;
    expect(e.why).toEqual({ kind: 'path', block: { kind: 'bound', why: 'Still in beta', labels: ['Stage'] } });
    expect(blockText('Performance', e.why)).toMatch(/Stage alone/);
  });
  it('the long line', () => {
    expect(lineText(R, true)).toBe('5 features: 1 clear every lens · 1 unproven (readings older than 30 d, or none) · 3 steps, 1 covered, 1 short · 1 blocked');
  });
});

describe('cross-lens conflicts (bp check-readiness part 2)', () => {
  const names: Record<string, string> = { perf: 'Performance', cost: 'Cost', slow: 'Slow' };
  const name = (id: string) => names[id] ?? id;
  it('clearing Performance (latency at most 300) makes Cost watch', () => {
    const cost: Any = { id: 'cost', name: 'Cost', headline: lat, manifest: { fields: [lat], health: { default: 'good', rules: [{ when: { field: 'latency', lt: 350 }, health: 'watch', reason: 'Overprovisioned at {latency} ms' }] } } };
    const F: Any = { x: feature('x', [perf, cost], { latency: 400, errors: 0 }) };
    const R = readiness({ lenses: [perf, cost], F }, { measurements: [], proposals: [] }, ['x'], { maxAgeDays: 30, now: NOW });
    expect(R.features[0]!.conflicts.map((c) => conflictText(c, name))).toContain('Clearing Performance makes Cost watch');
    expect(R.conflicts).toBe(1);
  });
  it('two lenses asking latency for incompatible bounds', () => {
    const slow: Any = { id: 'slow', name: 'Slow', headline: lat, manifest: { fields: [lat], health: { default: 'good', rules: [{ when: { field: 'latency', lt: 500 }, health: 'bad', reason: 'Too fast' }] } } };
    const G: Any = { y: feature('y', [perf, slow], { latency: 400, errors: 0 }) };
    const c2 = readiness({ lenses: [perf, slow], F: G }, { measurements: [], proposals: [] }, ['y'], { maxAgeDays: 30, now: NOW }).features[0]!.conflicts;
    expect(c2.map((c) => conflictText(c, name))).toContain('latency: Performance and Slow ask for at least 500 and at most 300: both cannot hold');
    expect(c2.find((c) => c.kind === 'clash')).toEqual({ kind: 'clash', field: 'latency', lenses: ['perf', 'slow'], ask: { op: 'range', lo: 500, hi: 300 } });
  });
});
