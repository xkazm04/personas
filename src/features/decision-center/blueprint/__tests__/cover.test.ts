// @vitest-environment node
/**
 * "What clears it" knowing its proposals (standard/cover.ts) and the path it is judged against (standard/clear.ts),
 * held by bp's own cases: bp scripts/check-clear-cover.ts @ 93f30b0 parts 1-4 and 6, and bp scripts/check-clear-path.ts
 * cases 1-6 over the Kettle fixture's own copies of the built-in manifests (the same rules as bp docs/standard/lenses).
 * Cases 5-6 there are a property over every unwell Kettle pair; bp's sample has 140+ pairs, the trimmed fixture fewer,
 * so the property holds for every pair here and bp's absolute floors are not carried. The renders (clear-cover part 5,
 * clear-path case 7) are WP3's UI.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { kettleData } from '../fixture/kettle';
import { buildPlan } from '../model/plan';
import { clearPath, type ClearStep } from '../standard/clear';
import { coverStep } from '../standard/cover';
import { evaluateCondition, evaluateLens, matchRule } from '../standard/health';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const J = (x: unknown) => JSON.stringify(x);
const pick = (c: Any) => c && { id: c.id, phase: c.phase, value: c.value, verdict: c.verdict, short: c.short };
const pickStep = (s: Any) => s && { field: s.field, now: s.now, target: s.target, op: s.op, rule: s.rule };

const manifest: Any = {
  id: 'fixture', name: 'Fixture', version: '1.0.0',
  fields: [
    { key: 'latency', label: 'Latency', type: 'number', unit: 'ms', metric: { method: 'static', better: 'lower' } },
    { key: 'errors', label: 'Errors', type: 'integer', metric: { method: 'static', better: 'lower' } },
  ],
  health: { default: 'good', rules: [
    { when: { field: 'latency', gt: 400 }, health: 'bad', reason: 'Latency {latency} ms' },
    { when: { field: 'latency', gt: 300 }, health: 'watch', reason: 'Latency {latency} ms is slow' },
  ] },
};
const at = { feature: 'checkout', lens: 'fixture' };
const P = (id: string, x: Any): Any => ({ id, run_id: 'r1', feature: 'checkout', lens: 'fixture', metric: 'latency', title: 'Fix ' + id, standard: 'none', kind: 'improvement', status: 'proposed', created_at: '2026-10-01', updated_at: '2026-10-01', ...x });
const values = { latency: 420 };
const step = clearPath(manifest, values).steps[0] as ClearStep;

describe('coverStep (bp check-clear-cover)', () => {
  it('1. the fixture solves to latency 420 -> at most 400', () => {
    expect({ field: step.field, now: step.now, target: step.target, op: step.op }).toEqual({ field: 'latency', now: 420, target: 400, op: 'at most' });
  });
  it('2. A (-80) clears', () => {
    const A = coverStep(step, [P('A', { status: 'approved', expected_delta: -80 })], values, manifest, at);
    expect(A.covered && J(pick(A.best))).toBe(J({ id: 'A', phase: 'expected', value: 340, verdict: 'clears', short: 0 }));
  });
  it('2. B (-10) is short by 10', () => {
    const B = coverStep(step, [P('B', { status: 'proposed', expected_delta: -10 })], values, manifest, at);
    expect(B.covered && J(pick(B.best))).toBe(J({ id: 'B', phase: 'expected', value: 410, verdict: 'short', short: 10 }));
  });
  it('2. C (done, after 390) delivered and cleared, judged on the after value not the delta', () => {
    const C = coverStep(step, [P('C', { status: 'done', expected_delta: -5, after_value: 390 })], values, manifest, at);
    expect(C.covered && J(pick(C.best))).toBe(J({ id: 'C', phase: 'delivered', value: 390, verdict: 'clears', short: 0 }));
  });
  it('2. A against the watch step (at most 300) is short by 40', () => {
    const wst = clearPath(manifest, values).steps[1]!, A2 = coverStep(wst, [P('A', { status: 'approved', expected_delta: -80 })], values, manifest, at);
    expect(wst.rule).toBe('watch');
    expect(wst.target).toBe(300);
    expect(A2.covered && A2.best.verdict).toBe('short');
    expect(A2.covered && A2.best.short).toBe(40);
  });
  it('2. no proposal -> uncovered; a delta the wrong way -> worse; no delta -> unsized; values untouched', () => {
    expect(coverStep(step, [], values, manifest, at)).toEqual({ covered: false });
    const W = coverStep(step, [P('W', { expected_delta: 30 })], values, manifest, at);
    expect(W.covered && W.best.verdict).toBe('worse');
    const U = coverStep(step, [P('U', {})], values, manifest, at);
    expect(U.covered && [U.best.phase, U.best.verdict]).toEqual(['unsized', null]);
    expect(values.latency).toBe(420);
  });
  it('3. other feature / lens / metric and declined, failed, descoped, rework items do not cover', () => {
    const noise = [
      P('x1', { feature: 'other', expected_delta: -80 }), P('x2', { lens: 'other', expected_delta: -80 }), P('x3', { metric: 'errors', expected_delta: -80 }),
      P('x4', { status: 'declined', expected_delta: -80 }), P('x5', { status: 'failed', expected_delta: -80 }), P('x6', { status: 'descoped', expected_delta: -80 }), P('x7', { status: 'rework', expected_delta: -80 }),
    ];
    expect(coverStep(step, noise, values, manifest, at)).toEqual({ covered: false });
  });
  it('3. proposed, approved, executing, done, accepted and released items cover', () => {
    const ok = ['proposed', 'approved', 'executing', 'done', 'accepted', 'released'].map((s) => coverStep(step, [P('s', { status: s, expected_delta: -80 })], values, manifest, at).covered);
    expect(ok.every((x) => x === true)).toBe(true);
  });
  it('3. several: the clearing one is best, then short, then worse', () => {
    const all = coverStep(step, [P('B', { expected_delta: -10 }), P('W', { expected_delta: 30 }), P('A', { status: 'approved', expected_delta: -80 })], values, manifest, at);
    expect(all.covered && all.best.id).toBe('A');
    expect(all.covered && all.all.map((c) => c.id)).toEqual(['A', 'B', 'W']);
  });
  it('4. any(latency, errors): the latency fix clears its step while errors is still unfixed', () => {
    const m2: Any = { ...manifest, health: { default: 'good', rules: [{ when: { any: [{ field: 'latency', gt: 400 }, { field: 'errors', gt: 5 }] }, health: 'bad', reason: 'Slow or failing' }] } };
    const v2 = { latency: 420, errors: 9 }, steps = clearPath(m2, v2).steps, ls = steps.find((s) => s.field === 'latency')!;
    const r = coverStep(ls, [P('A', { expected_delta: -80 })], v2, m2, at);
    expect(steps).toHaveLength(2);
    expect(r.covered && r.best.verdict).toBe('clears');
  });
  it('6. lenses are data: cover.ts and clear.ts name no lens id', () => {
    for (const f of ['../standard/cover.ts', '../standard/clear.ts']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(/business|design|development|operations|performance|quality|security/.test(src)).toBe(false);
    }
  });
});

// ------------------------------------------------------------------ bp check-clear-path
const plan = buildPlan(kettleData().structure, kettleData().events);
const lens = (id: string): Any => plan.LENS[id]!.manifest;
const apply = (v: Any, steps: readonly Any[]) => { const o = { ...v }; for (const s of steps) o[s.field] = s.target; return o; };
const evalWith = (m: Any, v: Any, today: string) => {
  const feature: Any = {}, kpis: Any[] = [];
  for (const x of m.fields) if (x.source && v[x.key] !== undefined) { if ('feature' in x.source) feature[x.source.feature] = v[x.key]; else kpis.push({ slug: x.source.kpi, current: { value: v[x.key] } }); }
  return evaluateLens(m, { values: v }, today, { feature, kpis }).health;
};

describe('clearPath (bp check-clear-path)', () => {
  it('1. two matching rules -> two steps in rule order; applying them reads good', () => {
    const q = lens('quality'), v = { status: 'passed', openBugsP1: 2, brokenTests: 0, e2ePassPct: 92, e2eTests: 5, untestedPaths: 0 };
    const r = clearPath(q, v);
    expect(r.steps.map(pickStep)).toEqual([{ field: 'openBugsP1', now: 2, target: 0, op: 'at most', rule: 'bad' }, { field: 'e2ePassPct', now: 92, target: 100, op: 'at least', rule: 'watch' }]);
    expect(r.blocked).toBeNull();
    expect(evalWith(q, apply(v, r.steps), '2026-10-08')).toBe('good');
  });
  it('2. all(stage, e2eTests < 3) clears through e2eTests, never the stage', () => {
    const r = clearPath(lens('quality'), { status: 'passed', stage: 'live', e2eTests: 1, e2ePassPct: 100 });
    expect(r.steps.map(pickStep)).toEqual([{ field: 'e2eTests', now: 1, target: 3, op: 'at least', rule: 'watch' }]);
  });
  it('3. enum: the last declared value no unwell rule matches; boolean: its other value', () => {
    expect(clearPath(lens('design'), { a11y: 'partial' }).steps.map(pickStep)).toEqual([{ field: 'a11y', now: 'partial', target: 'pass', op: 'set to', rule: 'watch' }]);
    expect(clearPath(lens('operations'), { alerting: false }).steps.map(pickStep)).toEqual([{ field: 'alerting', now: false, target: true, op: 'set to', rule: 'watch' }]);
  });
  it('4. the margin to the next worse health', () => {
    const p = lens('performance');
    expect(clearPath(p, { frameP95Ms: 41 }).worse).toEqual({ field: 'frameP95Ms', bound: 50, health: 'bad', margin: 9 });
    const g = clearPath(p, { frameP95Ms: 30 });
    expect(g.worse).toEqual({ field: 'frameP95Ms', bound: 33.3, health: 'watch', margin: 3.3 });
    expect(g.steps).toHaveLength(0);
    expect(g.blocked).toBeNull();
  });
  it('5-6. every unwell, non-overridden Kettle pair: a verified list (or a blocked reason), one step per matching rule', () => {
    let pairs = 0, listed = 0;
    const bad: string[] = [];
    for (const f of plan.S.features) for (const d of plan.lenses) {
      const fl = f.lens[d.id];
      if (!fl || (fl.h !== 'watch' && fl.h !== 'bad') || fl.ov) continue;
      pairs++;
      const m = d.manifest, r = clearPath(m, fl.v), k = f.id + '/' + d.id;
      const matched = m.health.rules.filter((x) => evaluateCondition(x.when, fl.v)).length;
      if (r.steps.length) {
        listed++;
        const after = apply(fl.v, r.steps);
        if (r.blocked !== null || matchRule(m, after) !== null || evalWith(m, after, plan.S.asOf) !== m.health.default) bad.push(k + ' leaves it unwell');
        if (r.steps.some((s) => { const x = m.fields.find((y) => y.key === s.field); return !!x?.source && 'feature' in x.source; })) bad.push(k + ' offers a feature-bound field');
        if (matched > 1 && r.steps.length < matched) bad.push(k + ' matches ' + matched + ' rules, ' + r.steps.length + ' steps');
      } else if (!r.blocked) bad.push(k + ' has no steps and no blocked reason');
    }
    expect(bad).toEqual([]);
    expect(pairs).toBeGreaterThan(0);
    expect(listed).toBeGreaterThan(0);
  });
});
