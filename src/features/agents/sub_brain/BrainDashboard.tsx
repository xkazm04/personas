import { Brain } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { AttentionLedgerStrip } from '@/features/agents/sub_life/AttentionLedgerStrip';
import { useBrainDashboard } from './useBrainDashboard';
import { MemoryTiersTile } from './MemoryTiersTile';
import { EpisodeVolumeTile } from './EpisodeVolumeTile';
import { ConsolidationYieldTile } from './ConsolidationYieldTile';
import { PressureTile } from './PressureTile';
import { AnomalyTile } from './AnomalyTile';
import { CoverageTile } from './CoverageTile';

/**
 * The Brain dashboard — one `get_persona_brain_dashboard` read, folded into
 * four tile groups an operator can evaluate at a glance:
 *
 * 1. what the brain HOLDS (memory tiers) and what it is TAKING IN (episode
 *    volume by day and role, with the flat episode record demoted to a
 *    drill-down beneath it),
 * 2. what sleep PRODUCED from that intake (consolidation yield per pass),
 * 3. what needs REACTING to (pressure against the admission threshold, the
 *    anomaly counts, and the attention ledger's own record beside them),
 * 4. what the brain holds NOTHING about (charter coverage).
 *
 * Absence is rendered as absence everywhere: a series the backend has no data
 * for gets a stated empty state, never a fabricated zero line.
 */
export function BrainDashboard({ personaId }: { personaId: string }) {
  const { t } = useTranslation();
  const b = t.agents.brain;
  const { dashboard, charters, isLoading, failed, chartersFailed, reload } =
    useBrainDashboard(personaId);

  if (failed && !dashboard) {
    return (
      <div data-testid="brain-dashboard-failed">
        <EmptyState
          icon={Brain}
          title={b.load_failed_title}
          description={b.load_failed_desc}
          action={{
            label: t.common.retry,
            onClick: reload,
          }}
        />
      </div>
    );
  }

  if (!dashboard) {
    // Calm geometry-matched ghost — the tiles' own shapes, nothing spinning.
    return (
      <div className="grid gap-4 lg:grid-cols-3" data-testid="brain-dashboard-ghost" aria-hidden>
        <div className="h-56 rounded-card bg-secondary/20 animate-pulse" />
        <div className="h-56 rounded-card bg-secondary/20 animate-pulse lg:col-span-2" />
        <div className="h-64 rounded-card bg-secondary/20 animate-pulse lg:col-span-3" />
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3" data-testid="brain-dashboard">
      <MemoryTiersTile tiers={dashboard.tierCounts} categories={dashboard.categoryCounts} />
      <div className="lg:col-span-2">
        <EpisodeVolumeTile series={dashboard.episodeSeries} personaId={personaId} />
      </div>

      <div className="lg:col-span-3">
        <ConsolidationYieldTile points={dashboard.consolidationSeries} />
      </div>

      <PressureTile pressure={dashboard.pressure} />
      <AnomalyTile anomaly={dashboard.anomaly} />
      <AttentionLedgerStrip personaId={personaId} />

      <div className="lg:col-span-3">
        <CoverageTile
          cells={dashboard.coverage}
          charters={charters}
          chartersFailed={chartersFailed}
          isLoading={isLoading}
        />
      </div>

      {failed && (
        // A refresh failed on top of a warm render: say so, keep the data.
        <div className="lg:col-span-3 flex items-center gap-3">
          <span className="typo-caption text-status-warning">{b.refresh_failed}</span>
          <AsyncButton size="sm" variant="ghost" onClick={async () => reload()}>
            {t.common.retry}
          </AsyncButton>
        </div>
      )}
    </div>
  );
}
