import { useMemo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import {
  RefreshCw, AlertTriangle, CheckCircle2, AlertCircle, XCircle, Circle, ChevronDown, ChevronRight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { useStatusPageData } from '../libs/useStatusPageData';
import type { CompositeHealthEntry, DayStatus } from '../libs/compositeHealthScore';
import type { HealthGrade } from '@/stores/slices/overview/personaHealthSlice';
import { DebtText } from '@/i18n/DebtText';
import { GRADE_THEME } from './heartbeats/model';
import { GradeDot, TrendBadge } from './heartbeats/primitives';
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Status Page — uptime-history table. Shares the Vitals Ledger quality bar:
// status-token palette, elevated container with a grade-tinted top accent,
// per-row grade gutter, tabular metrics.
// ---------------------------------------------------------------------------

const GRADE_META: Record<HealthGrade, { label: string; Icon: LucideIcon }> = {
  healthy: { label: 'Operational', Icon: CheckCircle2 },
  degraded: { label: 'Degraded', Icon: AlertCircle },
  critical: { label: 'Outage', Icon: XCircle },
  unknown: { label: 'Unknown', Icon: Circle },
};

const DAY_STATUS_BAR: Record<DayStatus, string> = {
  operational: 'bg-status-success',
  degraded: 'bg-status-warning',
  outage: 'bg-status-error',
  'no-data': 'bg-zinc-700',
};

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

  const meta = GRADE_META[globalGrade];
  const gth = GRADE_THEME[globalGrade];

  return (
    <div className="space-y-5">
      {error && (
        <InlineErrorBanner severity="error" message={error} onRetry={() => void refresh()} />
      )}

      {/* Global status header */}
      <div className="rounded-modal border border-primary/10 bg-secondary/10 shadow-elevation-2 overflow-hidden">
        <div className={`h-0.5 ${gth.bar} opacity-60`} />
        <div className="flex items-center justify-between gap-4 p-4">
          <div className="flex items-center gap-4 min-w-0 flex-wrap">
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-card border ${gth.chip}`}>
              <meta.Icon className="w-4 h-4" />
              <span className="typo-heading">{meta.label}</span>
            </div>
            <div className="flex items-baseline gap-3">
              <span className="typo-body text-foreground">
                {t.overview.health_extra.score_prefix} <span className="typo-data tabular-nums text-foreground/90 font-semibold">{globalScore}</span>/100
              </span>
              <span className="h-3 w-px bg-primary/15" aria-hidden="true" />
              <span className="typo-body text-foreground">
                {t.overview.health_extra.uptime_30d_prefix} <Numeric value={globalUptime} unit="ratio" precision={1} className="typo-data text-foreground/90 font-semibold" />
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {lastRefreshLabel && (
              <span className="typo-caption text-foreground">{t.overview.health_extra.updated_prefix} {lastRefreshLabel}</span>
            )}
            <button
              onClick={() => void refresh()}
              disabled={loading}
              className="p-1.5 rounded-card text-foreground hover:text-muted-foreground hover:bg-secondary/50 transition-colors disabled:opacity-50"
              title={t.common.refresh}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Persona rows */}
      {loading && entries.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-foreground typo-body">
          {t.overview.health_extra.loading_status}
        </div>
      ) : entries.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-foreground typo-body">
          {t.overview.health_extra.no_personas}
        </div>
      ) : (
        <div className="rounded-modal border border-primary/10 bg-secondary/5 shadow-elevation-2 overflow-hidden divide-y divide-primary/5">
          {entries.map(entry => (
            <StatusRow key={entry.personaId} entry={entry} />
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 typo-caption text-foreground pt-1">
        <span className="typo-label text-foreground">{t.overview.health_extra.legend}</span>
        <LegendItem color="bg-status-success" label={t.overview.health_extra.operational} />
        <LegendItem color="bg-status-warning" label={t.overview.health_extra.degraded} />
        <LegendItem color="bg-status-error" label={t.overview.health_extra.outage} />
        <LegendItem color="bg-zinc-700" label={t.overview.health_extra.no_data} />
      </div>
    </div>
  );
}

function StatusRow({ entry }: { entry: CompositeHealthEntry }) {
  const [expanded, setExpanded] = useState(false);
  const th = GRADE_THEME[entry.grade];
  const meta = GRADE_META[entry.grade];

  return (
    <div className={`relative ${expanded ? th.soft : ''}`}>
      <span className={`absolute left-0 inset-y-0 w-0.5 ${th.bar} ${entry.grade === 'healthy' ? 'opacity-30' : 'opacity-70'}`} aria-hidden="true" />
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-secondary/20 transition-colors">
        <div className="flex items-center gap-2 w-44 sm:w-52 shrink-0 min-w-0">
          <GradeDot grade={entry.grade} />
          <PersonaIcon icon={entry.personaIcon} color={entry.personaColor} display="framed" frameSize="xs" />
          <span className="typo-data text-foreground/90 truncate">{entry.personaName}</span>
        </div>

        <div className="flex-1 flex items-center gap-px min-w-0">
          {entry.dailyStatuses.map((status, i) => (
            <UptimeBar key={i} status={status} index={i} total={entry.dailyStatuses.length} />
          ))}
        </div>

        <Numeric value={entry.uptimePercent} unit="ratio" precision={1} align="right" className="typo-data text-foreground w-16 shrink-0" />

        <TrendBadge trend={entry.trend} />

        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-input border shrink-0 ${th.chip}`}>
          <meta.Icon className="w-3 h-3" />
          <span className="typo-data tabular-nums font-semibold">{entry.score}</span>
        </span>

        {expanded ? <ChevronDown className="w-4 h-4 text-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-foreground shrink-0" />}
      </button>

      {expanded && (
        <div className="px-4 pb-3 pt-1">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <ScoreBreakdown label="Success Rate" score={entry.successRateScore} detail={<Numeric value={entry.successRate} unit="ratio" precision={1} />} />
            <ScoreBreakdown label="Latency (p95)" score={entry.latencyScore} detail={formatLatency(entry.p95LatencyMs)} />
            <ScoreBreakdown label="Cost Anomalies" score={entry.costAnomalyScore} detail={`${entry.costAnomalyCount} detected`} />
            <ScoreBreakdown label="Healing Issues" score={entry.healingScore} detail={`${entry.openHealingIssues} open`} />
            <ScoreBreakdown label="SLA Compliance" score={entry.slaComplianceScore} detail={<Numeric value={entry.slaCompliance} unit="ratio" precision={1} />} />
          </div>
          {entry.consecutiveFailures > 0 && (
            <div className="mt-2.5 flex items-center gap-1.5 typo-caption text-status-error">
              <AlertTriangle className="w-3 h-3" />
              {entry.consecutiveFailures} <DebtText k="auto_consecutive_failure_4ac1baa6" />{entry.consecutiveFailures !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function UptimeBar({ status, index, total }: { status: DayStatus; index: number; total: number }) {
  const roundedLeft = index === 0 ? 'rounded-l-sm' : '';
  const roundedRight = index === total - 1 ? 'rounded-r-sm' : '';
  return (
    <div
      className={`h-7 flex-1 ${DAY_STATUS_BAR[status]} ${roundedLeft} ${roundedRight} hover:brightness-125 transition-[filter] cursor-default`}
      title={`Day ${index + 1}: ${status.replace('-', ' ')}`}
    />
  );
}

function ScoreBreakdown({ label, score, detail }: { label: string; score: number; detail: ReactNode }) {
  const tone = score >= 80 ? 'text-status-success' : score >= 50 ? 'text-status-warning' : 'text-status-error';
  const barTone = score >= 80 ? 'bg-status-success' : score >= 50 ? 'bg-status-warning' : 'bg-status-error';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-1">
        <span className="typo-caption text-foreground truncate">{label}</span>
        <span className={`typo-data tabular-nums font-semibold ${tone}`}>{score}</span>
      </div>
      <div className="h-1 rounded-full bg-secondary/30 overflow-hidden">
        <div className={`h-full rounded-full transition-[width] duration-500 ${barTone}`} style={{ width: `${Math.max(score, 2)}%` }} />
      </div>
      <span className="typo-caption text-foreground">{detail}</span>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-3 h-1.5 rounded-interactive ${color}`} />
      {label}
    </span>
  );
}

function formatLatency(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
