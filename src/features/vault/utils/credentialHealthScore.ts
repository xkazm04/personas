import type { AnomalyScore, Remediation, RotationStatus } from '@/api/vault/rotation';
import type { HealthResult } from '@/features/vault/hooks/health/useCredentialHealth';

// -- Score tiers ------------------------------------------------------

export type HealthTier = 'critical' | 'degraded' | 'warning' | 'healthy' | 'unknown';

export interface CompositeHealthScore {
  /** 0 -- 100 numeric score (lower = worse). */
  score: number;
  /** Tier derived from the score. */
  tier: HealthTier;
  /** Human-readable summary of the worst signal. */
  reason: string;
  /** Which signal drove the score down the most. */
  worstSignal: 'healthcheck' | 'anomaly' | 'rotation' | 'none';
}

// -- Weights ----------------------------------------------------------

const WEIGHT_HEALTHCHECK = 0.4;
const WEIGHT_ANOMALY = 0.4;
const WEIGHT_ROTATION = 0.2;

// -- Remediation severity mapping -------------------------------------

const REMEDIATION_SCORE: Record<Remediation, number> = {
  healthy: 100,
  backoff_retry: 60,
  preemptive_rotation: 35,
  rotate_then_alert: 15,
  disable: 0,
};

// -- Helpers ----------------------------------------------------------

function healthcheckScore(result: HealthResult | null): number {
  if (result === null) return 50; // untested = neutral
  return result.success ? 100 : 0;
}

function anomalySubScore(anomaly: AnomalyScore | null): number {
  if (!anomaly) return 100; // no data = assume healthy
  return REMEDIATION_SCORE[anomaly.remediation] ?? 50;
}

function rotationSubScore(status: RotationStatus | null): number {
  if (!status || !status.policy_enabled || !status.next_rotation_at) return 100;

  const msRemaining = new Date(status.next_rotation_at).getTime() - Date.now();
  if (msRemaining <= 0) return 0; // expired

  const hoursRemaining = msRemaining / (1000 * 60 * 60);
  if (hoursRemaining <= 24) return 20;
  if (hoursRemaining <= 72) return 50;
  if (hoursRemaining <= 168) return 75; // 7 days
  return 100;
}

function tierFromScore(score: number): HealthTier {
  if (score <= 20) return 'critical';
  if (score <= 45) return 'degraded';
  if (score <= 70) return 'warning';
  return 'healthy';
}

// -- Public API -------------------------------------------------------

/**
 * Compute a composite credential health score from all three observability signals.
 * Returns the weighted score, a tier label, and the worst contributing signal.
 */
export function computeHealthScore(
  healthResult: HealthResult | null,
  rotationStatus: RotationStatus | null,
): CompositeHealthScore {
  const hc = healthcheckScore(healthResult);
  const an = anomalySubScore(rotationStatus?.anomaly_score ?? null);
  const rot = rotationSubScore(rotationStatus);

  const weighted = Math.round(
    hc * WEIGHT_HEALTHCHECK + an * WEIGHT_ANOMALY + rot * WEIGHT_ROTATION,
  );

  // Determine the worst signal
  const signals: { name: CompositeHealthScore['worstSignal']; value: number; reason: string }[] = [
    {
      name: 'healthcheck',
      value: hc,
      reason: healthResult === null ? 'Never tested' : healthResult.success ? 'Healthy' : 'Healthcheck failing',
    },
    {
      name: 'anomaly',
      value: an,
      reason: rotationStatus?.healthcheck_corrupted
        ? 'Healthcheck data corrupted'
        : rotationStatus?.anomaly_score
          ? anomalyReason(rotationStatus.anomaly_score)
          : 'No anomaly data',
    },
    {
      name: 'rotation',
      value: rot,
      reason: rotationReason(rotationStatus),
    },
  ];

  const worst = signals.reduce((a, b) => (a.value <= b.value ? a : b));

  // If everything is unknown / neutral
  if (healthResult === null && !rotationStatus) {
    return { score: 50, tier: 'unknown', reason: 'No health data yet', worstSignal: 'none' };
  }

  return {
    score: weighted,
    tier: tierFromScore(weighted),
    reason: worst.reason,
    worstSignal: worst.name,
  };
}

function anomalyReason(score: AnomalyScore): string {
  switch (score.remediation) {
    case 'healthy': return 'No anomalies';
    case 'backoff_retry': return 'Transient failures (backoff active)';
    case 'preemptive_rotation': return 'Sustained degradation';
    case 'rotate_then_alert': return 'Permanent errors detected';
    case 'disable': return 'Auto-disabled: critical failures';
  }
}

function rotationReason(status: RotationStatus | null): string {
  if (!status || !status.policy_enabled || !status.next_rotation_at) return 'No rotation policy';
  const msRemaining = new Date(status.next_rotation_at).getTime() - Date.now();
  if (msRemaining <= 0) return 'Key expired';
  const hours = Math.round(msRemaining / (1000 * 60 * 60));
  if (hours <= 24) return `Key expires in ${hours}h`;
  const days = Math.round(hours / 24);
  return `Key expires in ${days}d`;
}

// -- Tier styling -----------------------------------------------------

export interface TierStyle {
  dotColor: string;
  badgeBg: string;
  badgeBorder: string;
  badgeText: string;
  label: string;
}

export function getTierStyle(tier: HealthTier): TierStyle {
  switch (tier) {
    case 'critical':
      return { dotColor: 'bg-red-500', badgeBg: 'bg-red-500/10', badgeBorder: 'border-red-500/20', badgeText: 'text-red-400', label: 'Critical' };
    case 'degraded':
      return { dotColor: 'bg-orange-500', badgeBg: 'bg-orange-500/10', badgeBorder: 'border-orange-500/20', badgeText: 'text-orange-400', label: 'Degraded' };
    case 'warning':
      return { dotColor: 'bg-amber-400', badgeBg: 'bg-amber-500/10', badgeBorder: 'border-amber-500/20', badgeText: 'text-amber-400', label: 'Warning' };
    case 'healthy':
      return { dotColor: 'bg-emerald-400', badgeBg: 'bg-emerald-500/10', badgeBorder: 'border-emerald-500/20', badgeText: 'text-emerald-400', label: 'Healthy' };
    case 'unknown':
      return { dotColor: 'bg-muted-foreground/40', badgeBg: 'bg-secondary/40', badgeBorder: 'border-primary/10', badgeText: 'text-muted-foreground/60', label: 'Untested' };
  }
}

/**
 * Numeric sort comparator: lower score = worse health = sorts first.
 * Useful for sorting credential lists by composite health.
 */
export function healthScoreComparator(a: CompositeHealthScore, b: CompositeHealthScore): number {
  return a.score - b.score;
}
