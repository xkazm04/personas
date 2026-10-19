/**
 * Leaderboard Scoring Engine
 *
 * Computes a composite performance score for each persona by combining:
 *   - Success Rate   (30%) — execution success percentage
 *   - Health         (20%) — heartbeat health score
 *   - Speed          (20%) — latency relative to fleet average (lower is better)
 *   - Cost Efficiency(20%) — cost per execution relative to fleet average (lower is better)
 *   - Activity       (10%) — recent execution volume relative to most active
 *
 * Input: PersonaHealthSignal[] from the health dashboard pipeline.
 * Output: Ranked LeaderboardEntry[] with composite scores, medals, and dimension breakdowns.
 */

import type { PersonaHealthSignal } from '@/stores/slices/overview/personaHealthSlice';

// ── Types ──────────────────────────────────────────────────────────────

/** Stable identifier for a score dimension — used for ranking + i18n lookup,
 *  independent of the (English) display label. */
export type DimensionKey = 'success' | 'health' | 'speed' | 'cost' | 'activity';

export interface ScoreDimension {
  key: DimensionKey;
  value: number;   // 0-100 normalized
}

export type Medal = 'gold' | 'silver' | 'bronze' | null;

export interface LeaderboardEntry {
  personaId: string;
  personaName: string;
  personaIcon: string | null;
  personaColor: string | null;

  rank: number;
  compositeScore: number; // 0-100
  medal: Medal;

  dimensions: ScoreDimension[];

  /** Composite tiebreaker in `computeLeaderboard`'s sort. */
  successRate: number;
}

// ── Weights ────────────────────────────────────────────────────────────

const WEIGHTS = {
  success: 0.30,
  health: 0.20,
  speed: 0.20,
  cost: 0.20,
  activity: 0.10,
} as const;

// ── Scoring functions ──────────────────────────────────────────────────

/** Normalize latency to 0-100 where lower latency = higher score.
 *  Uses fleet average as the midpoint (score=50). */
function scoreSpeed(latencyMs: number, fleetAvgMs: number): number {
  if (fleetAvgMs <= 0 || latencyMs <= 0) return 50;
  // Ratio: 0.5x average → 100, 1x → 50, 2x → 0
  const ratio = latencyMs / fleetAvgMs;
  return Math.max(0, Math.min(100, Math.round(100 * (1 - (ratio - 0.5) / 1.5))));
}

/** Normalize cost per execution to 0-100 where lower cost = higher score. */
function scoreCostEfficiency(costPerExec: number, fleetAvgCost: number): number {
  if (fleetAvgCost <= 0 || costPerExec <= 0) return 50;
  const ratio = costPerExec / fleetAvgCost;
  return Math.max(0, Math.min(100, Math.round(100 * (1 - (ratio - 0.5) / 1.5))));
}

/** Normalize activity to 0-100 relative to the most active agent. */
function scoreActivity(recentExecs: number, maxRecent: number): number {
  if (maxRecent <= 0) return 0;
  return Math.round((recentExecs / maxRecent) * 100);
}

function assignMedal(rank: number): Medal {
  if (rank === 1) return 'gold';
  if (rank === 2) return 'silver';
  if (rank === 3) return 'bronze';
  return null;
}

// ── Main computation ───────────────────────────────────────────────────

/** Compute leaderboard from health signals. Requires at least 1 signal. */
export function computeLeaderboard(signals: PersonaHealthSignal[]): LeaderboardEntry[] {
  if (signals.length === 0) return [];

  // Fleet-wide averages for normalization
  const withExecs = signals.filter((s) => s.totalExecutions > 0);
  const fleetAvgLatency = withExecs.length > 0
    ? withExecs.reduce((sum, s) => sum + s.avgLatencyMs, 0) / withExecs.length
    : 1000;

  const fleetAvgCost = withExecs.length > 0
    ? withExecs.reduce((sum, s) => sum + s.dailyBurnRate, 0) / withExecs.length
    : 0.01;

  const maxRecentExecs = Math.max(1, ...signals.map((s) => s.recentExecutions));

  // Score each persona
  const entries: LeaderboardEntry[] = signals.map((signal) => {
    const successScore = signal.successRate;
    const healthScore = signal.heartbeatScore;
    const speedScore = scoreSpeed(signal.avgLatencyMs, fleetAvgLatency);
    const costScore = scoreCostEfficiency(signal.dailyBurnRate, fleetAvgCost);
    const activityScore = scoreActivity(signal.recentExecutions, maxRecentExecs);

    // Speed & cost only contribute to the composite when there's a real baseline
    // AND the agent has data — scoreSpeed/scoreCostEfficiency return a neutral 50
    // otherwise (fine for the dimension display, which shows '—'), but folding a
    // flat 50 into the weighted score across the fleet flattens the ranking and
    // masks real performance. Drop the dimension and renormalize the remaining
    // weights so the composite reflects only the dimensions with real data.
    const hasSpeed = fleetAvgLatency > 0 && signal.avgLatencyMs > 0;
    const hasCost = fleetAvgCost > 0 && signal.dailyBurnRate > 0;
    const parts: Array<[number, number]> = [
      [successScore, WEIGHTS.success],
      [healthScore, WEIGHTS.health],
      [activityScore, WEIGHTS.activity],
    ];
    if (hasSpeed) parts.push([speedScore, WEIGHTS.speed]);
    if (hasCost) parts.push([costScore, WEIGHTS.cost]);
    const totalWeight = parts.reduce((sum, [, w]) => sum + w, 0);
    const composite = Math.round(
      parts.reduce((sum, [v, w]) => sum + v * w, 0) / totalWeight,
    );

    const dimensions: ScoreDimension[] = [
      { key: 'success', value: successScore },
      { key: 'health', value: healthScore },
      { key: 'speed', value: speedScore },
      { key: 'cost', value: costScore },
      { key: 'activity', value: activityScore },
    ];

    return {
      personaId: signal.personaId,
      personaName: signal.personaName,
      personaIcon: signal.personaIcon,
      personaColor: signal.personaColor,
      rank: 0, // filled after sorting
      compositeScore: composite,
      medal: null, // filled after sorting
      dimensions,
      successRate: signal.successRate,
    };
  });

  // Sort descending by composite score, then by success rate as tiebreaker
  entries.sort((a, b) => b.compositeScore - a.compositeScore || b.successRate - a.successRate);

  // Assign ranks and medals
  entries.forEach((entry, i) => {
    entry.rank = i + 1;
    entry.medal = assignMedal(i + 1);
  });

  return entries;
}
