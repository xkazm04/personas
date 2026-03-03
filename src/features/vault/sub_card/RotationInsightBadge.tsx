import { ShieldOff, AlertTriangle, TrendingDown, Timer, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import type { AnomalyScore, Remediation } from '@/api/rotation';

interface RotationInsightBadgeProps {
  anomalyScore: AnomalyScore;
  consecutiveFailures: number;
}

const BADGE_CONFIG: Record<
  Exclude<Remediation, 'healthy'>,
  { label: string; Icon: typeof ShieldOff; classes: string }
> = {
  disable: {
    label: 'Disabled',
    Icon: ShieldOff,
    classes: 'bg-red-500/15 border-red-500/25 text-red-400',
  },
  rotate_then_alert: {
    label: 'Perm Errors',
    Icon: AlertTriangle,
    classes: 'bg-red-500/10 border-red-500/20 text-red-400',
  },
  preemptive_rotation: {
    label: 'Degrading',
    Icon: TrendingDown,
    classes: 'bg-orange-500/10 border-orange-500/20 text-orange-400',
  },
  backoff_retry: {
    label: 'Backoff',
    Icon: Timer,
    classes: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
  },
};

function trendArrow(rate5m: number, rate1h: number) {
  const delta = rate5m - rate1h;
  if (delta > 0.05) return 'up';
  if (delta < -0.05) return 'down';
  return 'flat';
}

function buildTooltip(score: AnomalyScore, consecutiveFailures: number): string {
  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
  const parts: string[] = [];

  if (score.remediation === 'disable') {
    parts.push('Auto-disabled: sustained permanent failures above threshold.');
  } else if (score.remediation === 'rotate_then_alert') {
    parts.push('Permanent errors detected — rotation attempted, alerting.');
  } else if (score.remediation === 'preemptive_rotation') {
    parts.push('Sustained degradation — pre-emptive rotation triggered.');
  } else if (score.remediation === 'backoff_retry') {
    parts.push('Transient failures — exponential backoff active.');
  }

  parts.push(`Failure rates: 5m ${pct(score.failure_rate_5m)} · 1h ${pct(score.failure_rate_1h)} · 24h ${pct(score.failure_rate_24h)}`);

  if (score.permanent_failure_rate_1h > 0) {
    parts.push(`Permanent (1h): ${pct(score.permanent_failure_rate_1h)}`);
  }
  if (score.transient_failure_rate_1h > 0) {
    parts.push(`Transient (1h): ${pct(score.transient_failure_rate_1h)}`);
  }

  if (consecutiveFailures > 0) {
    parts.push(`${consecutiveFailures} consecutive failures`);
  }

  parts.push(`${score.sample_count} samples${score.data_stale ? ' (stale)' : ''}`);

  return parts.join('\n');
}

/**
 * Compact header badge surfacing the backend's windowed anomaly scoring.
 *
 * Shows: remediation level label, trend arrow (5m vs 1h), and failure
 * classification hint. Only rendered when the anomaly score indicates
 * a non-healthy state.
 */
export function RotationInsightBadge({ anomalyScore, consecutiveFailures }: RotationInsightBadgeProps) {
  const rem = anomalyScore.remediation;
  if (rem === 'healthy') return null;

  const config = BADGE_CONFIG[rem];
  if (!config) return null;

  const { label, Icon, classes } = config;
  const trend = trendArrow(anomalyScore.failure_rate_5m, anomalyScore.failure_rate_1h);
  const tooltip = buildTooltip(anomalyScore, consecutiveFailures);

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border flex-shrink-0 ${classes}`}
      title={tooltip}
    >
      <Icon className="w-2.5 h-2.5" />
      <span className="text-[11px] font-medium">{label}</span>
      {trend === 'up' && <ArrowUp className="w-2.5 h-2.5" />}
      {trend === 'down' && <ArrowDown className="w-2.5 h-2.5 opacity-60" />}
      {trend === 'flat' && <Minus className="w-2 h-2 opacity-40" />}
    </span>
  );
}
