// ANNUNCIATOR - contest entry E for the Activity surface.
//
// The whole surface is one control-room panel. Every fact is a LAMP behind a
// glass window, and a lamp is lit only when its thing is doing something or
// needs the operator: idle agents are dark glass you can still read, running
// ones glow in the theme colour, the ones waiting on you glow amber, failures
// red. Calm is the default state of the panel; light is the exception.
//
// Three columns, one grammar: SUPPLY on the left (the cap as a socket rack,
// Autopilot, subscription windows as fuel strips), the BOARD in the middle
// (Classic bays, the Runway rack, the three Lanes), the DESK on the right
// (everything waiting on a human). One band of chrome above them all.

import { memo, useCallback } from 'react';
import { OrchestrationPanel } from '../../orchestration';
import { SessionModals } from '../../board/SessionModals';
import { FINAL_STAGE } from '../../useStagedMount';
import { useRailWidth } from '../../rail/useRailWidth';
import { useActivitySurface, type ActivitySurfaceProps } from '../useActivitySurface';
import { useUsageFeed } from '../useUsageFeed';
import { useRailSurface } from '../useRailSurface';
import { useCapSetting, useQueueConfirm } from '../shared';
import { CommandBar, CommandFloor } from './CommandBar';
import { SupplyDeck } from './SupplyDeck';
import { ClassicPanel } from './ClassicPanel';
import { RunwayPanel } from './RunwayPanel';
import { LanesPanel } from './LanesPanel';
import { InboxDesk } from './InboxDesk';
import './entryE.css';

function ActivityEntryEImpl(props: ActivitySurfaceProps) {
  const surface = useActivitySurface(props);
  const usage = useUsageFeed(surface.simulating);
  const width = useRailWidth();
  const rail = useRailSurface({
    feedTeams: props.feedTeams ?? [],
    onOpenSpeaker: props.onOpenSpeaker,
    filter: surface.scope,
    simulated: surface.simulatedRail,
  });
  const capSetting = useCapSetting(surface.simulating);
  const confirm = useQueueConfirm(surface.queueActions);
  const cap = surface.queueModel.cap > 0 ? surface.queueModel.cap : capSetting.cap;
  const { layout, setLayout } = surface;
  const onLayout = useCallback((v: typeof layout) => setLayout(v), [setLayout]);

  return (
    <div
      className="ae-root flex h-full min-h-0 flex-col overflow-hidden rounded-card border border-border"
      data-testid="activity-entry-e"
    >
      <CommandBar
        totals={surface.model.totals}
        showTally={!surface.cold}
        active={surface.filter.state}
        onPick={surface.pickState}
        onClear={surface.clearFilter}
        layout={layout}
        onLayout={onLayout}
        agentCount={surface.board.cards.length}
      />

      <div className="flex min-h-0 flex-1">
        <SupplyDeck
          cap={{ ...capSetting, cap }}
          running={surface.sessionsInFlight}
          overAdmitted={surface.overAdmitted}
          usage={usage}
          onOpenOrchestration={surface.openOrchestration}
        />

        <CommandFloor layout={layout} className="flex min-h-0 min-w-0 flex-1 flex-col">
          {layout === 'classic' ? (
            <ClassicPanel surface={surface} selectedPersonaId={props.selectedPersonaId} onOpenRemote={props.onOpenRemote} />
          ) : layout === 'runway' ? (
            <RunwayPanel surface={surface} cap={cap} onStart={confirm.askStart} onCancel={confirm.askCancel} />
          ) : (
            <LanesPanel surface={surface} cap={cap} onStart={confirm.askStart} onCancel={confirm.askCancel} />
          )}
        </CommandFloor>

        <InboxDesk
          rail={rail}
          width={width}
          scope={surface.scope}
          onClearScope={surface.clearScope}
          ready={surface.stage >= FINAL_STAGE}
        />
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
}

export const ActivityEntryE = memo(ActivityEntryEImpl);
