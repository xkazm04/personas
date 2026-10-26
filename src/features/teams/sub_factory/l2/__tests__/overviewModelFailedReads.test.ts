// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { DevContext } from '@/lib/bindings/DevContext';
import type { FactoryL2Data } from '../factoryL2Data';
import { buildCell, coverageOf } from '../overviewModel';

const ctx = { id: 'c1', name: 'Ctx' } as DevContext;

function data(over: Partial<FactoryL2Data>): FactoryL2Data {
  return {
    kpis: [],
    monitoringWired: false,
    llmWired: false,
    runtime: { errorsByContext: new Map(), costByContext: new Map() },
    featureCountByContext: new Map(),
    goalCountByContext: new Map(),
    proposalsByContext: new Map(),
    goalsFailed: false,
    kpisFailed: false,
    ...over,
  } as unknown as FactoryL2Data;
}

describe('L2 overview model with a failed read', () => {
  it('a rejected goals read is null, not zero goals', () => {
    expect(coverageOf(data({ goalsFailed: true }), 'c1').goals).toBeNull();
    expect(coverageOf(data({}), 'c1').goals).toBe(0);
  });

  it('a rejected KPI read leaves proposals and the KPI count unknown, not zero', () => {
    const d = data({ kpisFailed: true });
    expect(coverageOf(d, 'c1').proposals).toBeNull();
    expect(buildCell(ctx, d, new Map()).kpiCount).toBeNull();
    expect(buildCell(ctx, data({}), new Map()).kpiCount).toBe(0);
  });
});
