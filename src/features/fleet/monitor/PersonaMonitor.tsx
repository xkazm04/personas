// PersonaMonitor — the full-screen fleet monitor.
//
// The header is the ROUTER: four peer views, one click apart, no nesting.
//   Activity      — every persona as a state-coloured square (FleetGridView)
//   Blueprint     — every lens-scan product; a tile opens its blueprint (BlueprintPicker)
//   Conversations — the messenger, one project at a time (ConversationBriefing)
//   Map           — the live constellation of one project (ChannelMap)
// The old two-level switching (a "Channels" mode that then nested its own
// stream/conversations/map pill) is retired: the channel surfaces are
// top-level destinations now, and the project-columns fleet view is gone.
//
// TWO VIEWS LEFT ON 2026-10-06. The Board — the whole fleet as one full-frame
// picture — is DELETED: Activity answers the same question and the operator
// kept one of them. Its shared vocabulary (the four piles, the tile skin, the
// need glyph) was not board-only and lives on at `grid/skin/`. The Timeline —
// the merged cross-team transmission log — MOVED OUT, to Overview > Monitoring
// > Timeline (`features/overview/sub_timeline/`), where a read-only log
// belongs beside Activity and Events. See `useMonitorChannels` for what the
// Map's node click does now that its destination is on another surface.
// A live-mode pop-up toggle sits at the right of the router. The global fleet
// pulse lives in the app chrome (see FleetActivityStrip), not here.
//
// THIS FILE IS THE FRAME (split 2026-10-16, from 835 lines). Everything it
// composes lives in `shell/`: the router (`monitorRouter`), the overlay
// suspension, the feeds and card model, the channel workspace, the drawers'
// selection, Escape, the elapsed-time tick, the header and the body.

import { memo, Suspense } from 'react';
import { motion } from 'framer-motion';
import FleetActivityStrip from '@/features/shared/chrome/FleetActivityStrip';
import { lazyRetry } from '@/lib/lazyRetry';
import { MonitorVisibilityContext } from './monitorVisibility';
import { MonitorDataProvider } from './monitorDataContext';
import { MonitorFeedStatus } from './MonitorFeedStatus';
import { useMonitorRouter } from './shell/monitorRouter';
import { useOverlaySuspension } from './shell/useOverlaySuspension';
import { useMonitorFeeds } from './shell/useMonitorFeeds';
import { useMonitorChannels } from './shell/useMonitorChannels';
import { useMonitorSelection } from './shell/useMonitorSelection';
import { useMonitorEscape } from './shell/useMonitorEscape';
import { useElapsedTick } from './shell/useElapsedTick';
import { MonitorHeader } from './shell/MonitorHeader';
import { MonitorBody } from './shell/MonitorBody';
import { SystemBand } from './shell/SystemBand';
import { DockPlaceholder } from './shell/fallbacks';

// The dispatch dock (117 modules) is its own chunk; see MonitorBody for the
// chunk boundaries.
const QuickDispatchDock = lazyRetry(() => import('./grid/QuickDispatchDock'));

interface PersonaMonitorProps {
  onClose: () => void;
  /**
   * Is the overlay on screen? The Monitor is mounted once per app session and
   * hidden rather than torn down (see `monitorVisibility.ts` and
   * `useOverlaySuspension`), so this is the only thing that moves when the
   * operator opens or closes it. Defaults to `true` for the standalone mounts
   * that have no owner to drive it (tests, the dev-only grid overlay).
   */
  visible?: boolean;
}

// The strip takes no props and owns its own store subscriptions, so there is
// nothing for it to learn from a parent render — but the 1s elapsed-time tick
// re-renders this whole component, and an unmemoized strip (233 lines of
// execution-bar work) re-rendered with it every second. memo turns the tick
// into a bail-out at this boundary.
const MemoFleetActivityStrip = memo(FleetActivityStrip);

