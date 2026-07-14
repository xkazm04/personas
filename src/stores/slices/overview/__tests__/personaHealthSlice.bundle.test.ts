import { beforeEach, describe, expect, it, vi } from 'vitest';

// -- API mocks --------------------------------------------------------------
const getHealthBundle = vi.fn();
const getOverviewBundle = vi.fn();
const listHealingIssues = vi.fn();
const getByomPolicy = vi.fn();
const getProviderUsageStats = vi.fn();

vi.mock('@/api/overview/health', () => ({
  getHealthBundle: (...a: unknown[]) => getHealthBundle(...a),
}));
vi.mock('@/api/overview/observability', () => ({
  getOverviewBundle: (...a: unknown[]) => getOverviewBundle(...a),
}));
vi.mock('@/api/overview/healing', () => ({
  listHealingIssues: (...a: unknown[]) => listHealingIssues(...a),
}));
vi.mock('@/api/system/byom', () => ({
  getByomPolicy: (...a: unknown[]) => getByomPolicy(...a),
  getProviderUsageStats: (...a: unknown[]) => getProviderUsageStats(...a),
}));

import { create } from 'zustand';
import { storeBus, AccessorKey } from '@/lib/storeBus';
import { createPersonaHealthSlice } from '../personaHealthSlice';
import type { Persona } from '@/lib/bindings/Persona';
import type { HealthBundle } from '@/lib/bindings/HealthBundle';

function persona(id: string, name: string): Persona {
  // Only the fields the slice reads; the rest is filled loosely.
  return { id, name, icon: null, color: null, home_team_id: null } as unknown as Persona;
}

function okBundle(over: Partial<HealthBundle> = {}): HealthBundle {
  return {
    monthlySpend: { periodStartUtc: '2026-07-01T00:00:00', items: [] },
    healingIssues: [],
    byomPolicy: null,
    providerStats: [],
    errors: { monthlySpend: null, healingIssues: null, byomPolicy: null, providerStats: null },
    ...over,
  } as HealthBundle;
}

function makeStore() {
  return create((...a: Parameters<typeof createPersonaHealthSlice>) => ({
    executionDashboard: {
      daily_points: [],
      top_personas: [{ persona_id: 'p1', total_executions: 10 }],
      overall_success_rate: 92,
      avg_latency_ms: 120,
      cost_anomalies: [],
    },
    fetchExecutionDashboard: vi.fn(async () => {}),
    ...createPersonaHealthSlice(...a),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  })) as any;
}

describe('personaHealthSlice — health bundle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeBus._reset();
    storeBus.provide(AccessorKey.AGENTS_PERSONAS, () => [persona('p1', 'Alpha')]);
  });

  it('consumes the bundle, marks all sources ok, and stores healing issues', async () => {
    const healing = [{ persona_id: 'p1', status: 'open', is_circuit_breaker: false, severity: 'low', created_at: new Date().toISOString() }];
    getHealthBundle.mockResolvedValue(okBundle({ healingIssues: healing as never }));

    const store = makeStore();
    await store.getState().computePersonaHealth();

    const s = store.getState();
    expect(getHealthBundle).toHaveBeenCalledTimes(1);
    expect(s.dataSourceStatus).toEqual({
      monthlySpend: { state: 'ok', reason: null },
      healingIssues: { state: 'ok', reason: null },
      byomPolicy: { state: 'ok', reason: null },
      providerStats: { state: 'ok', reason: null },
    });
    expect(s.healthHealingIssues).toEqual(healing);
    expect(s.healthSignals).toHaveLength(1);
    // No retry endpoints touched on the happy path.
    expect(listHealingIssues).not.toHaveBeenCalled();
    expect(getProviderUsageStats).not.toHaveBeenCalled();
  });

  it('retries ONLY the failed source and clears its status on success', async () => {
    getHealthBundle.mockResolvedValue(okBundle({
      providerStats: null,
      errors: { monthlySpend: null, healingIssues: null, byomPolicy: null, providerStats: 'not privileged' },
    }));
    getProviderUsageStats.mockResolvedValue([{ engine_kind: 'claude', execution_count: 3, total_cost_usd: 1, avg_duration_ms: 100, failover_count: 0 }]);

    const store = makeStore();
    await store.getState().computePersonaHealth();

    const s = store.getState();
    expect(getProviderUsageStats).toHaveBeenCalledTimes(1);
    // Only the failed source was retried.
    expect(listHealingIssues).not.toHaveBeenCalled();
    expect(getOverviewBundle).not.toHaveBeenCalled();
    expect(s.dataSourceStatus!.providerStats).toEqual({ state: 'ok', reason: null });
    expect(s.providerStats).toHaveLength(1);
  });

  it('surfaces the failure reason when the single retry also fails', async () => {
    getHealthBundle.mockResolvedValue(okBundle({
      healingIssues: null,
      errors: { monthlySpend: null, healingIssues: 'db locked', byomPolicy: null, providerStats: null },
    }));
    listHealingIssues.mockRejectedValue(new Error('still locked'));

    const store = makeStore();
    await store.getState().computePersonaHealth();

    const s = store.getState();
    expect(listHealingIssues).toHaveBeenCalledTimes(1);
    expect(s.dataSourceStatus!.healingIssues).toEqual({ state: 'failed', reason: 'still locked' });
  });
});
