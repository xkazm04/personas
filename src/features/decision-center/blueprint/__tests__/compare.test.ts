// @vitest-environment node
/**
 * Compare two recorded dates (model/compare.ts), held by bp's own cases: bp scripts/check-compare.ts @ 93f30b0, part 1
 * (core). Part 2 drives bp's Engine (setCompare, the hash) and belongs to WP2's wiring. compareLines returns data here;
 * `bpText` below re-composes bp's English from it and must equal bp's pinned strings, which proves the structure
 * carries everything the sentence needs.
 */
import { describe, expect, it } from 'vitest';
import { changedIn, compareDates, compareLines, endpoint, type CompareEntry, type CompareLine, type Endpoint } from '../model/compare';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const NOW = '2026-10-31', A = '2026-10-05', B = '2026-10-25';
const lat = { key: 'latency', label: 'Latency', type: 'number', unit: 'ms', metric: { method: 'static', better: 'down' } };
const lens: Any = { id: 'perf', name: 'Performance', headline: lat, manifest: { fields: [lat], health: { default: 'good', rules: [] } } };
const feat = (id: string, revs: Any[], stage: string): Any => ({ id, stage, revs, lens: {} });
const f1 = feat('f1', [{ stage: 'beta', date: '2026-09-01' }, { stage: 'live', date: '2026-10-15' }], 'live');
const f2 = feat('f2', [{ stage: 'beta', date: '2026-09-01' }], 'beta');
const f3 = feat('f3', [{ stage: 'beta', date: '2026-09-01' }], 'beta');
let n = 0;
const r = (feature: string, at: string, value: number, x: Any = {}) => ({ id: ++n, run_id: 'r', feature, lens: 'perf', metric: 'latency', value, measured_at: at + 'T10:00:00Z', ...x });
const scan: Any = { measurements: [
  r('f1', '2026-10-01', 120), r('f1', '2026-10-20', 180), r('f1', '2026-10-28', 999), r('f1', '2026-10-22', 5, { phase: 'after', proposal_id: 'p' }),
  r('f2', '2026-10-12', 42), r('f3', '2026-10-01', 50),
] };

/** bp's compareLines wording, re-composed from the structured line (bp compare.ts @ 93f30b0). */
const num = (v: number) => String(Number.isInteger(v) ? v : +v.toFixed(2));
const withUnit = (v: number, unit: string) => num(v) + (unit ? (unit === '%' ? '%' : ' ' + unit) : '');
const ep = (e: Endpoint) => (e.at === 'now' ? 'now' : e.date);
function bpText(l: CompareLine, lensName: (id: string) => string, stageWord: (s: string) => string): string {
  const st = (s: string | null) => (s ? stageWord(s) : 'not on the drawing yet');
  if (l.kind === 'stage') return 'Stage: ' + st(l.a) + ' on ' + ep(l.A) + ' → ' + st(l.b) + ' on ' + ep(l.B);
  if (l.kind === 'move') return lensName(l.lens) + ' · ' + l.label + ': ' + withUnit(l.a.value, l.unit) + ' (read ' + l.a.measured + ') → ' + withUnit(l.b.value, l.unit) + ' (read ' + l.b.measured + ')';
  if (l.kind === 'first') return lensName(l.lens) + ' · ' + l.label + ': first observation ' + withUnit(l.b.value, l.unit) + ' (read ' + l.b.measured + '); nothing was recorded by ' + ep(l.A);
  return lensName(l.lens) + ' health: ' + l.a + ' on ' + ep(l.A) + ' → ' + l.b + ' on ' + ep(l.B) + " (both replayed by today's rules)";
}

describe('compareDates (bp check-compare part 1)', () => {
  const c = compareDates([f1, f2, f3], [lens], scan, A, B, NOW);
  const e1 = c.byId.get('f1')!, e2 = c.byId.get('f2')!;

  it('marks exactly f1 and f2', () => { expect(c.ids).toEqual(['f1', 'f2']); });
  it('f1: the stage change beta -> live is reported', () => { expect(e1.stage).toEqual({ a: 'beta', b: 'live' }); });
  it('f1: the numeric move 120 (read 10-01) -> 180 (read 10-20); the 10-28 reading and the after-phase 5 never count', () => {
    expect(e1.moves).toHaveLength(1);
    expect(e1.moves[0]!.a).toEqual({ value: 120, measured: '2026-10-01' });
    expect(e1.moves[0]!.b).toEqual({ value: 180, measured: '2026-10-20' });
  });
  it('f2: a first observation (42 read 10-12), no move and no baseline value', () => {
    expect(e2.firsts).toHaveLength(1);
    expect(e2.moves).toHaveLength(0);
    expect(e2.firsts[0]!.b.value).toBe(42);
    expect('a' in e2.firsts[0]!).toBe(false);
  });
  it('counts: 1 stage change, 1 move, 1 first observation', () => {
    expect(c.counts).toMatchObject({ stage: 1, moves: 1, firsts: 1 });
  });
  it('lines carry what bp says, word for word', () => {
    const words = (e: CompareEntry) => compareLines(e, A, B, NOW).map((l) => bpText(l, () => 'Performance', (s) => s[0]!.toUpperCase() + s.slice(1)));
    const w1 = words(e1), w2 = words(e2);
    expect(w1[0]).toBe('Stage: Beta on 2026-10-05 → Live on 2026-10-25');
    expect(w1[1]).toBe('Performance · Latency: 120 ms (read 2026-10-01) → 180 ms (read 2026-10-20)');
    expect(w2[0]).toBe('Performance · Latency: first observation 42 ms (read 2026-10-12); nothing was recorded by 2026-10-05');
    expect(compareLines(e1, A, B, NOW).map((l) => l.kind)).toEqual(['stage', 'move']);
  });
  it('with B at now every current reading counts (the 10-28 reading, not the after-phase one)', () => {
    expect(compareDates([f1, f2, f3], [lens], scan, A, NOW, NOW).byId.get('f1')!.moves[0]!.b.value).toBe(999);
  });
  it('with no scan only stages compare (Kettle): f1 alone', () => {
    expect(compareDates([f1, f2, f3], [lens], undefined, A, B, NOW).ids).toEqual(['f1']);
  });
  it('changedIn counts the place members that changed; endpoint says now at or after the data', () => {
    expect(changedIn(c, [f1, f3])).toBe(1);
    expect(endpoint(NOW, NOW)).toEqual({ at: 'now' });
    expect(endpoint(A, NOW)).toEqual({ at: 'date', date: A });
  });
});
