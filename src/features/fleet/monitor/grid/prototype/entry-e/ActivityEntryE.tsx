// ANNUNCIATOR - the Activity surface.
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
// (everything waiting on a human). One band of chrome above them all, and
// under it the notepad of workspaces the board below is a sheet of.
//
// CONSOLIDATED 2026-10-04. This is now the Activity surface itself, not one
// of three variants behind a switcher. It is the Annunciator with the two
// ideas the Plate variant was kept alive for folded in: the WORKSPACE LAYER
// (`WorkspaceTabs` over `useWorkspaceScope` — Plate's second screen reduced to
// a row of index tabs that narrow the board in place) and the DOCKED DESK
// (`DecisionDock` — the decision rail resting as three figures and widening
// into the list, instead of holding a column open all session). The baseline
// grid and the Plate layers are gone; `prototype/` keeps its name until the
// files are moved, which is a rename pass and not a design one.
//
// THE COLD OPEN IS CHOREOGRAPHED (WP2). This file is now a light SHELL with
// three holes in it, and the holes are the surface's whole weight: the board
// panel, the desk (`DeskSlot`, which carries `useRailSurface`) and the usage
// plates (`UsageSlot`, which carries `useUsageFeed`). All three are behind
// `lazyRetry` in `activityLazy`, preloaded on the shell's first commit, and
// admitted one beat at a time by `useActivityEntrance` — chrome, tiles, rail,
// usage. The frame is complete before any of them arrive (`SlotGhosts`), so
// nothing reflows and no Suspense fallback is ever distinguishable from what
// was already on screen.
//
// THREE MECHANISMS, THREE JOBS, DELIBERATELY NOT MERGED:
//   `useStagedMount` — when a heavy subtree MOUNTS (rAF, inside the panels).
//   `useActivityEntrance` — when a REGION is admitted (the four coarse beats).
//   `useProgressiveReveal` + `RevealItem` — when an ITEM inside a region
//     enters (the dock's three figures, the usage column's provider plates).

import { memo, Suspense, useCallback, useEffect, useState } from 'react';
import type { PersonaCardModel } from '../../../monitorModel';
import { FINAL_STAGE } from '../../useStagedMount';
import { BEAT, useActivityEntrance } from '../../useActivityEntrance';
import { useActivitySurface, type ActivitySurfaceProps } from '../useActivitySurface';
import { useCapSetting, useQueueConfirm } from '../shared';
import { CommandBar, CommandFloor } from './CommandBar';
import { SessionMenuProvider } from './SessionMenu';
import { PersonaMenuProvider } from './PersonaMenu';
import { usePanelFilter } from './boardFilter';
import { useWorkspaceScope } from './workspaceScope';
import { WorkspaceSheet, WorkspaceTabs } from './WorkspaceTabs';
import { SupplyDeck } from './SupplyDeck';
import { BayGhosts } from './Ghosts';
import { DeskGhost, UsageGhost } from './SlotGhosts';
import {
  LazyClassicPanel,
  LazyDeskSlot,
  LazyLanesPanel,
  LazyOrchestrationPanel,
  LazyQuickChatComposer,
  LazySessionModals,
  LazyUsageSlot,
  preloadActivityPanels,
} from './activityLazy';
import './entryE.css';

/** Stable empty default — a fresh `[]` per render would re-run the desk's feeds. */
const EMPTY_FEED_TEAMS: NonNullable<ActivitySurfaceProps['feedTeams']> = [];

function ActivityEntryEImpl(props: ActivitySurfaceProps) {
  const surface = useActivitySurface(props);
  const entrance = useActivityEntrance();
  // The three choreographed chunks start fetching on the shell's first commit,
  // so the beat that admits one is almost never the thing that waits for it.
  useEffect(preloadActivityPanels, []);
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
  const ready = surface.stage >= FINAL_STAGE;

  const board = layout === 'classic' ? (
    <LazyClassicPanel surface={surface} filter={filter} workspaces={workspaces} selectedPersonaId={props.selectedPersonaId} onOpenRemote={props.onOpenRemote} onClearFilter={surface.clearFilter} />
  ) : (
    <LazyLanesPanel surface={surface} filter={filter} workspaces={workspaces} cap={cap} onStart={confirm.askStart} onCancel={confirm.askCancel} />
  );

  return (
    <div
      className="ae-root flex h-full min-h-0 flex-col overflow-hidden rounded-card border border-border"
      data-testid="activity-entry-e"
      data-beat={entrance.beat}
    >
      <CommandBar
        filter={filter}
        showTally={!surface.cold}
        active={surface.filter.state}
        onPick={surface.pickState}
        onClear={surface.clearFilter}
        layout={layout}
        onLayout={onLayout}
      />
      <WorkspaceTabs scope={workspaces} />

      <div className="flex min-h-0 flex-1">
        <SupplyDeck
          cap={{ ...capSetting, cap }}
          running={surface.sessionsInFlight}
          overAdmitted={surface.overAdmitted}
          onOpenOrchestration={surface.openOrchestration}
          usageSlot={entrance.beat >= BEAT.usage ? (
            <Suspense fallback={<UsageGhost />}>
              <LazyUsageSlot simulating={surface.simulating} warm={entrance.warm} />
            </Suspense>
          ) : <UsageGhost />}
        />

        <WorkspaceSheet scope={workspaces} className="flex min-h-0 min-w-0 flex-1 flex-col">
          <CommandFloor layout={layout} className="flex min-h-0 min-w-0 flex-1 flex-col">
            <SessionMenuProvider onOpenTerminal={surface.setTerminal} onOpenRecap={surface.setRecap}>
              <PersonaMenuProvider onQuickChat={setQuickChat}>
                {entrance.beat >= BEAT.tiles ? (
                  <Suspense fallback={<BayGhosts />}>{board}</Suspense>
                ) : <BayGhosts />}
              </PersonaMenuProvider>
            </SessionMenuProvider>
          </CommandFloor>
        </WorkspaceSheet>

        {entrance.beat >= BEAT.rail ? (
          <Suspense fallback={<DeskGhost />}>
            <LazyDeskSlot
              feedTeams={props.feedTeams ?? EMPTY_FEED_TEAMS}
              onOpenSpeaker={props.onOpenSpeaker}
              scope={surface.scope}
              onClearScope={surface.clearScope}
              simulatedRail={surface.simulatedRail}
              ready={ready}
              reducedMotion={surface.reducedMotion}
            />
          </Suspense>
        ) : <DeskGhost />}
      </div>

      {(surface.terminal || surface.recap) && (
        <Suspense fallback={null}>
          <LazySessionModals
            terminal={surface.terminal}
            recap={surface.recap}
            onCloseTerminal={surface.closeTerminal}
            onCloseRecap={surface.closeRecap}
          />
        </Suspense>
      )}
      {surface.orchestrationOpen && (
        <Suspense fallback={null}>
          <LazyOrchestrationPanel open onClose={surface.closeOrchestration} />
        </Suspense>
      )}
      {quickChat && (
        <Suspense fallback={null}>
          <LazyQuickChatComposer card={quickChat} onClose={closeQuickChat} />
        </Suspense>
      )}
      {confirm.dialog}
    </div>
  );
}

export const ActivityEntryE = memo(ActivityEntryEImpl);
