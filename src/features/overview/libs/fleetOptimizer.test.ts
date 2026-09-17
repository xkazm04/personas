/**
 * Unit tests for `generateFleetRecommendation` — focused on the
 * `overall_success_rate` unit convention.
 *
 * `overall_success_rate` is a [0,1] ratio (total_completed/total_executions,
 * `kind: 'precomputed_ratio'` in metricIdentity.ts), while
 * `HEALTHY_FLEET_SUCCESS_PCT` is a percentage. These tests pin the
 * normalization so the "Fleet Running Smoothly" card can actually appear
 * for a healthy fleet and reports the success rate as a real percentage.
 */
import { describe, it, expect } from 'vitest';

import type { ExecutionDashboardData } from '@/lib/bindings/ExecutionDashboardData';
import type { DashboardTopPersona } from '@/lib/bindings/DashboardTopPersona';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';
import type { DashboardDailyPoint } from '@/lib/bindings/DashboardDailyPoint';
import type { DashboardCostAnomaly } from '@/lib/bindings/DashboardCostAnomaly';

import { generateFleetRecommendation } from './fleetOptimizer';

function topPersona(o: Partial<DashboardTopPersona> = {}): DashboardTopPersona {
  return {
    persona_id: 'p-1',
    persona_name: 'Weather Bot',
    total_cost: 0.5,
    total_executions: 20,
    avg_cost_per_exec: 0.025, // below HIGH_COST_PER_EXEC_USD so no cost recs
    ...o,
  };
}

function healingIssue(o: Partial<PersonaHealingIssue> = {}): PersonaHealingIssue {
  return {
    id: 'h-1',
    persona_id: 'p-1',
    execution_id: null,
    title: 'Timeout',
    description: 'Execution timed out',
    is_circuit_breaker: false,
    severity: 'warning',
    category: 'timeout',
    suggested_fix: null,
    auto_fixed: false,
    status: 'open',
    created_at: '2026-06-01T00:00:00Z',
    resolved_at: null,
    source: null,
    ...o,
  };
}

function dashboard(o: Partial<ExecutionDashboardData> = {}): ExecutionDashboardData {
  return {
    daily_points: [],
    top_personas: [topPersona()],
    cost_anomalies: [],
    total_executions: 20,
    successful_executions: 19,
    failed_executions: 1,
    total_cost: 0.5,
    overall_success_rate: 0.95, // [0,1] ratio — a healthy 95% fleet
    avg_latency_ms: 1200,
    active_personas: 1,
    projected_monthly_cost: null,
    burn_rate: null,
    ...o,
  };
}

describe('generateFleetRecommendation — overall_success_rate [0,1] convention', () => {
  it('returns the "Fleet Running Smoothly" rec for a healthy 0.95 fleet with nothing wrong', () => {
    const rec = generateFleetRecommendation(dashboard(), []);

    expect(rec).not.toBeNull();
    expect(rec!.type).toBe('healthy_fleet');
    expect(rec!.title).toBe('Fleet Running Smoothly');
    // 0.95 ratio must render as 95%, not Math.round(0.95) => 1%.
    expect(rec!.description).toContain('95% success rate');
  });

  it('suppresses the healthy rec when the overall success ratio is below the 80% threshold', () => {
    const healing: PersonaHealingIssue[] = [];
    const rec = generateFleetRecommendation(
      dashboard({ overall_success_rate: 0.5 }), // 50% — unhealthy
      healing,
    );

    expect(rec).toBeNull();
  });

  it('treats the 0.8 ratio (== 80%) as healthy at the boundary', () => {
    const rec = generateFleetRecommendation(
      dashboard({ overall_success_rate: 0.8 }),
      [],
    );

    expect(rec).not.toBeNull();
    expect(rec!.type).toBe('healthy_fleet');
    expect(rec!.description).toContain('80% success rate');
  });

  it('suppresses the healthy rec when overall_success_rate is not finite (NaN)', () => {
    const rec = generateFleetRecommendation(
      dashboard({ overall_success_rate: Number.NaN }),
      [],
    );

    expect(rec).toBeNull();
  });
});

describe('generateFleetRecommendation — failure estimate counts OPEN healing only', () => {
  // A costly persona (avg ≥ $0.10/run) with enough windowed executions to be
  // optimization-eligible. Whether it surfaces as "High Cost, Low Success"
  // hinges purely on the derived success rate (i.e. failed-execution estimate).
  const costlyPersona = topPersona({
    avg_cost_per_exec: 0.2, // ≥ HIGH_COST_PER_EXEC_USD
    total_executions: 20,
    total_cost: 4.0,
  });

  it('does NOT flag "High Cost, Low Success" when all healing issues are resolved/auto-fixed (none open)', () => {
    // 12 lifetime issues, ALL resolved/auto-fixed — zero open. Under the old
    // lifetime-total proxy this gave failedEstimate=12 → 40% → a false warning.
    const resolved: PersonaHealingIssue[] = Array.from({ length: 12 }, (_, i) =>
      healingIssue({
        id: `h-${i}`,
        status: 'resolved',
        auto_fixed: true,
        resolved_at: '2026-06-02T00:00:00Z',
      }),
    );

    const rec = generateFleetRecommendation(dashboard({ top_personas: [costlyPersona] }), resolved);

    // The persona runs fine today: 0 open issues → ~100% success → NOT wasteful.
    expect(rec).not.toBeNull();
    expect(rec!.title).not.toBe('High Cost, Low Success');
    // High cost + high (open-based) success surfaces the benign downgrade rec.
    expect(rec!.type).toBe('downgrade_model');
  });

  it('still flags "High Cost, Low Success" when the persona has real OPEN failures', () => {
    const open: PersonaHealingIssue[] = Array.from({ length: 12 }, (_, i) =>
      healingIssue({ id: `h-${i}`, status: 'open' }),
    );

    const rec = generateFleetRecommendation(dashboard({ top_personas: [costlyPersona] }), open);

    // 12 open / 20 execs → 40% success → below LOW_SUCCESS_RATE_PCT → warning.
    expect(rec).not.toBeNull();
    expect(rec!.type).toBe('investigate_failures');
    expect(rec!.title).toBe('High Cost, Low Success');
  });
});

