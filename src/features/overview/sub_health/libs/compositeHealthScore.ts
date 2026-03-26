import type { PersonaSlaStats } from '@/lib/bindings/PersonaSlaStats';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';
import type { HealthGrade } from '@/stores/slices/overview/personaHealthSlice';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single day's status for the uptime bar. */
export type DayStatus = 'operational' | 'degraded' | 'outage' | 'no-data';

/** Composite score output per persona. */
export interface CompositeHealthEntry {
  personaId: string;
  personaName: string;
  personaIcon: string | null;
  personaColor: string | null;

  /** 0-100 composite score */
  score: number;
  grade: HealthGrade;

  /** Component scores (each 0-100) */
  successRateScore: number;
  latencyScore: number;
  costAnomalyScore: number;
  healingScore: number;
  slaComplianceScore: number;

  /** Raw metrics for tooltip display */
  successRate: number;      // 0-1
  p95LatencyMs: number;
  costAnomalyCount: number;
  openHealingIssues: number;
  slaCompliance: number;    // 0-1
  consecutiveFailures: number;

  /** 30-day uptime bar data */
  dailyStatuses: DayStatus[];

  /** Trend direction over last 7 days vs prior 7 */
  trend: 'improving' | 'stable' | 'degrading';

  /** Overall uptime percentage over the 30-day window */
  uptimePercent: number;
}

// ---------------------------------------------------------------------------
// Weights (must sum to 1.0)
// ---------------------------------------------------------------------------

const W_SUCCESS_RATE = 0.30;
const W_LATENCY = 0.15;
const W_COST_ANOMALY = 0.15;
const W_HEALING = 0.15;
const W_SLA_COMPLIANCE = 0.25;

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** p95 latency below this (ms) scores 100 */
const LATENCY_EXCELLENT_MS = 2_000;
/** p95 latency above this (ms) scores 0 */
const LATENCY_TERRIBLE_MS = 30_000;

// ---------------------------------------------------------------------------
// Score helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Success rate (0-1) → 0-100 score. Penalise sharply below 95%. */
function scoreSuccessRate(rate: number): number {
  if (rate >= 0.99) return 100;
  if (rate >= 0.95) return 70 + (rate - 0.95) / 0.04 * 30;
  if (rate >= 0.80) return 30 + (rate - 0.80) / 0.15 * 40;
  return rate / 0.80 * 30;
}

/** p95 latency (ms) → 0-100 score. Linear between excellent and terrible. */
function scoreLatency(p95Ms: number): number {
  if (p95Ms <= LATENCY_EXCELLENT_MS) return 100;
  if (p95Ms >= LATENCY_TERRIBLE_MS) return 0;
  return 100 - ((p95Ms - LATENCY_EXCELLENT_MS) / (LATENCY_TERRIBLE_MS - LATENCY_EXCELLENT_MS)) * 100;
}

/** Cost anomaly count → 0-100. 0 anomalies = 100, 3+ = 0. */
function scoreCostAnomalies(count: number): number {
  return clamp(100 - count * 33, 0, 100);
}

/** Open healing issues count → 0-100. 0 = 100, 5+ = 0. */
function scoreHealing(openIssues: number): number {
  return clamp(100 - openIssues * 20, 0, 100);
}

/** SLA compliance (0-1) → 0-100. */
function scoreSlaCompliance(rate: number): number {
  return scoreSuccessRate(rate); // Same curve — SLA compliance has same semantics
}