export function PersonaMonitor({ onClose, visible = true }: PersonaMonitorProps) {
  const hidden = useOverlaySuspension(visible);
  const { view, activeTab, goToView } = useMonitorRouter();
  const isFleetView = view === 'activity';

  // `reviewsError` / `messagesError` / `healthError` / `lastRefreshed` were all
  // produced by the hook (or by its polling layer) and destructured by nobody,
  // which is why a Monitor whose reads had been failing for ten minutes still
  // rendered every tile idle-grey with no "as of" anywhere. See
  // `MonitorFeedStatus`.
  const { monitorData, cards, systemProcesses } = useMonitorFeeds(isFleetView);
  const { personas, activeProcesses, reviewsError, messagesError, healthError, lastRefreshed } = monitorData;

  const { teams, workspaceTeams, bridges, hasChannels, channelPreset, handleDrillIn } =
    useMonitorChannels(view, personas);
  const now = useElapsedTick(activeProcesses, isFleetView, visible);
  const selection = useMonitorSelection(cards, personas);
  useMonitorEscape({ visible, back: selection.back, onClose });

  // The overlay is fully opaque (was bg-background/98 + backdrop-blur-xl): the
  // blur was invisible at 98% opacity but forced the GPU to re-composite the
  // whole app underneath every frame. A full-screen opaque overlay that
  // occludes the layers below lets the browser skip painting them entirely.
  return (
    /* The signal the whole subtree gates its own cost on. See
       `monitorVisibility.ts` for why this is a context and not a store read,
       and why its default is `true`. It carries the PROP, not `!hidden`: the
       160ms of exit fade is time nobody is reading, so a poll that stops at
       the start of the fade rather than at the end of it stops at the right
       moment. */
    <MonitorVisibilityContext.Provider value={visible}>
      <MonitorDataProvider data={monitorData}>
        <motion.div
          /* The enter/exit fade used to come from `AnimatePresence` in
             `TrayOverlays`, which could only play it by mounting and unmounting
             this tree. There is no unmount left, so the same 0.16s fade is driven
             off `visible` instead — identical to the eye, and now reversible
             mid-flight (closing during the entrance fades back out from wherever
             it got to, instead of snapping). */
          initial={{ opacity: 0 }}
          animate={{ opacity: visible ? 1 : 0 }}
          transition={{ duration: 0.16 }}
          inert={hidden || undefined}
          className={`fixed inset-x-0 bottom-0 top-[var(--titlebar-height,40px)] z-50 bg-background flex flex-col${
            hidden ? ' invisible pointer-events-none [content-visibility:hidden]' : ''
          }`}
          data-testid="persona-monitor"
          data-hidden={hidden || undefined}
        >
          {/* The Monitor's surface: one dot grid over one tonal field, behind
              every tab, in every theme (`.monitor-surface` in globals.css). It
              replaced a dark-only raster backdrop and a per-tab hairline grid,
              so the tabs no longer each paint their own ground. */}
          <div aria-hidden className="monitor-surface" />

          <MonitorHeader activeTab={activeTab} onSelect={goToView} onClose={onClose} />

          {/* Live fleet pulse — the same executions bar shown under the titlebar
              (reused), so running/queued executions are visible right in the header
              instead of static count badges. */}
          <div className="relative flex-shrink-0 h-2.5 border-b border-primary/10">
            <MemoFleetActivityStrip />
          </div>

          {isFleetView && <SystemBand processes={systemProcesses} now={now} />}

          {/* A failed feed says so here, above a board that keeps whatever it last
              knew. Renders nothing when all three answered. */}
          {isFleetView && (
            <MonitorFeedStatus
              reviewsError={reviewsError}
              messagesError={messagesError}
              healthError={healthError}
              lastRefreshed={lastRefreshed}
            />
          )}

          <MonitorBody
            view={view}
            activity={{
              data: monitorData, cards, personas, teams, feedTeams: workspaceTeams,
              selection, now, onOpenSpeaker: handleDrillIn,
            }}
            hasChannels={hasChannels}
            bridges={bridges}
            channelPreset={channelPreset}
          />

          {/* THE COMMAND CONSOLE, where the footer's legend + count line used to be.
              Both of those were passive restatements of things already on screen —
              the legend of a colour key that now lives in the Activity header, the
              counts of numbers the rail tabs badge. The footer strip is better spent
              on the one thing no Monitor view could do: start work. It sits at
              Monitor level rather than inside the Activity card so it is reachable
              from every tab. */}
          <Suspense fallback={<DockPlaceholder />}>
            <QuickDispatchDock />
          </Suspense>
        </motion.div>
      </MonitorDataProvider>
    </MonitorVisibilityContext.Provider>
  );
}

export default PersonaMonitor;
