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
// Weights (must sum to 1.0 — asserted at module load in dev)
// ---------------------------------------------------------------------------

export const WEIGHTS = {
  successRate: 0.30,
  latency: 0.15,
  costAnomaly: 0.15,
  healing: 0.15,
  slaCompliance: 0.25,
} as const;

const WEIGHT_SUM_EPSILON = 1e-9;

export function sumWeights(w: typeof WEIGHTS = WEIGHTS): number {
  return w.successRate + w.latency + w.costAnomaly + w.healing + w.slaCompliance;
}

/**
 * Weights for the Heartbeats-tab composite (`computeHeartbeatScore`). A
 * DOCUMENTED VARIANT of the status-page composite above: it scores the four
 * signals the Heartbeats input layer actually has per persona (success,
 * healing, circuit-breaker rollbacks, budget) rather than the latency/SLA/cost
 * signals the SLA-grounded status page pulls from `get_sla_dashboard`. The two
 * formulas differ ONLY because their input sources differ — both share the one
 * `computeGrade` threshold below and the one monotonic `scoreBudget` curve, so
 * a persona never lands in contradictory grade bands across the two tabs for an
 * unstated reason.
 */
export const HEARTBEAT_WEIGHTS = {
  success: 0.40,
  healing: 0.20,
  rollback: 0.20,
  budget: 0.20,
} as const;

export function sumHeartbeatWeights(w: typeof HEARTBEAT_WEIGHTS = HEARTBEAT_WEIGHTS): number {
  return w.success + w.healing + w.rollback + w.budget;
}

