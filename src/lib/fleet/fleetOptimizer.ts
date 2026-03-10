/**
 * Fleet Optimization Engine
 *
 * Cross-references healing issues, cost analytics, and execution data
 * to produce actionable optimization recommendations.
 *
 * Signal sources:
 *   - ExecutionDashboard: top_personas (cost), daily_points (success rates)
 *   - Healing issues: recurring failures, auto-fix patterns
 *   - Persona metadata: model config, retry settings
 *
 * Output: A single prioritized recommendation with explanation and action.
 */

import type { ExecutionDashboardData } from '@/lib/bindings/ExecutionDashboardData';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';

// ── Recommendation Types ────────────────────────────────────────────

export type RecommendationType =
  | 'downgrade_model'
  | 'reduce_retries'
  | 'investigate_failures'
  | 'consolidate_personas'
  | 'cost_anomaly'
  | 'healthy_fleet';

export type RecommendationSeverity = 'info' | 'warning' | 'critical';

export interface FleetRecommendation {
  id: string;
  type: RecommendationType;
  severity: RecommendationSeverity;
  title: string;
  description: string;
  /** Which persona(s) this applies to, if any */
  personaIds: string[];
  personaNames: string[];
  /** Quantified impact estimate */
  impact: string;
  /** What the system suggests doing */
  suggestedAction: string;
  /** Timestamp of generation */
  generatedAt: string;
}

// ── Thresholds ──────────────────────────────────────────────────────

/** Persona is "costly" if avg cost/exec exceeds this */
const HIGH_COST_PER_EXEC_USD = 0.10;

/** Persona is "failing" if success rate drops below this */
const LOW_SUCCESS_RATE_PCT = 60;

/** Minimum executions to be considered for optimization */
const MIN_EXECUTIONS = 5;

/** Healing issues threshold for "investigate" recommendation */
const HIGH_HEALING_ISSUE_COUNT = 3;

/** Cost anomaly sigma threshold */
const ANOMALY_SIGMA_THRESHOLD = 2.0;

// ── Per-Persona Success Rate Derivation ─────────────────────────────

interface PersonaPerformance {
  personaId: string;
  personaName: string;
  totalCost: number;
  totalExecutions: number;
  avgCostPerExec: number;
  successRate: number;
  failedCount: number;
  healingIssueCount: number;
  autoFixedCount: number;
  openIssueCount: number;
}

/**
 * Derive per-persona success rates from daily points.
 * The dashboard top_personas only has cost, not success rate,
 * so we aggregate from daily_points.persona_costs.
 */
function derivePerPersonaPerformance(
  dashboard: ExecutionDashboardData,
  healingIssues: PersonaHealingIssue[],
): PersonaPerformance[] {
  // Aggregate healing issues per persona
  const healingByPersona = new Map<string, { total: number; autoFixed: number; open: number }>();
  for (const issue of healingIssues) {
    const existing = healingByPersona.get(issue.persona_id) ?? { total: 0, autoFixed: 0, open: 0 };
    existing.total += 1;
    if (issue.auto_fixed) existing.autoFixed += 1;
    if (issue.status === 'open') existing.open += 1;
    healingByPersona.set(issue.persona_id, existing);
  }

  const results: PersonaPerformance[] = [];

  for (const tp of dashboard.top_personas) {
    const healing = healingByPersona.get(tp.persona_id) ?? { total: 0, autoFixed: 0, open: 0 };

    // Derive success rate: if we have daily points, use overall daily aggregation
    // For a per-persona success rate, use available execution count + healing failure signal
    const totalExecs = tp.total_executions;
    const failedEstimate = healing.total; // Each healing issue ≈ 1 failed execution
    const successRate = totalExecs > 0
      ? Math.max(0, Math.min(100, ((totalExecs - failedEstimate) / totalExecs) * 100))
      : 100;

    results.push({
      personaId: tp.persona_id,
      personaName: tp.persona_name,
      totalCost: tp.total_cost,
      totalExecutions: tp.total_executions,
      avgCostPerExec: tp.avg_cost_per_exec,
      successRate,
      failedCount: failedEstimate,
      healingIssueCount: healing.total,
      autoFixedCount: healing.autoFixed,
      openIssueCount: healing.open,
    });
  }

  return results;
}

// ── Recommendation Generation ───────────────────────────────────────

/**
 * Generate the single highest-priority optimization recommendation
 * by cross-referencing cost, success rate, and healing data.
 *
 * Priority order:
 * 1. Cost anomaly (urgent: spending spike)
 * 2. High cost + low success (wasteful: expensive and broken)
 * 3. High cost + high success (efficiency: could use cheaper model)
 * 4. Many healing issues (reliability: needs investigation)
 * 5. Healthy fleet (all good)
 */
