// StatusTicker — Mission Control's bottom strip with pipeline metadata.
// Extracted from the pre-consolidation DashboardHomeMissionControl during the
// 2026-08-25 monitoring consolidation. The errors field now deep-links to the
// Incidents inbox (the Health tab it used to open was consolidated away).

import { memo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { OverviewTab } from '@/lib/types/types';

export const StatusTicker = memo(function StatusTicker({
  pipelineSources, pipelineErrors, totalExecutions, lastSyncedLabel, onNavigate,
}: {
  pipelineSources: number;
  pipelineErrors: number;
  totalExecutions: number;
  lastSyncedLabel: string;
  onNavigate: (tab: OverviewTab) => void;
}) {
  const { t } = useTranslation();
  const fieldCls = 'flex items-center gap-1.5 typo-caption font-mono uppercase tracking-widest';
  // errors / runs / synced are shortcuts into the tab that owns each metric;
  // "sources" stays inert — it has no single dedicated destination.
  const linkCls = `${fieldCls} text-foreground rounded-interactive px-1 -mx-1 hover:text-primary transition-colors focus-ring`;
  return (
    <div className="rounded-card border border-primary/10 bg-primary/[0.03] px-4 py-2 flex items-center gap-5 overflow-x-auto">
      <span className="typo-caption font-mono uppercase tracking-[0.3em] text-foreground flex-shrink-0">{t.overview.dashboard.status_label}</span>
      <div className={`${fieldCls} text-foreground`}>
        <span className="text-foreground">{t.overview.dashboard.status_sources}</span>
        <span className="text-foreground tabular-nums">{pipelineSources}</span>
      </div>
      <button type="button" onClick={() => onNavigate('incidents')} className={linkCls}>
        <span>{t.overview.dashboard.status_errors}</span>
        <span className={`tabular-nums ${pipelineErrors > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{pipelineErrors}</span>
      </button>
      <button type="button" onClick={() => onNavigate('executions')} className={linkCls}>
        <span>{t.overview.dashboard.status_runs}</span>
        <Numeric value={totalExecutions} unit="count" />
      </button>
      <button type="button" onClick={() => onNavigate('home')} className={`${linkCls} ml-auto flex-shrink-0`}>
        <span>{t.overview.dashboard.status_synced}</span>
        <span className="tabular-nums">{lastSyncedLabel}</span>
      </button>
    </div>
  );
});
