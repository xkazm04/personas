import { Activity, TrendingDown } from 'lucide-react';
import type { AnomalyScore } from '@/api/rotation';

const REMEDIATION_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  healthy: { label: 'Healthy', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
  backoff_retry: { label: 'Transient Issues', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
  preemptive_rotation: { label: 'Degrading', color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20' },
  rotate_then_alert: { label: 'Permanent Errors', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' },
  disable: { label: 'Critical', color: 'text-red-400', bg: 'bg-red-500/15 border-red-500/25' },
};

export function AnomalyScorePanel({ score, tolerance }: { score: AnomalyScore; tolerance: number }) {
  const rem = REMEDIATION_LABELS[score.remediation] ?? REMEDIATION_LABELS.healthy!;
  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

  return (
    <div className={`rounded-xl border px-3 py-2.5 space-y-2 ${rem.bg}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className={`w-3.5 h-3.5 ${rem.color}`} />
          <span className={`text-sm font-medium ${rem.color}`}>{rem.label}</span>
        </div>
        <div className="flex items-center gap-2">
          {score.data_stale && (
            <span className="text-sm text-muted-foreground/60 bg-secondary/40 px-1.5 py-0.5 rounded">stale</span>
          )}
          <span className="text-sm text-muted-foreground/60 tabular-nums">{score.sample_count} samples</span>
        </div>
      </div>

      {/* Failure rate bars */}
      <div className="grid grid-cols-3 gap-2">
        <RateBar label="5m" rate={score.failure_rate_5m} threshold={tolerance} />
        <RateBar label="1h" rate={score.failure_rate_1h} threshold={tolerance} />
        <RateBar label="24h" rate={score.failure_rate_24h} threshold={tolerance} />
      </div>

      {/* Error classification breakdown */}
      {(score.permanent_failure_rate_1h > 0 || score.transient_failure_rate_1h > 0) && (
        <div className="flex items-center gap-3 text-sm text-muted-foreground/80">
          {score.permanent_failure_rate_1h > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
              Permanent: {pct(score.permanent_failure_rate_1h)}
            </span>
          )}
          {score.transient_failure_rate_1h > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              Transient: {pct(score.transient_failure_rate_1h)}
            </span>
          )}
          <span className="flex items-center gap-1 ml-auto">
            <TrendingDown className="w-3 h-3" />
            Tolerance: {pct(tolerance)}
          </span>
        </div>
      )}
    </div>
  );
}

function RateBar({ label, rate, threshold }: { label: string; rate: number; threshold: number }) {
  const pct = Math.min(rate * 100, 100);
  const isOver = rate > threshold;
  const barColor = isOver ? 'bg-red-400' : rate > 0 ? 'bg-amber-400' : 'bg-emerald-400/60';

  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground/70 font-mono">{label}</span>
        <span className={`text-sm font-mono tabular-nums ${isOver ? 'text-red-400' : 'text-muted-foreground/80'}`}>
          {pct.toFixed(0)}%
        </span>
      </div>
      <div className="h-1 bg-secondary/30 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
