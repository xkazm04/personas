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
    personaStats: null,
    personaDaily: null,
    errors: {
      monthlySpend: null, healingIssues: null, byomPolicy: null,
      providerStats: null, personaStats: null, personaDaily: null,
    },
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

  it('uses the per-persona measured rate when persona_stats is present', async () => {
    getHealthBundle.mockResolvedValue(okBundle({
      personaStats: [{ persona_id: 'p1', total_decided: 5, success_rate: 0.8, avg_duration_ms: 4200 }] as never,
    }));

    const store = makeStore();
    await store.getState().computePersonaHealth();

    const s = store.getState();
    const sig = s.healthSignals[0];
    expect(sig.successRateSource).toBe('measured');
    expect(sig.successRate).toBeCloseTo(80);
    expect(sig.avgLatencyMs).toBe(4200);
  });

  it('falls back to the labeled fleet proxy when no per-persona stats exist', async () => {
    // top_personas gives p1 activity (10 execs) but persona_stats is absent,
    // so the fleet overall_success_rate (92) is used and tagged 'proxy'.
    getHealthBundle.mockResolvedValue(okBundle());

    const store = makeStore();
    await store.getState().computePersonaHealth();

    const sig = store.getState().healthSignals[0];
    expect(sig.successRateSource).toBe('proxy');
    expect(sig.successRate).toBe(92);
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
