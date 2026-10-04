// Layer 2 bodies: one per dimension. Every region the old page stacked is
// mounted here, under the dimension it actually answers, with the full width
// of the detail area instead of a half-column. The components are the page's
// own (same fetches, same navigation, same toggles); only where they sit moved.

import { Suspense, useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from '@/i18n/useTranslation';
import { useOverviewStore } from '@/stores/overviewStore';
import { useSystemStore } from '@/stores/systemStore';
import { useOverviewFilterValues } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { lazyRetry } from '@/lib/lazyRetry';
import { Section, StatStrip, Ghost } from '@/features/shared/components/kit';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { ExecutionHeatmap } from '@/features/overview/sub_analytics/components/ExecutionHeatmap';
import { DailyTrendChart } from '@/features/overview/sub_sla/components/SLACard';
import { HealingEffectivenessPanel } from '@/features/overview/sub_health/components/heartbeats/HealingEffectivenessPanel';
import { MemoryActionsPanel } from '@/features/overview/sub_memories/components/MemoryActionCard';
import FleetOptimizationCard from '../../../cards/FleetOptimizationCard';
import { MissionStatusMonitor } from '../../../sections/MissionStatusMonitor';
import { LeaderboardSection } from '../../../sections/LeaderboardSection';
import type { DimId } from '../dimensions';
import type { MissionReadings } from '../useMissionReadings';
import { SpendDetail } from './SpendDetail';
import { InstrumentsDetail } from './InstrumentsDetail';

const UpcomingRoutinesCard = lazyRetry(() => import('../../../cards/UpcomingRoutinesCard'));
const VaultActivityCard = lazyRetry(() => import('../../../cards/VaultActivityCard'));
const AttentionLoopCard = lazyRetry(() => import('../../../cards/AttentionLoopCard'));

const CardFallback = () => <Ghost width="100%" height="160px" />;

export function DimDetail({ id, readings }: { id: DimId; readings: MissionReadings }) {
  const { t } = useTranslation();
  const hidden = useSystemStore((s) => s.homeHiddenSections);
  const { memoryActions, dismissMemoryAction, setOverviewTab } = useOverviewStore(useShallow((s) => ({
    memoryActions: s.memoryActions, dismissMemoryAction: s.dismissMemoryAction, setOverviewTab: s.setOverviewTab,
  })));
  const { selectedPersonaId } = useOverviewFilterValues();
  const goToExecutions = useCallback(() => setOverviewTab('executions'), [setOverviewTab]);
  const trend = useMemo(() => readings.points.map((p) => ({
    date: p.date, total: p.runs, success_rate: p.runs > 0 ? (p.runs - p.failed) / p.runs : 0,
  })), [readings.points]);

  switch (id) {
    case 'outcomes':
      return (
        <div className="mc-detail-stack">
          {trend.length > 0 && (
            <Section level={2} title={t.overview.sla.success_rate} meta={`${trend.length}d`}>
              <DailyTrendChart points={trend} />
            </Section>
          )}
          {!hidden.includes('heatmap') && (
            <ExecutionHeatmap personaId={selectedPersonaId || undefined} onDayClick={goToExecutions} />
          )}
        </div>
      );
    case 'agents':
      return (
        <div className="mc-detail-stack">
          <MissionStatusMonitor />
          <LeaderboardSection />
        </div>
      );
    case 'queue': {
      const q = readings.queue.status === 'ready' ? readings.queue.value : null;
      const n = (v: number | undefined) => (v === undefined ? null : <Numeric value={v} unit="count" />);
      return (
        <div className="mc-detail-stack">
          <StatStrip tiles={[
            { label: t.overview.dashboard.tile_alerts, value: n(q?.alerts), state: q ? 'default' : 'loading' },
            { label: t.overview.dashboard.tile_reviews, value: n(q?.reviews), state: q ? 'default' : 'loading' },
            { label: t.overview.dashboard.pane_memory, value: n(q?.memory), state: q ? 'default' : 'loading' },
            { label: t.overview.dashboard.triage_detail_messages, value: n(q?.reports), state: q ? 'default' : 'loading' },
          ]} />
          {memoryActions.length > 0 && !hidden.includes('memory') && (
            <Section level={2} title={t.overview.dashboard.pane_memory}>
              <MemoryActionsPanel actions={memoryActions} onDismiss={dismissMemoryAction} />
            </Section>
          )}
        </div>
      );
    }
    case 'recovery':
      return (
        <div className="mc-detail-stack">
          <HealingEffectivenessPanel />
          {!hidden.includes('fleet') && <FleetOptimizationCard />}
        </div>
      );
    case 'spend':
      return <SpendDetail readings={readings} />;
    case 'autonomy':
      return (
        <div className="mc-detail-grid">
          {/* The loop tile stays outside the 'routines' toggle: it carries the
              loop's global switch, which must stay reachable (same as the page). */}
          <Suspense fallback={<CardFallback />}><AttentionLoopCard /></Suspense>
          {!hidden.includes('routines') && <Suspense fallback={<CardFallback />}><UpcomingRoutinesCard /></Suspense>}
        </div>
      );
    case 'vault':
      return hidden.includes('routines') ? null : <Suspense fallback={<CardFallback />}><VaultActivityCard /></Suspense>;
    case 'instruments':
      return <InstrumentsDetail />;
  }
}