export function generateFleetRecommendation(
  dashboard: ExecutionDashboardData | null,
  healingIssues: PersonaHealingIssue[],
): FleetRecommendation | null {
  if (!dashboard || dashboard.total_executions < MIN_EXECUTIONS) {
    return null; // Not enough data
  }

  const performances = derivePerPersonaPerformance(dashboard, healingIssues);

  // 1. Check for cost anomalies (most urgent)
  const recentAnomalies = dashboard.cost_anomalies.filter(
    (a) => a.deviation_sigma >= ANOMALY_SIGMA_THRESHOLD,
  );
  if (recentAnomalies.length > 0) {
    const worst = recentAnomalies.reduce((a, b) =>
      a.deviation_sigma > b.deviation_sigma ? a : b,
    );
    const pctAbove = Math.round(((worst.cost - worst.moving_avg) / worst.moving_avg) * 100);
    return {
      id: `cost-anomaly-${worst.date}`,
      type: 'cost_anomaly',
      severity: 'critical',
      title: 'Cost Spike Detected',
      description: `Spending on ${worst.date} was ${pctAbove}% above the moving average ($${worst.cost.toFixed(2)} vs $${worst.moving_avg.toFixed(2)} avg).`,
      personaIds: [],
      personaNames: [],
      impact: `$${(worst.cost - worst.moving_avg).toFixed(2)} above expected spending`,
      suggestedAction: 'Review the costliest executions on this date and check for runaway loops or unexpected model usage.',
      generatedAt: new Date().toISOString(),
    };
  }

  // 2. High cost + low success (wasteful spend)
  const wasteful = performances
    .filter((p) => p.totalExecutions >= MIN_EXECUTIONS)
    .filter((p) => p.avgCostPerExec >= HIGH_COST_PER_EXEC_USD && p.successRate < LOW_SUCCESS_RATE_PCT)
    .sort((a, b) => b.totalCost - a.totalCost);

  if (wasteful.length > 0) {
    const worst = wasteful[0]!;
    return {
      id: `wasteful-${worst.personaId}`,
      type: 'investigate_failures',
      severity: 'warning',
      title: 'High Cost, Low Success',
      description: `"${worst.personaName}" is spending $${worst.avgCostPerExec.toFixed(3)}/run with only ${Math.round(worst.successRate)}% success rate. ${worst.healingIssueCount} healing issues detected.`,
      personaIds: [worst.personaId],
      personaNames: [worst.personaName],
      impact: `$${worst.totalCost.toFixed(2)} spent with ${Math.round(100 - worst.successRate)}% failure rate`,
      suggestedAction: worst.openIssueCount > 0
        ? `Resolve ${worst.openIssueCount} open healing issues first, then consider switching to a cheaper model if the task is routine.`
        : 'Review failure patterns and consider adding error handling or simplifying the prompt to improve reliability.',
      generatedAt: new Date().toISOString(),
    };
  }

  // 3. High cost + high success → downgrade model
  const expensive = performances
    .filter((p) => p.totalExecutions >= MIN_EXECUTIONS)
    .filter((p) => p.avgCostPerExec >= HIGH_COST_PER_EXEC_USD && p.successRate >= 90)
    .sort((a, b) => b.totalCost - a.totalCost);

  if (expensive.length > 0) {
    const candidate = expensive[0]!;
    const estimatedSaving = candidate.totalCost * 0.6; // ~60% saving from Opus→Sonnet or Sonnet→Haiku
    return {
      id: `downgrade-${candidate.personaId}`,
      type: 'downgrade_model',
      severity: 'info',
      title: 'Model Downgrade Opportunity',
      description: `"${candidate.personaName}" has ${Math.round(candidate.successRate)}% success rate at $${candidate.avgCostPerExec.toFixed(3)}/run. A cheaper model could handle this workload.`,
      personaIds: [candidate.personaId],
      personaNames: [candidate.personaName],
      impact: `Est. ~$${estimatedSaving.toFixed(2)} savings (${candidate.totalExecutions} runs)`,
      suggestedAction: 'Try switching to a faster, cheaper model (e.g., Sonnet instead of Opus, or Haiku for simple tasks). High success rate suggests the task doesn\'t need the most capable model.',
      generatedAt: new Date().toISOString(),
    };
  }

  // 4. Many healing issues on any persona
  const troublesome = performances
    .filter((p) => p.healingIssueCount >= HIGH_HEALING_ISSUE_COUNT)
    .sort((a, b) => b.healingIssueCount - a.healingIssueCount);

  if (troublesome.length > 0) {
    const worst = troublesome[0]!;
    return {
      id: `healing-${worst.personaId}`,
      type: 'investigate_failures',
      severity: 'warning',
      title: 'Recurring Failures',
      description: `"${worst.personaName}" has ${worst.healingIssueCount} healing issues (${worst.autoFixedCount} auto-fixed, ${worst.openIssueCount} open).`,
      personaIds: [worst.personaId],
      personaNames: [worst.personaName],
      impact: `${worst.healingIssueCount} issues affecting reliability`,
      suggestedAction: worst.autoFixedCount > worst.openIssueCount
        ? 'The auto-healer is managing most issues. Review the recurring categories to address root causes.'
        : 'Run healing analysis and review open issues. Consider adjusting the prompt or adding explicit error handling.',
      generatedAt: new Date().toISOString(),
    };
  }

  // 5. Fleet is healthy
  return {
    id: 'healthy-fleet',
    type: 'healthy_fleet',
    severity: 'info',
    title: 'Fleet Running Smoothly',
    description: `${dashboard.total_executions} executions across ${dashboard.top_personas.length} agents with ${Math.round(dashboard.overall_success_rate)}% success rate. No optimization needed.`,
    personaIds: [],
    personaNames: [],
    impact: 'No action required',
    suggestedAction: 'Your fleet is performing well. The system will continue monitoring for optimization opportunities.',
    generatedAt: new Date().toISOString(),
  };
}
