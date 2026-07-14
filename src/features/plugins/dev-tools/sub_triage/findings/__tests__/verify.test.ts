import { describe, it, expect } from 'vitest';

import { verdictFor, isVerifiable, primaryMetric, MATERIAL_IMPROVEMENT } from '../verify';
import type { FindingDraft } from '../types';
import type { DevIdea } from '@/lib/bindings/DevIdea';
import type { DevTask } from '@/lib/bindings/DevTask';

function finding(over: Partial<DevIdea>): DevIdea {
  return {
    id: 'i1',
    origin: 'llm_cost',
    dedup_key: 'llm:cost:summarize',
    evidence: JSON.stringify({ costUsd: 100, calls: 10 }),
    status: 'accepted',
    ...over,
  } as unknown as DevIdea;
}

function draft(evidence: Record<string, unknown>, origin = 'llm_cost'): FindingDraft {
  return {
    origin: origin as FindingDraft['origin'],
    title: 't',
    description: 'd',
    category: 'performance',
    evidence,
    dedupKey: 'llm:cost:summarize',
  };
}

describe('verdictFor — the signal is gone', () => {
  it('CLEARED when the sensor no longer emits the finding at all', () => {
    const v = verdictFor(finding({}), undefined);
    expect(v.state).toBe('cleared');
    expect(v.evidence).toMatchObject({ signal: 'absent' });
  });
});

describe('verdictFor — the signal is still there', () => {
  it('MOVED when the metric improved materially', () => {
    const v = verdictFor(finding({}), draft({ costUsd: 40 })); // 100 → 40
    expect(v.state).toBe('moved');
    expect(v.evidence).toMatchObject({ costUsd: 40 });
  });

  it('REGRESSED when it got materially worse', () => {
    expect(verdictFor(finding({}), draft({ costUsd: 180 })).state).toBe('regressed');
  });

  it('UNCHANGED when the change is below the material threshold (no win on noise)', () => {
    const noise = 100 * (1 + MATERIAL_IMPROVEMENT / 2); // under the bar
    expect(verdictFor(finding({}), draft({ costUsd: noise })).state).toBe('unchanged');
  });
});

describe('verdictFor — HONESTY: never invent a cleared', () => {
  it('UNCHANGED (not cleared) when the original evidence is missing', () => {
    expect(verdictFor(finding({ evidence: null }), draft({ costUsd: 10 })).state).toBe('unchanged');
  });

  it('UNCHANGED (not cleared) when the evidence is unparseable', () => {
    expect(verdictFor(finding({ evidence: '{not json' }), draft({ costUsd: 10 })).state).toBe('unchanged');
  });

  it('UNCHANGED (not cleared) when the fresh reading has no comparable metric', () => {
    expect(verdictFor(finding({}), draft({ somethingElse: 1 })).state).toBe('unchanged');
  });

  it('UNCHANGED for a presence-shaped origin that is still emitting', () => {
    const f = finding({ origin: 'standards_finding', dedup_key: 'standards:lint.config', evidence: '{}' });
    expect(verdictFor(f, draft({}, 'standards_finding')).state).toBe('unchanged');
  });

  it('CLEARED for a presence-shaped origin once it stops emitting', () => {
    const f = finding({ origin: 'standards_finding', dedup_key: 'standards:lint.config', evidence: '{}' });
    expect(verdictFor(f, undefined).state).toBe('cleared');
  });
});

describe('verdictFor — KPI direction', () => {
  const kpi = (current: number, target: number) =>
    ({
      id: 'k',
      origin: 'kpi_offtrack',
      dedup_key: 'kpi:k1',
      status: 'accepted',
      evidence: JSON.stringify({ current, target }),
    }) as unknown as DevIdea;

  it('MOVED when the reading gets closer to target (upward KPI)', () => {
    // conversion 2% → 4%, target 5%: closer to target = better
    const v = verdictFor(kpi(2, 5), draft({ current: 4, target: 5 }, 'kpi_offtrack'));
    expect(v.state).toBe('moved');
  });

  it('MOVED when a downward KPI falls toward its target', () => {
    // p95 latency 900ms → 400ms, target 300ms
    const v = verdictFor(kpi(900, 300), draft({ current: 400, target: 300 }, 'kpi_offtrack'));
    expect(v.state).toBe('moved');
  });

  it('REGRESSED when it moves away from target', () => {
    const v = verdictFor(kpi(900, 300), draft({ current: 1400, target: 300 }, 'kpi_offtrack'));
    expect(v.state).toBe('regressed');
  });
});

describe('primaryMetric', () => {
  it('picks the number each sensor is actually about', () => {
    expect(primaryMetric('llm_cost', { costUsd: 5 })).toBe(5);
    expect(primaryMetric('llm_cost', { share: 0.4 })).toBe(0.4); // the unnamed-share finding
    expect(primaryMetric('sentry_spike', { count: 90 })).toBe(90);
    expect(primaryMetric('kpi_offtrack', { current: 3 })).toBe(3);
    expect(primaryMetric('standards_finding', { anything: 1 })).toBeNull(); // presence-shaped
  });
});

describe('isVerifiable — never judge work that never shipped', () => {
  const task = (over: Partial<DevTask>): DevTask =>
    ({ id: 't1', source_idea_id: 'i1', status: 'completed', ...over }) as unknown as DevTask;

  it('true for an accepted finding whose task completed', () => {
    expect(isVerifiable(finding({}), [task({})])).toBe(true);
  });

  it('false when the task is still running', () => {
    expect(isVerifiable(finding({}), [task({ status: 'running' })])).toBe(false);
  });

  it('false when no task was ever created', () => {
    expect(isVerifiable(finding({}), [])).toBe(false);
  });

  it('false for a pending (untriaged) finding', () => {
    expect(isVerifiable(finding({ status: 'pending' }), [task({})])).toBe(false);
  });

  it('false for a classic scanner idea (no origin)', () => {
    expect(isVerifiable(finding({ origin: null }), [task({})])).toBe(false);
  });
});
