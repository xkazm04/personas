import { describe, expect, it } from 'vitest';

import type { LifecycleRelatedItem } from '@/lib/bindings/LifecycleRelatedItem';
import type { LifecycleStepDetail } from '@/lib/bindings/LifecycleStepDetail';
import type { LifecycleStepParams } from '@/lib/bindings/LifecycleStepParams';

import { docRow, run } from '../../../../journey/__tests__/detailFixtures';
import { DEFAULT_RULES, evidenceItem, healthyMix } from '../../../../journey/__tests__/fixtures';
import { buildLanes } from '../../../../journey/journeyModel';
import { historyOf, sixMeasures } from '../../../history/__tests__/historyFixtures';
import { timeline } from '../../../history/historyModel';
import { joinHealth, type HealthStep } from '../../../layer1/healthModel';
import { changeStreak, commonSkipReason, measureStreak, nextPlan, NEXT_CAP, type NextInput } from '../nextModel';

const snap = healthyMix();
const order = (() => { const l = buildLanes(snap); return [...l.before, ...l.after]; })();
const PARAMS: LifecycleStepParams = order[0]!.view.step.params;

function stepOf(id: string, patch: Partial<HealthStep> = {}): HealthStep {
  return { ...joinHealth(order.filter((n) => n.id === id), snap.health)[0]!, ...patch };
}

function detail(stepId: string, patch: Partial<LifecycleStepDetail> = {}): LifecycleStepDetail {
  return { stepId, runs: [], docs: [], related: [], evidence: [], ...patch };
}

function item(id: string, source: LifecycleRelatedItem['source'], status = 'accepted', commandId: string | null = null): LifecycleRelatedItem {
  return { id, title: `Item ${id}`, status, verifyState: null, source, commandId, createdAt: '2026-10-08T08:00:00Z' };
}

function plan(stepId: string, over: Partial<NextInput> = {}) {
  return nextPlan({ step: stepOf(stepId), params: PARAMS, rules: DEFAULT_RULES, detail: detail(stepId), columns: [], ...over });
}

