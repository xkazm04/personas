// VARIANT B — "Atelier". PROTOTYPE.
//
// Metaphor: a calm studio, not a cockpit. Soft material surfaces instead of
// hairlines and boxes-in-boxes; avatars and words instead of glyph rows; colour
// reserved for state (a dot, a ring) and the one primary accent. The chrome is
// ONE quiet header row (the fleet read as a sentence of filter pills, then
// Capacity · Autopilot · Layout), a shelf of plan cards, the board, and an
// Inbox surface on the right. Same data and verbs as the baseline, via the
// prototype seams (`useActivitySurface`, `useUsageFeed`, `useRailSurface`).

import { memo } from 'react';
import { ListOrdered } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { segmentedTabPanelProps } from '@/features/shared/components/layout/SegmentedTabs';
import { BOARD_TABS_PREFIX } from '../../board/GridHeader';
import { SessionModals } from '../../board/SessionModals';
import { OrchestrationPanel } from '../../orchestration';
import { useActivitySurface, type ActivitySurfaceProps } from '../useActivitySurface';
import { useUsageFeed } from '../useUsageFeed';
import { useRailSurface } from '../useRailSurface';
import { useQueueConfirm } from '../shared';
import { AtelierHeader } from './AtelierHeader';
import { AtelierPlans } from './AtelierPlans';
import { AtelierClassic } from './AtelierClassic';
import { AtelierRunway } from './AtelierRunway';
import { AtelierLanes } from './AtelierLanes';
import { AtelierInbox } from './AtelierInbox';
import { GhostBlock, useTick } from './parts';

function AtelierImpl(props: ActivitySurfaceProps) {
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
  const now = useTick();
  const { layout, queueModel } = surface;

  let body;
  if (layout === 'classic') {
    body = <AtelierClassic surface={surface} selectedPersonaId={props.selectedPersonaId} now={now} onOpenRemote={props.onOpenRemote} />;
  } else if (surface.queueCold && queueModel.empty) {
    body = (
      <div className="flex flex-col gap-2 p-4" aria-hidden data-testid="fleet-queue-ghost">
        {[68, 68, 52, 52, 52].map((h, i) => <GhostBlock key={i} height={h} />)}
      </div>
    );
  } else if (queueModel.empty) {
    body = (
      <div className="flex flex-1 items-center justify-center p-6" data-testid="fleet-queue-empty">
        <ScenarioEmptyState icon={ListOrdered} title={t.monitor.queue_empty_title} description={t.monitor.queue_empty_hint} />
      </div>
    );
  } else if (layout === 'runway') {
    body = <AtelierRunway surface={surface} now={now} askStart={confirm.askStart} askCancel={confirm.askCancel} />;
  } else {
    body = <AtelierLanes surface={surface} now={now} askStart={confirm.askStart} askCancel={confirm.askCancel} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-modal bg-background/70 shadow-elevation-2" data-variant="atelier">
      <AtelierHeader surface={surface} />
      <AtelierPlans usage={usage} />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col" {...segmentedTabPanelProps(BOARD_TABS_PREFIX, layout)}>
          {body}
        </div>
        <AtelierInbox rail={rail} scope={surface.scope} onClearScope={surface.clearScope} />
      </div>

      <SessionModals
        terminal={surface.terminal}
        recap={surface.recap}
        onCloseTerminal={surface.closeTerminal}
        onCloseRecap={surface.closeRecap}
      />
      <OrchestrationPanel open={surface.orchestrationOpen} onClose={surface.closeOrchestration} />
      {confirm.dialog}
    </div>
  );
}

export const ActivityAtelier = memo(AtelierImpl);
export default ActivityAtelier;