function computeGrade(score: number): HealthGrade {
  if (score >= 80) return 'healthy';
  if (score >= 50) return 'degraded';
  if (score > 0) return 'critical';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Day status from success rate
// ---------------------------------------------------------------------------

function dayStatusFromRate(rate: number): DayStatus {
  if (rate >= 0.95) return 'operational';
  if (rate >= 0.70) return 'degraded';
  return 'outage';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CompositeScoreInput {
  personas: Array<{
    id: string;
    name: string;
    icon: string | null;
    color: string | null;
  }>;
  slaStats: PersonaSlaStats[];
  healingIssues: PersonaHealingIssue[];
  /** Total cost anomalies detected in the 30-day window (global, not per-persona). */
  costAnomalyCount: number;
  /** 30 entries, most recent last. Each has date + per-persona success info. */
  dailyPoints: Array<{
    date: string;
    success_rate: number;
    persona_costs: Array<{ persona_id: string; cost: number }>;
    total_executions: number;
    completed: number;
    failed: number;
  }>;
}

export function computeCompositeHealth(input: CompositeScoreInput): CompositeHealthEntry[] {
  const { personas, slaStats, healingIssues, costAnomalyCount, dailyPoints } = input;

  // Index helpers
  const slaMap = new Map(slaStats.map(s => [s.persona_id, s]));

  const healingByPersona = new Map<string, PersonaHealingIssue[]>();
  for (const issue of healingIssues) {
    const list = healingByPersona.get(issue.persona_id) ?? [];
    list.push(issue);
    healingByPersona.set(issue.persona_id, list);
  }

  // Last 30 daily points
  const last30 = dailyPoints.slice(-30);

  const entries: CompositeHealthEntry[] = [];

  for (const persona of personas) {
    const sla = slaMap.get(persona.id);
    const issues = (healingByPersona.get(persona.id) ?? []).filter(i => i.status !== 'resolved');
    // Cost anomalies are global — attribute evenly to all personas
    const anomalyCount = costAnomalyCount;

    // Raw metrics
    const successRate = sla ? sla.success_rate : 1;
    const p95LatencyMs = sla?.p95_duration_ms ?? 0;
    const slaCompliance = sla ? sla.success_rate : 1; // SLA compliance ~ success rate
    const consecutiveFailures = sla?.consecutive_failures ?? 0;

    // Component scores
    const successRateScore = Math.round(scoreSuccessRate(successRate));
    const latencyScore = Math.round(scoreLatency(p95LatencyMs));
    const costAnomalyScore = Math.round(scoreCostAnomalies(anomalyCount));
    const healingScore = Math.round(scoreHealing(issues.length));
    const slaComplianceScore = Math.round(scoreSlaCompliance(slaCompliance));

    // Weighted composite
    const score = Math.round(
      successRateScore * W_SUCCESS_RATE +
      latencyScore * W_LATENCY +
      costAnomalyScore * W_COST_ANOMALY +
      healingScore * W_HEALING +
      slaComplianceScore * W_SLA_COMPLIANCE,
    );

    // 30-day daily statuses
    const dailyStatuses: DayStatus[] = last30.map(pt => {
      const hasActivity = pt.persona_costs.some(c => c.persona_id === persona.id);
      if (!hasActivity) return 'no-data';
      return dayStatusFromRate(pt.success_rate);
    });

    // Pad to 30 days if fewer
    while (dailyStatuses.length < 30) {
      dailyStatuses.unshift('no-data');
    }

    // Uptime percent (days operational or degraded / total days with data)
    const daysWithData = dailyStatuses.filter(s => s !== 'no-data').length;
    const daysUp = dailyStatuses.filter(s => s === 'operational' || s === 'degraded').length;
    const uptimePercent = daysWithData > 0 ? daysUp / daysWithData : 1;

    // Trend: compare last 7 days success to prior 7 days
    const recentDays = last30.slice(-7);
    const priorDays = last30.slice(-14, -7);
    const avgRecent = recentDays.length > 0
      ? recentDays.reduce((s, d) => s + d.success_rate, 0) / recentDays.length
      : 0;
    const avgPrior = priorDays.length > 0
      ? priorDays.reduce((s, d) => s + d.success_rate, 0) / priorDays.length
      : avgRecent;
    const delta = avgRecent - avgPrior;
    const trend: 'improving' | 'stable' | 'degrading' =
      delta > 0.02 ? 'improving' : delta < -0.02 ? 'degrading' : 'stable';

    entries.push({
      personaId: persona.id,
      personaName: persona.name,
      personaIcon: persona.icon,
      personaColor: persona.color,
      score,
      grade: computeGrade(score),
      successRateScore,
      latencyScore,
      costAnomalyScore,
      healingScore,
      slaComplianceScore,
      successRate,
      p95LatencyMs,
      costAnomalyCount: anomalyCount,
      openHealingIssues: issues.length,
      slaCompliance,
      consecutiveFailures,
      dailyStatuses,
      trend,
      uptimePercent,
    });
  }

  // Sort by score ascending (worst first, like a status page)
  entries.sort((a, b) => a.score - b.score);

  return entries;
}
