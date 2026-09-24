// ActivityDepartures — PROTOTYPE variant C, "Departures".
//
// METAPHOR: a ruled ledger / airport departures board. Rows, not boxes. The
// baseline stacks five differently-dressed bands (title, usage label, account
// chips, board of tiles, rail of glyph rows); this variant has ONE grammar for
// all of them — a masthead strip, a tabular usage block, ruled sections of
// ledger lines, and a Log of two-line entries — held together by typography,
// alignment and hairline rules. Colour appears only in 6px state markers and
// status words, so the eye finds "failed" and "needs you" without a legend.
//
// Same props and the same data seam as `FleetGridView` (`useActivitySurface`);
// it differs only in how each fact is said, never in which facts it says.

import { memo } from 'react';
import { ListOrdered } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { segmentedTabPanelProps } from '@/features/shared/components/layout/SegmentedTabs';
import { BOARD_TABS_PREFIX } from '../../board/GridHeader';
import { SessionModals } from '../../board/SessionModals';
import { RailPlaceholder } from '../../board/RailSlot';
import { OrchestrationPanel } from '../../orchestration';
import { useActivitySurface, type ActivitySurface, type ActivitySurfaceProps } from '../useActivitySurface';
import { useUsageFeed } from '../useUsageFeed';
import { useRailSurface } from '../useRailSurface';
import { useQueueConfirm } from '../shared';
import { DeparturesHeader } from './DeparturesHeader';
import { DeparturesPlans } from './DeparturesPlans';
import { DeparturesClassic } from './DeparturesClassic';
import { DeparturesRunway } from './DeparturesRunway';
import { DeparturesLanes } from './DeparturesLanes';
import { DeparturesLog } from './DeparturesLog';
import { GhostLines, useLedgerClock } from './parts';

function QueueBody({
  surface, now, confirm,
}: {
  surface: ActivitySurface;
  now: number;
  confirm: ReturnType<typeof useQueueConfirm>;
}) {
  const { t } = useTranslation();
  if (surface.queueCold && surface.queueModel.empty) {
    return <div className="p-4" data-testid="fleet-queue-ghost"><GhostLines rows={8} /></div>;
  }
  if (surface.queueModel.empty) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-4" data-testid="fleet-queue-empty">
        <ScenarioEmptyState icon={ListOrdered} title={t.monitor.queue_empty_title} description={t.monitor.queue_empty_hint} />
      </div>
    );
  }
  return surface.layout === 'runway'
    ? <DeparturesRunway surface={surface} now={now} confirm={confirm} />
    : <DeparturesLanes surface={surface} now={now} confirm={confirm} />;
}

export const ActivityDepartures = memo(function ActivityDepartures(props: ActivitySurfaceProps) {
  const surface = useActivitySurface(props);
  const usage = useUsageFeed(surface.simulating);
  const rail = useRailSurface({
    feedTeams: props.feedTeams ?? [],
    onOpenSpeaker: props.onOpenSpeaker,
    filter: surface.scope,
    simulated: surface.simulatedRail,
  });
  const confirm = useQueueConfirm(surface.queueActions);
  const live = surface.model.totals.running > 0 || surface.queueModel.running.length > 0;
  const now = useLedgerClock(live);

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-card border border-border/70 bg-background/85 animate-fade-in"
      data-testid="activity-departures"
    >
      <DeparturesHeader surface={surface} />
      <DeparturesPlans usage={usage} />

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col" {...segmentedTabPanelProps(BOARD_TABS_PREFIX, surface.layout)}>
          {surface.layout === 'classic' ? (
            <DeparturesClassic
              surface={surface}
              selectedPersonaId={props.selectedPersonaId}
              now={now}
              onOpenRemote={props.onOpenRemote}
            />
          ) : (
            <QueueBody surface={surface} now={now} confirm={confirm} />
          )}
        </div>
        {surface.stage >= 2
          ? <DeparturesLog rail={rail} scope={surface.scope} onClearScope={surface.clearScope} />
          : <RailPlaceholder />}
      </div>

      <SessionModals
        terminal={surface.terminal}
        recap={surface.recap}
        onCloseTerminal={surface.closeTerminal}
        onCloseRecap={surface.closeRecap}
      />
      <OrchestrationPanel open={surface.orchestrationOpen} onClose={surface.closeOrchestration} />
      {rail.modals}
      {usage.dialog}
      {confirm.dialog}
    </div>
  );
});

export default ActivityDepartures;
