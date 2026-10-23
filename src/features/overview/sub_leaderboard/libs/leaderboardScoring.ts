/**
 * Leaderboard Scoring Engine
 *
 * Computes a composite performance score for each persona by combining:
 *   - Success Rate   (30%) — the persona's own measured success percentage
 *   - Health         (20%) — heartbeat health score
 *   - Speed          (20%) — latency relative to fleet average (lower is better)
 *   - Cost           (20%) — daily burn relative to fleet average (lower is better)
 *   - Activity       (10%) — recent execution volume relative to most active
 *
 * Absence policy (registry scoring-rubrics / unmeasured-honesty): a dimension
 * this persona was not measured on is `null`, never a default. The slice fills
 * an agent with no decided runs with a success rate of 100 ('unknown') or the
 * fleet's rate ('proxy'), a heartbeat built on that rate, and the fleet's
 * latency; scoring any of those let an agent that never ran take gold. The
 * composite renormalizes over the measured dimensions, and below
 * COVERAGE_FLOOR of the total weight it is `null`: the persona is listed but
 * not ranked.
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
  /** 0-100 normalized, or null when this persona has no measurement for it. */
  value: number | null;
}

export type Medal = 'gold' | 'silver' | 'bronze' | null;

export interface LeaderboardEntry {
  personaId: string;
  personaName: string;
  personaIcon: string | null;
  personaColor: string | null;

  /** 1-based, or null when the persona is below the coverage floor. */
  rank: number | null;
  /** 0-100 over the measured dimensions, or null below the coverage floor. */
  compositeScore: number | null;
  medal: Medal;

  dimensions: ScoreDimension[];
}

// ── Weights ────────────────────────────────────────────────────────────

const WEIGHTS = {
  success: 0.30,
  health: 0.20,
  speed: 0.20,
  cost: 0.20,
  activity: 0.10,
} as const;

/** Share of the total weight that must be measured before a persona is
 *  ranked. Success + health (0.5) are measured together, from the persona's
 *  own decided runs, so in practice: no decided runs, no rank. */
export const COVERAGE_FLOOR = 0.5;

// ── Scoring functions ──────────────────────────────────────────────────

/** Normalize a lower-is-better quantity to 0-100 against the fleet average:
 *  0.5x average → 100, 1x → 50, 2x → 0. */
function scoreAgainstAverage(value: number, fleetAvg: number): number {
  const ratio = value / fleetAvg;
  return Math.max(0, Math.min(100, Math.round(100 * (1 - (ratio - 0.5) / 1.5))));
}

/** Normalize activity to 0-100 relative to the most active agent. */
function scoreActivity(recentExecs: number, maxRecent: number): number {
  if (maxRecent <= 0) return 0;
  return Math.round((recentExecs / maxRecent) * 100);
}

function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
}

const MEDALS = ['gold', 'silver', 'bronze'] as const;

/** Medal for a 1-based rank; an unranked entry never carries one. */
export function medalFor(rank: number | null): Medal {
  return rank !== null && rank <= MEDALS.length ? MEDALS[rank - 1]! : null;
}

/** A dimension's normalized value, or null when the persona was not measured on it. */
export function dimensionValue(entry: LeaderboardEntry, key: DimensionKey): number | null {
  return entry.dimensions.find((d) => d.key === key)?.value ?? null;
}

// ── Main computation ───────────────────────────────────────────────────

/** Compute leaderboard from health signals. Requires at least 1 signal. */
export function computeLeaderboard(signals: PersonaHealthSignal[]): LeaderboardEntry[] {
  if (signals.length === 0) return [];

  // Only the persona's own decided runs measure success, health and latency.
  const measured = (s: PersonaHealthSignal) => s.successRateSource === 'measured';

  // Fleet averages over the personas actually measured on each quantity.
  const fleetAvgLatency = mean(signals.filter((s) => measured(s) && s.avgLatencyMs > 0).map((s) => s.avgLatencyMs));
  const fleetAvgCost = mean(signals.filter((s) => s.dailyBurnRate > 0).map((s) => s.dailyBurnRate));
  const maxRecentExecs = Math.max(1, ...signals.map((s) => s.recentExecutions));

  const entries: LeaderboardEntry[] = signals.map((signal) => {
    const ownRuns = measured(signal);
    const values: Record<DimensionKey, number | null> = {
      success: ownRuns ? signal.successRate : null,
      // 40% of the heartbeat IS the success rate, and the rest are penalties
      // from a full score that an agent which never ran cannot incur.
      health: ownRuns ? signal.heartbeatScore : null,
      speed: ownRuns && signal.avgLatencyMs > 0 && fleetAvgLatency
        ? scoreAgainstAverage(signal.avgLatencyMs, fleetAvgLatency)
        : null,
      cost: signal.dailyBurnRate > 0 && fleetAvgCost
        ? scoreAgainstAverage(signal.dailyBurnRate, fleetAvgCost)
        : null,
      // A count: zero runs is a measurement, not an absence.
      activity: scoreActivity(signal.recentExecutions, maxRecentExecs),
    };

    let weighted = 0;
    let coverage = 0;
    for (const key of Object.keys(WEIGHTS) as DimensionKey[]) {
      const v = values[key];
      if (v === null) continue;
      weighted += v * WEIGHTS[key];
      coverage += WEIGHTS[key];
    }
    // Rounded so float sums (0.3 + 0.2) compare cleanly against the floor.
    const scored = Math.round(coverage * 100) >= Math.round(COVERAGE_FLOOR * 100);

    return {
      personaId: signal.personaId,
      personaName: signal.personaName,
      personaIcon: signal.personaIcon,
      personaColor: signal.personaColor,
      rank: null, // filled after sorting
      compositeScore: scored ? Math.round(weighted / coverage) : null,
      medal: null, // filled after sorting
      dimensions: (Object.keys(WEIGHTS) as DimensionKey[]).map((key) => ({ key, value: values[key] })),
    };
  });

  // Scored entries first by composite, success as the tiebreaker; unscored
  // after them, busiest first.
  const success = (e: LeaderboardEntry) => dimensionValue(e, 'success') ?? -1;
  const activity = (e: LeaderboardEntry) => dimensionValue(e, 'activity') ?? -1;
  entries.sort((a, b) =>
    (b.compositeScore ?? -1) - (a.compositeScore ?? -1)
    || success(b) - success(a)
    || activity(b) - activity(a),
  );

  entries.forEach((entry, i) => {
    if (entry.compositeScore === null) return;
    entry.rank = i + 1;
    entry.medal = medalFor(entry.rank);
  });

  return entries;
}
