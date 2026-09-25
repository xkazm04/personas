// CONTEST ENTRY D, "Lights-out room".
//
// The Activity surface as a machine room that runs in the dark: projects are
// chassis, personas are modules with a lamp, live sessions are units mounted
// in a rack whose size IS the parallel cap. The only light in the room is work
// in progress and whatever needs the operator's hand, so an all-idle fleet is
// a dark, calm room and trouble is visible from across it. One band of chrome
// (the console), the floor (Classic / Runway / Lanes), and the side wall
// (Supply over Intake). Every session carries its seat number everywhere.

import { memo, useMemo, useState } from 'react';
import { useActivitySurface, type ActivitySurfaceProps } from '../useActivitySurface';
import { useUsageFeed } from '../useUsageFeed';
import { useRailSurface } from '../useRailSurface';
import { useCapSetting, useQueueConfirm } from '../shared';
import { SessionModals } from '../../board/SessionModals';
import { OrchestrationPanel } from '../../orchestration';
import { RoomContext, rackIndex, type RoomContextValue } from './rackModel';
import { ConsoleBar, ConsoleFloor } from './ConsoleBar';
import { ClassicBoard } from './ClassicBoard';
import { RunwayRoom } from './RunwayRoom';
import { LanesRoom } from './LanesRoom';
import { SidePanel } from './SidePanel';
import './entryD.css';

export const ActivityEntryD = memo(function ActivityEntryD(props: ActivitySurfaceProps) {
  const surface = useActivitySurface(props);
  const usage = useUsageFeed(surface.simulating);
  const rail = useRailSurface({
    feedTeams: props.feedTeams ?? [],
    onOpenSpeaker: props.onOpenSpeaker,
    filter: surface.scope,
    simulated: surface.simulatedRail,
  });
  const cap = useCapSetting(surface.simulating);
  const confirm = useQueueConfirm(surface.queueActions);
  const [hot, setHot] = useState<string | null>(null);

  const index = useMemo(
    () => rackIndex(surface.queueModel.running, surface.queueOrder.items),
    [surface.queueModel.running, surface.queueOrder.items],
  );
  const room = useMemo<RoomContextValue>(() => ({
    ...index,
    cap: cap.cap,
    hot,
    setHot,
    openSession: surface.setTerminal,
    recapSession: surface.setRecap,
    focusKey: surface.focusKey,
    motion: !surface.reducedMotion,
  }), [index, cap.cap, hot, surface.setTerminal, surface.setRecap, surface.focusKey, surface.reducedMotion]);

  const now = usage.now;
  const { layout } = surface;

  return (
    <RoomContext.Provider value={room}>
      <div
        className="ed-root hud-atmosphere hud-corners flex h-full min-h-0 flex-col overflow-hidden rounded-card border border-border bg-background/30"
        data-testid="entry-d-root"
        data-simulated={surface.simulating || undefined}
      >
        <ConsoleBar surface={surface} cap={cap} />
        <div className="relative z-10 flex min-h-0 flex-1">
          <ConsoleFloor layout={layout} className="flex min-h-0 min-w-0 flex-1 flex-col">
            {layout === 'classic' ? (
              <ClassicBoard surface={surface} selectedPersonaId={props.selectedPersonaId} now={now} onOpenRemote={props.onOpenRemote} />
            ) : layout === 'runway' ? (
              <RunwayRoom surface={surface} confirm={confirm} now={now} />
            ) : (
              <LanesRoom surface={surface} confirm={confirm} now={now} />
            )}
          </ConsoleFloor>
          <SidePanel rail={rail} usage={usage} scope={surface.scope} onClearScope={surface.clearScope} />
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
    </RoomContext.Provider>
  );
});
