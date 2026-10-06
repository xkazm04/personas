// ANNUNCIATOR - contest entry E for the Activity surface.
//
// The whole surface is one control-room panel. Every fact is a LAMP behind a
// glass window, and a lamp is lit only when its thing is doing something or
// needs the operator: idle agents are dark glass you can still read, running
// ones glow in the theme colour, the ones waiting on you glow amber, failures
// red. Calm is the default state of the panel; light is the exception.
//
// Two columns, one grammar: SUPPLY on the left (the cap as a socket rack,
// Autopilot, subscription windows as fuel strips) and the BOARD (Classic bays,
// the Runway rack, the three Lanes). One band of chrome above them, carrying
// the Decision Center's strip (everything waiting on a human), and under it
// the notepad of workspaces the board below is a sheet of.
//
// CONSOLIDATED 2026-10-04. This is now the Activity surface itself, not one
// of three variants behind a switcher. It is the Annunciator with the two
// ideas the Plate variant was kept alive for folded in: the WORKSPACE LAYER
// (`WorkspaceTabs` over `useWorkspaceScope` — Plate's second screen reduced to
// a row of index tabs that narrow the board in place) and the DOCKED DESK
// (`DecisionDock`, since retired - see below). The baseline
// grid and the Plate layers are gone; `prototype/` keeps its name until the
// files are moved, which is a rename pass and not a design one.
//
// THE DOCKED DESK IS RETIRED (2026-10-06, decision-center spark A3). Its three
// feeds became the Decision Center roster, its figures became the strip's
// chips in the band above (`CommandBar` → `DecisionHub`), and an opened row
// now opens in its own surface. The board gets the full width back.

import { memo, useCallback, useState } from 'react';
import type { PersonaCardModel } from '../../../monitorModel';
import { OrchestrationPanel } from '../../orchestration';
import { SessionModals } from '../../board/SessionModals';
import { useActivitySurface, type ActivitySurfaceProps } from '../useActivitySurface';
import { useUsageFeed } from '../useUsageFeed';
import { useCapSetting, useQueueConfirm } from '../shared';
import { CommandBar, CommandFloor } from './CommandBar';
import { SessionMenuProvider } from './SessionMenu';
import { PersonaMenuProvider } from './PersonaMenu';
import { QuickChatComposer } from './QuickChatComposer';
import { usePanelFilter } from './boardFilter';
import { useWorkspaceScope } from './workspaceScope';
import { WorkspaceSheet, WorkspaceTabs } from './WorkspaceTabs';
import { SupplyDeck } from './SupplyDeck';
import { ClassicPanel } from './ClassicPanel';
import { LanesPanel } from './LanesPanel';
import './entryE.css';

function ActivityEntryEImpl(props: ActivitySurfaceProps) {
  const surface = useActivitySurface(props);
  const usage = useUsageFeed(surface.simulating);
  // The quick-chat seam the persona menu exposes. The composer is anchored to
  // the persona's own line, so the board it was opened from stays readable.
  const [quickChat, setQuickChat] = useState<PersonaCardModel | null>(null);
  const closeQuickChat = useCallback(() => setQuickChat(null), []);
  const capSetting = useCapSetting(surface.simulating);
  const confirm = useQueueConfirm(surface.queueActions);
  const cap = surface.queueModel.cap > 0 ? surface.queueModel.cap : capSetting.cap;
  const { layout, setLayout } = surface;
  const onLayout = useCallback((v: typeof layout) => setLayout(v), [setLayout]);
  const filter = usePanelFilter(surface);
  const workspaces = useWorkspaceScope(surface);

  return (
    <div
      className="ae-root flex h-full min-h-0 flex-col overflow-hidden rounded-card border border-border"
      data-testid="activity-entry-e"
    >
      <CommandBar
        filter={filter}
        showTally={!surface.cold}
        active={surface.filter.state}
        onPick={surface.pickState}
        onClear={surface.clearFilter}
        layout={layout}
        onLayout={onLayout}
        feedTeams={props.feedTeams}
      />
      <WorkspaceTabs scope={workspaces} />

      <div className="flex min-h-0 flex-1">
        <SupplyDeck
          cap={{ ...capSetting, cap }}
          running={surface.sessionsInFlight}
          overAdmitted={surface.overAdmitted}
          usage={usage}
          onOpenOrchestration={surface.openOrchestration}
        />

        <WorkspaceSheet scope={workspaces} className="flex min-h-0 min-w-0 flex-1 flex-col">
          <CommandFloor layout={layout} className="flex min-h-0 min-w-0 flex-1 flex-col">
            <SessionMenuProvider onOpenTerminal={surface.setTerminal} onOpenRecap={surface.setRecap}>
              <PersonaMenuProvider onQuickChat={setQuickChat}>
                {layout === 'classic' ? (
                  <ClassicPanel surface={surface} filter={filter} workspaces={workspaces} selectedPersonaId={props.selectedPersonaId} onOpenRemote={props.onOpenRemote} onClearFilter={surface.clearFilter} />
                ) : (
                  <LanesPanel surface={surface} filter={filter} workspaces={workspaces} cap={cap} onStart={confirm.askStart} onCancel={confirm.askCancel} />
                )}
              </PersonaMenuProvider>
            </SessionMenuProvider>
          </CommandFloor>
        </WorkspaceSheet>
      </div>

      <SessionModals
        terminal={surface.terminal}
        recap={surface.recap}
        onCloseTerminal={surface.closeTerminal}
        onCloseRecap={surface.closeRecap}
      />
      <OrchestrationPanel open={surface.orchestrationOpen} onClose={surface.closeOrchestration} />
      {usage.dialog}
      <QuickChatComposer card={quickChat} onClose={closeQuickChat} />
      {confirm.dialog}
    </div>
  );
}

export const ActivityEntryE = memo(ActivityEntryEImpl);