/**
 * The most urgent rec the engine can produce — a live cost spike — used to
 * return `personaIds: []` unconditionally. `FleetOptimizationCard` gates Open
 * Lab on `rec.personaIds[0]`, so the critical card was the one with the fewest
 * actions, and the operator was handed a date to go hunting with. The data was
 * already in hand: `daily_points[].persona_costs` breaks that date down.
 */
describe('generateFleetRecommendation — cost-spike attribution', () => {
  // `a.date` is parsed by the production code as `new Date('YYYY-MM-DD')`,
  // i.e. UTC midnight, so the fixture's day key has to name UTC too. A bare
  // `toISOString().slice(0, 10)` is the same value by accident, not by
  // contract; going through a zone-naming formatter says which day is meant.
  const dayKey = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(d);
  const today = dayKey(new Date());

  const dailyPoint = (date: string, costs: Array<{ id: string; name: string; cost: number }>): DashboardDailyPoint => ({
    date,
    total_cost: costs.reduce((s, c) => s + c.cost, 0),
    total_executions: 10,
    completed: 10,
    failed: 0,
    success_rate: 1,
    p50_duration_ms: 100,
    p95_duration_ms: 200,
    p99_duration_ms: 300,
    total_tokens: 1000,
    persona_costs: costs.map((c) => ({ persona_id: c.id, persona_name: c.name, cost: c.cost })),
  });

  const anomaly = (date: string): DashboardCostAnomaly => ({
    date,
    cost: 45,
    moving_avg: 10,
    std_dev: 5,
    deviation_sigma: 3.2,
    execution_ids: [],
  });

  it('(a) names the top spender on the anomaly date', () => {
    const rec = generateFleetRecommendation(
      dashboard({
        cost_anomalies: [anomaly(today)],
        daily_points: [dailyPoint(today, [
          { id: 'p-a', name: 'Researcher', cost: 40 },
          { id: 'p-b', name: 'Summarizer', cost: 5 },
        ])],
      }),
      [],
    );
    expect(rec!.type).toBe('cost_anomaly');
    expect(rec!.personaIds[0]).toBe('p-a');
    expect(rec!.personaNames[0]).toBe('Researcher');
    expect(rec!.description).toContain('Researcher');
    // Ordered by spend, not by the order the backend happened to return.
    expect(rec!.personaIds).toEqual(['p-a', 'p-b']);
  });

  it('(b) still emits the rec, unattributed, when the date has no persona costs', () => {
    const rec = generateFleetRecommendation(
      dashboard({ cost_anomalies: [anomaly(today)], daily_points: [dailyPoint(today, [])] }),
      [],
    );
    expect(rec!.type).toBe('cost_anomaly');
    expect(rec!.personaIds).toEqual([]);
    expect(rec!.personaNames).toEqual([]);
    // An unattributed spike is an honest outcome; an invented owner is not.
    expect(rec!.impact).toBe('$35.00 above expected spending');
  });

  it('(c) an anomaly older than the recency bound is still suppressed', () => {
    const oldDate = dayKey(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
    const rec = generateFleetRecommendation(
      dashboard({
        cost_anomalies: [anomaly(oldDate)],
        daily_points: [dailyPoint(oldDate, [{ id: 'p-a', name: 'Researcher', cost: 40 }])],
      }),
      [],
    );
    expect(rec!.type).not.toBe('cost_anomaly');
  });

  it('(d) impact carries the dollar share, not just the overage', () => {
    const rec = generateFleetRecommendation(
      dashboard({
        cost_anomalies: [anomaly(today)],
        daily_points: [dailyPoint(today, [
          { id: 'p-a', name: 'Researcher', cost: 40 },
          { id: 'p-b', name: 'Summarizer', cost: 5 },
        ])],
      }),
      [],
    );
    expect(rec!.impact).toBe('$35.00 above expected spending; $40.00 of it from Researcher');
    expect(rec!.description).toContain('89%');
    expect(rec!.suggestedAction).toContain('Researcher');
  });

  it('names at most three personas', () => {
    const costs = Array.from({ length: 6 }, (_, i) => ({ id: `p-${i}`, name: `P${i}`, cost: 10 - i }));
    const rec = generateFleetRecommendation(
      dashboard({ cost_anomalies: [anomaly(today)], daily_points: [dailyPoint(today, costs)] }),
      [],
    );
    expect(rec!.personaIds).toEqual(['p-0', 'p-1', 'p-2']);
  });
});