describe('nextPlan', () => {
  it('a failing command comes first, with its first error', () => {
    const d = detail('gate', { runs: [run('eslint', 'lint', 'failed', 20_000, { firstError: 'boom' }), run('tsc', 'typecheck', 'passed', 30_000)] });
    const p = plan('gate', { detail: d });
    expect(p.actions[0]).toMatchObject({ kind: 'failing', commandId: 'eslint', error: 'boom' });
  });

  it('a passing command over its budget names how far over, and the slow-gate item filed about it', () => {
    const slow = item('i-tsc', 'slow_gate', 'accepted', 'tsc');
    const d = detail('gate', { runs: [run('tsc', 'typecheck', 'passed', 74_000)], related: [item('i-other', 'slow_gate', 'pending', 'eslint'), slow] });
    const a = plan('gate', { detail: d }).actions[0];
    expect(a).toMatchObject({ kind: 'over_budget', commandId: 'tsc', overMs: 14_000, budgetMs: 60_000 });
    expect(a?.kind === 'over_budget' && a.item?.id).toBe('i-tsc');
  });

  it('over budget with no item filed carries no item (the panel offers to edit the budget)', () => {
    const a = plan('gate', { detail: detail('gate', { runs: [run('tsc', 'typecheck', 'passed', 74_000)] }) }).actions[0];
    expect(a).toMatchObject({ kind: 'over_budget', item: null });
  });

  it('ranks by impact and caps at three: failure, then broken docs-like blockers, then slow passes', () => {
    const d = detail('gate', {
      runs: [
        run('tsc', 'typecheck', 'passed', 74_000),
        run('lint', 'lint', 'failed', 10_000),
        run('check', 'check', 'passed', 700_000),
        run('other', 'other', 'failed', 10_000),
      ],
    });
    const p = plan('gate', { detail: d });
    expect(p.actions).toHaveLength(NEXT_CAP);
    expect(p.actions.map((a) => a.kind)).toEqual(['failing', 'failing', 'over_budget']);
  });

  it('Tests with coverage never measured and no coverage command: add one (and not "Measure now")', () => {
    const step = stepOf('tests', { health: 'unmeasured', metrics: stepOf('tests').metrics.map((m) => (m.key === 'coverage_pct' ? { ...m, value: null, ratio: null } : m)) });
    const p = plan('tests', { step, detail: detail('tests', { runs: [run('vitest', 'test', 'passed', 100_000)] }) });
    expect(p.actions.map((a) => a.kind)).toEqual(['add_coverage']);
    // A coverage command already there: nothing to add.
    const withCmd = plan('tests', { step, detail: detail('tests', { runs: [run('cov', 'coverage', 'did_not_run', 0)] }) });
    expect(withCmd.actions.some((a) => a.kind === 'add_coverage')).toBe(false);
  });

  it('a stale step: Measure now', () => {
    expect(plan('commit').actions).toEqual([{ kind: 'measure', why: 'stale' }]);
  });

  it('docs broken or out of date: the docs, worst first, with the doc-rot items filed', () => {
    const d = detail('docs', {
      docs: [docRow('a.md', 'stale'), docRow('b.md', 'broken'), docRow('c.md', 'clean')],
      related: [item('rot', 'doc_rot', 'pending'), item('ov', 'overseer')],
    });
    const a = plan('docs', { detail: d }).actions[0];
    expect(a).toMatchObject({ kind: 'fix_docs', broken: ['b.md'], stale: ['a.md'] });
    expect(a?.kind === 'fix_docs' && a.items.map((i) => i.id)).toEqual(['rot']);
  });

  it('an evidence step under target: the most common skip reason from its own evidence', () => {
    const skip = (ref: string, note: string | null) => ({ ...evidenceItem(ref, '2026-10-08T08:00:00Z', [['land', 'skipped']]), outcomes: [{ stepId: 'land', outcome: 'skipped' as const, detail: note }] });
    const evidence = [skip('a', 'No PR'), skip('b', 'Pushed to main'), skip('c', 'No PR'), skip('d', null)];
    const a = plan('land', { detail: detail('land', { evidence }) }).actions[0];
    expect(a).toMatchObject({ kind: 'adjust_practice', reason: 'No PR', count: 2, donePct: 40, targetPct: 80 });
    expect(commonSkipReason([skip('x', null)], 'land')).toEqual({ reason: null, count: 1 });
  });

  it('an evidence step with too few changes: how many more it needs (the rules say how many)', () => {
    expect(plan('sync').actions).toEqual([{ kind: 'more_evidence', have: 3, need: DEFAULT_RULES.minSamples }]);
  });

  it('healthy: no actions, one calm line with the streak (Measures for Gate, changes for an evidence step)', () => {
    const green = stepOf('gate', { health: 'green' });
    const columns = timeline(historyOf([
      { gate: ['red', 50, 1], tests: ['amber', 50, 1] },
      { gate: ['green', 100, 1], tests: ['amber', 50, 1] },
      { gate: ['green', 100, 1], tests: ['amber', 50, 1] },
    ]));
    const p = plan('gate', { step: green, columns, detail: detail('gate', { runs: [run('tsc', 'typecheck', 'passed', 10_000)] }) });
    expect(p.actions).toEqual([]);
    expect(p.healthy).toEqual({ streak: { count: 2, unit: 'measures' } });
    const done = (ref: string) => evidenceItem(ref, '2026-10-08T08:00:00Z', [['record', 'done']]);
    expect(plan('record', { detail: detail('record', { evidence: [done('a'), done('b')] }) }).healthy).toEqual({ streak: { count: 2, unit: 'changes' } });
    expect(changeStreak([done('a'), evidenceItem('s', '2026-10-01T08:00:00Z', [['record', 'skipped']]), done('b')], 'record')).toBe(1);
    expect(measureStreak(timeline(sixMeasures()), 'land')).toBeNull();
  });

  it('an instructed step has nothing to do and is not called healthy', () => {
    const p = plan('frame');
    expect(p.actions).toEqual([]);
    expect(p.healthy).toBeNull();
  });

  it('carries the Overseer items apart from the actions, open ones first', () => {
    const p = plan('record', { detail: detail('record', { related: [item('done', 'overseer', 'delivered'), item('open', 'overseer', 'pending')] }) });
    expect(p.overseer.map((i) => i.id)).toEqual(['open', 'done']);
    expect(p.actions).toEqual([]);
  });
});
