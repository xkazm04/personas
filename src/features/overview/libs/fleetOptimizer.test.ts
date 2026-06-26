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
