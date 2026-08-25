// Prototype variant piece — "Consolidated Mission Control".
//
// Compact status monitor: StatusPageView's uptime-history table transformed
// into a Mission Control pane. Global grade chip + the fleet's worst rows
// first, each with the per-day uptime strip. Deep-links to the full Health
// status page for the expandable score breakdowns.
//
// Copy is prototype-local (same convention as the Mission Control baseline);
// extracted to i18n at consolidation.

import { useMemo } from 'react';
import { ArrowRight, CheckCircle2, AlertCircle, XCircle, Circle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { ListSkeleton } from '@/features/shared/components/layout/ListSkeleton';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useStatusPageData } from '@/features/overview/sub_health/libs/useStatusPageData';
import { computeGrade, type CompositeHealthEntry, type DayStatus } from '@/features/overview/sub_health/libs/compositeHealthScore';
import type { HealthGrade } from '@/stores/slices/overview/personaHealthSlice';
import { GRADE_THEME } from '@/features/overview/sub_health/components/heartbeats/model';
import { GradeDot } from '@/features/overview/sub_health/components/heartbeats/primitives';
import { PaneHeader } from '../PaneHeader';

const COPY = {
  pane: 'STATUS',
  subtitle: 'fleet uptime',
  fullPage: 'Full status page',
  uptime30d: '30d uptime',
  score: 'score',
};

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

/** Worst grades surface first — the monitor's job is triage, not roll call. */
const GRADE_RANK: Record<HealthGrade, number> = {
  critical: 0, degraded: 1, unknown: 2, healthy: 3,
};

const MAX_ROWS = 6;

export function MissionStatusMonitor({ onOpenStatusPage }: { onOpenStatusPage: () => void }) {
  const { t } = useTranslation();
  const { entries, loading, error, globalScore, globalUptime, refresh } = useStatusPageData();

  const globalGrade = useMemo(
    (): HealthGrade => (globalScore == null ? 'unknown' : computeGrade(globalScore)),
    [globalScore],
  );

  const topEntries = useMemo(() => {
    return [...entries]
      .sort((a, b) => GRADE_RANK[a.grade] - GRADE_RANK[b.grade] || a.score - b.score)
      .slice(0, MAX_ROWS);
  }, [entries]);

  const meta = GRADE_META[globalGrade];
  const gth = GRADE_THEME[globalGrade];

  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/[0.03] overflow-hidden flex flex-col">
      <div className={`h-0.5 ${gth.bar} opacity-60`} />
      <PaneHeader label={COPY.pane} subtitle={COPY.subtitle}>
        <button
          type="button"
          onClick={onOpenStatusPage}
          className="typo-caption text-primary/80 hover:text-primary transition-colors flex items-center gap-1 font-mono uppercase tracking-widest focus-ring rounded-interactive"
        >
          {COPY.fullPage} <ArrowRight className="w-3 h-3" />
        </button>
      </PaneHeader>

      {/* Global readout */}
      <div className="flex items-center justify-between gap-3 px-3 py-2.5 border-b border-primary/5">
        <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-card border ${gth.chip}`}>
          <meta.Icon className="w-3.5 h-3.5" />
          <span className="typo-caption font-medium">{meta.label}</span>
        </span>
        <div className="flex items-baseline gap-3">
          <span className="typo-caption text-foreground">
            {COPY.score} <span className="typo-data tabular-nums text-foreground/90 font-semibold">{globalScore ?? '—'}</span>/100
          </span>
          <span className="h-3 w-px bg-primary/15" aria-hidden="true" />
          <span className="typo-caption text-foreground">
            {COPY.uptime30d} <Numeric value={globalUptime} unit="ratio" precision={1} className="typo-data text-foreground/90 font-semibold" />
          </span>
        </div>
      </div>

      {error && (
        <div className="px-3 pt-2">
          <InlineErrorBanner severity="error" compact message={error} onRetry={() => void refresh()} />
        </div>
      )}

      {/* Rows — worst first. Loading with nothing on screen shows calm ghost
          rows (docs/design/overview-loading.md law 1); rows already painted
          are never hidden by the 60s refresh. */}
      {loading && entries.length === 0 ? (
        <ListSkeleton calm rows={4} rowHeight={40} leading={false} />
      ) : topEntries.length === 0 ? (
        <div className="flex-1 flex items-center justify-center py-8 typo-caption text-foreground">
          {t.overview.health_extra.no_personas}
        </div>
      ) : (
        <div className="flex-1 min-h-0 divide-y divide-primary/5">
          {topEntries.map((entry) => (
            <MonitorRow key={entry.personaId} entry={entry} onClick={onOpenStatusPage} />
          ))}
        </div>
      )}
    </div>
  );
}

function MonitorRow({ entry, onClick }: { entry: CompositeHealthEntry; onClick: () => void }) {
  const th = GRADE_THEME[entry.grade];
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-primary/[0.04] transition-colors focus-ring"
    >
      <span className={`absolute left-0 inset-y-0 w-0.5 ${th.bar} ${entry.grade === 'healthy' ? 'opacity-30' : 'opacity-70'}`} aria-hidden="true" />
      <GradeDot grade={entry.grade} />
      <PersonaIcon icon={entry.personaIcon} color={entry.personaColor} name={entry.personaName} display="framed" frameSize="xs" />
      <span className="typo-body text-foreground/90 truncate w-28 sm:w-36 shrink-0">{entry.personaName}</span>
      <span className="flex-1 flex items-center gap-px min-w-0">
        {entry.dailyStatuses.map((status, i) => (
          <span
            key={i}
            className={`h-4 flex-1 ${DAY_STATUS_BAR[status]} ${i === 0 ? 'rounded-l-sm' : ''} ${i === entry.dailyStatuses.length - 1 ? 'rounded-r-sm' : ''}`}
          />
        ))}
      </span>
      <Numeric value={entry.uptimePercent} unit="ratio" precision={1} align="right" className="typo-caption tabular-nums text-foreground w-12 shrink-0" />
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-input border shrink-0 ${th.chip}`}>
        <span className="typo-caption tabular-nums font-semibold">{entry.score}</span>
      </span>
    </button>
  );
}