// Dev-only assertion: fail fast if either weight set drifts off 1.0. Stripped
// in production builds because import.meta.env.DEV is statically false and the
// block is dead code.
if (import.meta.env?.DEV) {
  const total = sumWeights();
  if (Math.abs(total - 1.0) > WEIGHT_SUM_EPSILON) {
    throw new Error(
      `compositeHealthScore WEIGHTS must sum to 1.0 but sum to ${total}. ` +
      `Adjust weights or update the invariant.`,
    );
  }
  const heartbeatTotal = sumHeartbeatWeights();
  if (Math.abs(heartbeatTotal - 1.0) > WEIGHT_SUM_EPSILON) {
    throw new Error(
      `HEARTBEAT_WEIGHTS must sum to 1.0 but sum to ${heartbeatTotal}. ` +
      `Adjust weights or update the invariant.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Grade thresholds — THE single source of truth for score → grade banding.
// Consumed by this module's `computeGrade`, the Heartbeats slice, the
// heartbeats `model.ts`, the Status page header, AND (for its degraded/
// unhealthy cutoffs) the agents health digest. Previously `computeGrade` was
// duplicated verbatim in three places and re-inlined a fourth; this collapses
// them so a threshold change lands everywhere at once.
// ---------------------------------------------------------------------------

export const GRADE_THRESHOLDS = {
  /** score ≥ this → 'healthy' */
  healthy: 80,
  /** score ≥ this (and < healthy) → 'degraded'; > 0 and < this → 'critical' */
  degraded: 50,
} as const;

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** p95 latency below this (ms) scores 100 */
const LATENCY_EXCELLENT_MS = 2_000;
/** p95 latency above this (ms) scores 0 */
const LATENCY_TERRIBLE_MS = 30_000;

/**
 * Band around zero delta (in 0-1 success-rate units) treated as "stable" trend.
 * 2% matches the observed daily success-rate noise floor for healthy personas —
 * deltas inside this band are indistinguishable from sampling noise and should
 * not trigger an improving/degrading label.
 */
export const TREND_NEUTRAL_BAND = 0.02;

// ---------------------------------------------------------------------------
// Score helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Success rate (0-1) → 0-100 score. Penalise sharply below 95%.
 * Horizon: the SLA window (`get_sla_dashboard`, 30 days) on the status page;
 * the health-bundle window (default 7 days) on the Heartbeats tab.
 */
function scoreSuccessRate(rate: number): number {
  if (rate >= 0.99) return 100;
  if (rate >= 0.95) return 70 + (rate - 0.95) / 0.04 * 30;
  if (rate >= 0.80) return 30 + (rate - 0.80) / 0.15 * 40;
  return rate / 0.80 * 30;
}

/**
 * p95 latency (ms) → 0-100 score. Linear between excellent and terrible.
 * Horizon: p95 over the SLA window (30 days).
 */
function scoreLatency(p95Ms: number): number {
  if (p95Ms <= LATENCY_EXCELLENT_MS) return 100;
  if (p95Ms >= LATENCY_TERRIBLE_MS) return 0;
  return 100 - ((p95Ms - LATENCY_EXCELLENT_MS) / (LATENCY_TERRIBLE_MS - LATENCY_EXCELLENT_MS)) * 100;
}

/**
 * Cost anomaly count → 0-100. 0 anomalies = 100, 3+ = 0.
 * Horizon: anomalies detected over the 30-day execution-dashboard window
 * (global, attributed evenly across personas).
 */
function scoreCostAnomalies(count: number): number {
  return clamp(100 - count * 33, 0, 100);
}

/**
 * Open healing issues count → 0-100. 0 = 100, 5+ = 0.
 * Horizon: currently-open issues (point-in-time; the bundle's healing scan is
 * bounded to recent-7d OR open OR circuit-breaker).
 */
function scoreHealing(openIssues: number): number {
  return clamp(100 - openIssues * 20, 0, 100);
}

/** SLA compliance (0-1) → 0-100. */
function scoreSlaCompliance(rate: number): number {
  return scoreSuccessRate(rate); // Same curve — SLA compliance has same semantics
}

/**
 * Budget spend ratio (spend / max_budget, 0..N) → 0-100. STRICTLY MONOTONIC
 * non-increasing: score never rises as budget worsens. 0% spent → 100,
 * 100%+ spent → 0.
 *
 * The previous curve (`ratio > 0.8 ? 30 : (1-ratio)*100`) was NON-monotonic:
 * ratio 0.79 scored 21 but 0.81 scored 30 — the score jumped UP as the budget
 * got worse, so a persona could improve its health by overspending. Removed.
 * Horizon: point-in-time spend against the current budget period.
 */
export function scoreBudget(budgetRatio: number): number {
  if (budgetRatio <= 0) return 100;
  if (budgetRatio >= 1) return 0;
  return (1 - budgetRatio) * 100;
}

/**
 * THE grade-threshold function. Exists exactly once (was duplicated verbatim in
 * the slice, this module, and heartbeats/model.ts, plus re-inlined in the
 * status-page header). All four now import this.
 */
export function computeGrade(score: number): HealthGrade {
  if (score >= GRADE_THRESHOLDS.healthy) return 'healthy';
  if (score >= GRADE_THRESHOLDS.degraded) return 'degraded';
  if (score > 0) return 'critical';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Heartbeats-tab composite (a documented variant of the status-page composite).
// These sub-score helpers are the SINGLE source consumed by both
// `computeHeartbeatScore` (the slice's score) and `model.ts`'s `subScores`
// (the segmented diagnostic bar), so the bar can never disagree with the score
// it decomposes.
// ---------------------------------------------------------------------------

/** Heartbeat success sub-score: success rate is already 0-100. Horizon: bundle window (7d default). */
export function scoreHeartbeatSuccess(successRate: number): number {
  return clamp(successRate, 0, 100);
}

/** Healing-frequency sub-score: issues/day, 4+/day = 0. Horizon: trailing 7 days. */
export function scoreHealingFrequency(healingFreq: number): number {
  return Math.max(0, 100 - healingFreq * 25);
}

/** Rollback sub-score: circuit-breaker count, 3+ = 0. Horizon: bundle healing scan window (open OR recent-7d OR circuit-breaker). */
export function scoreRollback(rollbackCount: number): number {
  return Math.max(0, 100 - rollbackCount * 33);
}

/**
 * Heartbeats-tab composite score (0-100). Documented variant of
 * `computeCompositeHealth` — see {@link HEARTBEAT_WEIGHTS}. Moved here from the
 * slice so there is ONE scoring module; the slice imports it.
 */
export function computeHeartbeatScore(
  successRate: number,
  healingFreq: number,
  rollbackCount: number,
  budgetRatio: number,
): number {
  return Math.round(
    scoreHeartbeatSuccess(successRate) * HEARTBEAT_WEIGHTS.success +
    scoreHealingFrequency(healingFreq) * HEARTBEAT_WEIGHTS.healing +
    scoreRollback(rollbackCount) * HEARTBEAT_WEIGHTS.rollback +
    scoreBudget(budgetRatio) * HEARTBEAT_WEIGHTS.budget,
  );
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
      successRateScore * WEIGHTS.successRate +
      latencyScore * WEIGHTS.latency +
      costAnomalyScore * WEIGHTS.costAnomaly +
      healingScore * WEIGHTS.healing +
      slaComplianceScore * WEIGHTS.slaCompliance,
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
      delta > TREND_NEUTRAL_BAND ? 'improving'
        : delta < -TREND_NEUTRAL_BAND ? 'degrading'
        : 'stable';

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
      consecutiveFailures: Number(consecutiveFailures),
      dailyStatuses,
      trend,
      uptimePercent,
    });
  }

  // Sort by score ascending (worst first, like a status page)
  entries.sort((a, b) => a.score - b.score);

  return entries;
}
