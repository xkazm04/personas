// VARIANT A — "Instrument". PROTOTYPE.
//
// The Activity surface as an avionics HUD: one annunciator command band, a row
// of capacity gauges, a board of instrument cells (luminous state spines, full
// names, mono data lines), a slot rack for Runway, and a signal-log rail.
// Different from baseline: four stacked chrome bands with four control
// vocabularies become two bands with one; glyph rows become worded mono data;
// boxes become spines, so the board reads as light on glass, not tiles.

import { segmentedTabPanelProps } from '@/features/shared/components/layout/SegmentedTabs';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { ListOrdered } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { BOARD_TABS_PREFIX } from '../../board/GridHeader';
import { SessionModals } from '../../board/SessionModals';
import { OrchestrationPanel } from '../../orchestration';
import { useActivitySurface, type ActivitySurfaceProps } from '../useActivitySurface';
import { useUsageFeed } from '../useUsageFeed';
import { useRailSurface } from '../useRailSurface';
import { useQueueConfirm } from '../shared';
import { InstrumentCommandBand } from './InstrumentCommandBand';
import { InstrumentCapacity } from './InstrumentCapacity';
import { InstrumentClassic } from './InstrumentClassic';
import { InstrumentRunway } from './InstrumentRunway';
import { InstrumentLanes } from './InstrumentLanes';
import { InstrumentRail } from './InstrumentRail';
import { GhostCells, useSlowNow } from './parts';

export function ActivityInstrument(props: ActivitySurfaceProps) {
  const { t } = useTranslation();
  const surface = useActivitySurface(props);
  const usage = useUsageFeed(surface.simulating);
  const rail = useRailSurface({
    feedTeams: props.feedTeams ?? [],
    onOpenSpeaker: props.onOpenSpeaker,
    filter: surface.scope,
    simulated: surface.simulatedRail,
  });
  const confirm = useQueueConfirm(surface.queueActions);
  const anyLive = surface.queueModel.running.length > 0 || props.cards.some((c) => c.runningSince !== null);
  const now = useSlowNow(anyLive);
  const { layout, queueModel } = surface;

  let body;
  if (layout === 'classic') {
    body = <InstrumentClassic surface={surface} now={now} selectedPersonaId={props.selectedPersonaId} onOpenRemote={props.onOpenRemote} />;
  } else if (surface.queueCold && queueModel.empty) {
    body = <div className="p-5"><GhostCells count={5} /></div>;
  } else if (queueModel.empty) {
    body = (
      <div className="flex flex-1 items-center justify-center p-6" data-testid="fleet-queue-empty">
        <ScenarioEmptyState icon={ListOrdered} title={t.monitor.queue_empty_title} description={t.monitor.queue_empty_hint} />
      </div>
    );
  } else if (layout === 'runway') {
    body = <InstrumentRunway surface={surface} now={now} askStart={confirm.askStart} askCancel={confirm.askCancel} />;
  } else {
    body = <InstrumentLanes surface={surface} now={now} askStart={confirm.askStart} askCancel={confirm.askCancel} />;
  }

  return (
    <div className="hud-corners hud-bloom flex h-full min-h-0 flex-col overflow-hidden rounded-card border border-primary/15 bg-background/50" data-variant="instrument">
      <InstrumentCommandBand surface={surface} />
      <InstrumentCapacity usage={usage} />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col" {...segmentedTabPanelProps(BOARD_TABS_PREFIX, layout)}>
          {body}
        </div>
        <InstrumentRail rail={rail} scope={surface.scope} onClearScope={surface.clearScope} />
      </div>

      <SessionModals
        terminal={surface.terminal}
        recap={surface.recap}
        onCloseTerminal={surface.closeTerminal}
        onCloseRecap={surface.closeRecap}
      />
      <OrchestrationPanel open={surface.orchestrationOpen} onClose={surface.closeOrchestration} />
      {usage.dialog}
      {confirm.dialog}
    </div>
  );
}

export default ActivityInstrument;
