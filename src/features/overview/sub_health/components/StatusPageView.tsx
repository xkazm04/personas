import { useMemo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import {
  TrendingUp, TrendingDown, Minus, RefreshCw, AlertTriangle,
  CheckCircle2, AlertCircle, XCircle, Circle,
} from 'lucide-react';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { useStatusPageData } from '../libs/useStatusPageData';
import type { CompositeHealthEntry, DayStatus } from '../libs/compositeHealthScore';
import type { HealthGrade } from '@/stores/slices/overview/personaHealthSlice';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GRADE_BADGE: Record<HealthGrade, { bg: string; text: string; label: string; Icon: typeof CheckCircle2 }> = {
  healthy: { bg: 'bg-emerald-500/15 border-emerald-500/25', text: 'text-emerald-400', label: 'Operational', Icon: CheckCircle2 },
  degraded: { bg: 'bg-amber-500/15 border-amber-500/25', text: 'text-amber-400', label: 'Degraded', Icon: AlertCircle },
  critical: { bg: 'bg-red-500/15 border-red-500/25', text: 'text-red-400', label: 'Outage', Icon: XCircle },
  unknown: { bg: 'bg-zinc-500/15 border-zinc-500/25', text: 'text-zinc-400', label: 'Unknown', Icon: Circle },
};

const TREND_ICON = { improving: TrendingUp, stable: Minus, degrading: TrendingDown };
const TREND_COLOR = { improving: 'text-emerald-400', stable: 'text-zinc-400', degrading: 'text-red-400' };

const STATUS_COLORS: Record<DayStatus, string> = {
  operational: 'bg-emerald-400',
  degraded: 'bg-amber-400',
  outage: 'bg-red-400',
  'no-data': 'bg-zinc-700',
};

const STATUS_HOVER_COLORS: Record<DayStatus, string> = {
  operational: 'bg-emerald-300',
  degraded: 'bg-amber-300',
  outage: 'bg-red-300',
  'no-data': 'bg-zinc-600',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StatusPageView() {
  const { t } = useTranslation();
  const { entries, loading, error, globalScore, globalUptime, refresh, lastRefreshedAt } = useStatusPageData();

  const lastRefreshLabel = useMemo(() => {
    if (!lastRefreshedAt) return null;
    const ago = Math.round((Date.now() - lastRefreshedAt) / 1000);
    if (ago < 60) return `${ago}s ago`;
    return `${Math.round(ago / 60)}m ago`;
  }, [lastRefreshedAt]);

  const globalGrade = useMemo((): HealthGrade => {
    if (globalScore >= 80) return 'healthy';
    if (globalScore >= 50) return 'degraded';
    if (globalScore > 0) return 'critical';
    return 'unknown';
  }, [globalScore]);

  const globalBadge = GRADE_BADGE[globalGrade];

  return (
    <div className="space-y-5">
      {/* Error banner */}
      {error && (
        <InlineErrorBanner
          severity="error"
          message={error}
          onRetry={() => void refresh()}
        />
      )}

      {/* Global status header */}
      <div className="flex items-center justify-between p-4 rounded-modal border border-primary/10 bg-secondary/10">
        <div className="flex items-center gap-4">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-card border ${globalBadge.bg}`}>
            <globalBadge.Icon className={`w-4 h-4 ${globalBadge.text}`} />
            <span className={`typo-heading ${globalBadge.text}`}>{globalBadge.label}</span>
          </div>
          <div>
            <span className="text-sm text-muted-foreground/70">
              Score: <span className="text-foreground/90 font-semibold">{globalScore}</span>/100
            </span>
            <span className="mx-3 text-muted-foreground/30">|</span>
            <span className="text-sm text-muted-foreground/70">
              30d uptime: <span className="text-foreground/90 font-semibold">{(globalUptime * 100).toFixed(1)}%</span>
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {lastRefreshLabel && (
            <span className="text-xs text-muted-foreground/50">Updated {lastRefreshLabel}</span>
          )}
          <button
            onClick={() => void refresh()}
            disabled={loading}
            className="p-1.5 rounded-card text-muted-foreground/80 hover:text-muted-foreground hover:bg-secondary/50 transition-colors disabled:opacity-50"
            title={t.common.refresh}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Persona rows */}
      {loading && entries.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground/50 text-sm">
          {t.overview.health_extra.loading_status}
        </div>
      ) : entries.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground/50 text-sm">
          {t.overview.health_extra.no_personas}
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map(entry => (
            <StatusRow key={entry.personaId} entry={entry} />
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground/50 pt-2">
        <span className="font-medium text-muted-foreground/70">{t.overview.health_extra.legend}</span>
        <LegendItem color="bg-emerald-400" label={t.overview.health_extra.operational} />
        <LegendItem color="bg-amber-400" label={t.overview.health_extra.degraded} />
        <LegendItem color="bg-red-400" label={t.overview.health_extra.outage} />
        <LegendItem color="bg-zinc-700" label={t.overview.health_extra.no_data} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status Row — one persona
// ---------------------------------------------------------------------------

function StatusRow({ entry }: { entry: CompositeHealthEntry }) {
  const [expanded, setExpanded] = useState(false);
  const badge = GRADE_BADGE[entry.grade];
  const TrendIcon = TREND_ICON[entry.trend];

  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/5 overflow-hidden transition-colors hover:bg-secondary/10">
      {/* Main row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        {/* Persona identity */}
        <div className="flex items-center gap-2 w-44 flex-shrink-0">
          {entry.personaIcon && <span className="text-base">{entry.personaIcon}</span>}
          <span className="typo-heading text-foreground/90 truncate">{entry.personaName}</span>
        </div>

        {/* Uptime bars */}
        <div className="flex-1 flex items-center gap-px min-w-0">
          {entry.dailyStatuses.map((status, i) => (
            <UptimeBar key={i} status={status} index={i} total={entry.dailyStatuses.length} />
          ))}
        </div>

        {/* Uptime percent */}
        <span className="text-xs text-muted-foreground/60 w-16 text-right flex-shrink-0">
          {(entry.uptimePercent * 100).toFixed(1)}%
        </span>

        {/* Trend arrow */}
        <TrendIcon className={`w-3.5 h-3.5 flex-shrink-0 ${TREND_COLOR[entry.trend]}`} />

        {/* Health badge */}
        <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-input border ${badge.bg} flex-shrink-0`}>
          <badge.Icon className={`w-3 h-3 ${badge.text}`} />
          <span className={`text-xs font-medium ${badge.text}`}>{entry.score}</span>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-3 pt-1 border-t border-primary/5">
          <div className="grid grid-cols-5 gap-3">
            <ScoreBreakdown label="Success Rate" score={entry.successRateScore} detail={`${(entry.successRate * 100).toFixed(1)}%`} />
            <ScoreBreakdown label="Latency (p95)" score={entry.latencyScore} detail={formatLatency(entry.p95LatencyMs)} />
            <ScoreBreakdown label="Cost Anomalies" score={entry.costAnomalyScore} detail={`${entry.costAnomalyCount} detected`} />
            <ScoreBreakdown label="Healing Issues" score={entry.healingScore} detail={`${entry.openHealingIssues} open`} />
            <ScoreBreakdown label="SLA Compliance" score={entry.slaComplianceScore} detail={`${(entry.slaCompliance * 100).toFixed(1)}%`} />
          </div>
          {entry.consecutiveFailures > 0 && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-red-400/80">
              <AlertTriangle className="w-3 h-3" />
              {entry.consecutiveFailures} consecutive failure{entry.consecutiveFailures !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Uptime bar segment
// ---------------------------------------------------------------------------

function UptimeBar({ status, index, total }: { status: DayStatus; index: number; total: number }) {
  const isFirst = index === 0;
  const isLast = index === total - 1;
  const roundedLeft = isFirst ? 'rounded-l-sm' : '';
  const roundedRight = isLast ? 'rounded-r-sm' : '';

  return (
    <div
      className={`h-7 flex-1 ${STATUS_COLORS[status]} hover:${STATUS_HOVER_COLORS[status]} ${roundedLeft} ${roundedRight} transition-colors cursor-default`}
      title={`Day ${index + 1}: ${status.replace('-', ' ')}`}
    />
  );
}

// ---------------------------------------------------------------------------
// Score breakdown cell
// ---------------------------------------------------------------------------

function ScoreBreakdown({ label, score, detail }: { label: string; score: number; detail: string }) {
  const color = score >= 80 ? 'text-emerald-400' : score >= 50 ? 'text-amber-400' : 'text-red-400';
  const barWidth = `${Math.max(score, 2)}%`;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground/60">{label}</span>
        <span className={`text-xs font-semibold ${color}`}>{score}</span>
      </div>
      <div className="h-1 rounded-full bg-secondary/30 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            score >= 80 ? 'bg-emerald-400' : score >= 50 ? 'bg-amber-400' : 'bg-red-400'
          }`}
          style={{ width: barWidth }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground/40">{detail}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-3 h-1.5 rounded-interactive ${color}`} />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatLatency(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
