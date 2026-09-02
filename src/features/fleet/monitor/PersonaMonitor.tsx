// PersonaMonitor — the full-screen fleet monitor.
//
// The header is the ROUTER: four peer views, one click apart, no nesting.
//   Activity      — every persona as a state-coloured square (FleetGridView)
//   Timeline      — the merged cross-team transmission log (Stream)
//   Conversations — the messenger, one project at a time (ConversationBriefing)
//   Map           — the live constellation of one project (ChannelMap)
// The old two-level switching (a "Channels" mode that then nested its own
// stream/conversations/map pill) is retired: the three channel surfaces are
// top-level destinations now, and the project-columns fleet view is gone.
// A live-mode pop-up toggle sits at the right of the router. The global fleet
// pulse lives in the app chrome (see FleetActivityStrip), not here.

import { memo, useState, useMemo, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Activity, MessagesSquare, Bell, LayoutGrid, Radio, Orbit } from 'lucide-react';
import FleetActivityStrip from '@/features/shared/chrome/FleetActivityStrip';
import { RouteChunkSkeleton } from '@/features/shared/components/layout/RouteChunkSkeleton';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { useIsDarkTheme } from '@/stores/themeStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import { toastCatch } from '@/lib/silentCatch';
import { useDocumentVisibility } from '@/hooks/utility/useDocumentVisibility';
import { useMonitorData } from './useMonitorData';
import { MonitorDrawer } from './MonitorDrawer';
import { useChannelWorkspace } from './channels';
import { Stream } from './channels/Stream';
import { ConversationBriefing } from './channels/ConversationBriefing';
import { ChannelMap } from './channels/map/ChannelMap';
import { MonitorFeedStatus } from './MonitorFeedStatus';
import { FleetGridView } from './grid/FleetGridView';
import { QuickDispatchDock } from './grid/QuickDispatchDock';
import {
  buildMonitorModel,
  processStatusMeta, processStatusLabel, elapsedStr,
  type ProcessEntry, type DrawerSection,
} from './monitorModel';

interface PersonaMonitorProps {
  onClose: () => void;
}

// The strip takes no props and owns its own store subscriptions, so there is
// nothing for it to learn from a parent render — but the 1s elapsed-time tick
// below re-renders this whole component, and an unmemoized strip (233 lines of
// execution-bar work) re-rendered with it every second. memo turns the tick
// into a bail-out at this boundary.
const MemoFleetActivityStrip = memo(FleetActivityStrip);

/** The four top-level Monitor destinations. */
type MonitorView = 'activity' | 'timeline' | 'conversations' | 'map';

/**
 * Last-selected tab, remembered for the life of the session (the Monitor is a
 * header overlay that fully unmounts on close, so component state cannot carry
 * this). Deliberately module-scoped and NOT persisted — a fresh app launch
 * should land on Activity.
 */
let lastView: MonitorView = 'activity';

/** The store's deep-link vocabulary → this router's destinations. One function
 *  rather than the same ternary at the initializer and the effect, which is how
 *  a third value gets added to one of them and not the other. */
function viewForSignal(signal: 'fleet' | 'channels' | 'conversations'): MonitorView {
  if (signal === 'channels') return 'timeline';
  if (signal === 'conversations') return 'conversations';
  return 'activity';
}

interface Selection {
  personaId: string;
  section: DrawerSection;
}

export function PersonaMonitor({ onClose }: PersonaMonitorProps) {
  const { t } = useTranslation();

  // A live pop-up can deep-link straight into a Monitor destination via the
  // transient `monitorInitialView` signal. Two of the three names predate the
  // router and are left alone: 'channels' means "the merged Timeline", 'fleet'
  // means "the fleet board", which is Activity now. 'conversations' is the one
  // added deliberately — a channel message arriving as a pop-up belongs in the
  // room where you can answer it, not in the read-only merged stream, so that
  // is where the corner cards now land.
  const monitorInitialView = useSystemStore((s) => s.monitorInitialView);
  const setMonitorInitialView = useSystemStore((s) => s.setMonitorInitialView);
  const [view, setView] = useState<MonitorView>(() =>
    monitorInitialView ? viewForSignal(monitorInitialView) : lastView,
  );
  useEffect(() => {
    lastView = view;
  }, [view]);
  useEffect(() => {
    if (!monitorInitialView) return;
    setView(viewForSignal(monitorInitialView));
    setMonitorInitialView(null);
  }, [monitorInitialView, setMonitorInitialView]);

  // WHICH FEEDS THIS VIEW ACTUALLY RENDERS.
  //
  // The four header destinations are PEERS, and only Activity draws anything
  // built out of `reviews` / `unreadMessages` / `healthMap`: the grid cards, the
  // drawer over them, and the system band. Timeline, Conversations and Map draw
  // the channel surfaces and nothing else.
  //
  // This block used to read "all four feeds stay ON regardless of the active
  // view — deliberately", and justified it by "the footer's review count and the
  // header's attention badges render in every view". That footer no longer
  // exists: the legend + count line was replaced by `QuickDispatchDock` (see the
  // note above it), and the header router carries no badges. The justification
  // outlived the pixels it pointed at, so the three polls kept running for a
  // model with nothing behind it — `list_manual_reviews`, `list_reports(300)`
  // and `get_persona_summaries`, measured at 3 calls each per 60s on the live
  // app through the :17320 perf bridge.
  //
  // Its OTHER argument was real and is preserved: gating must not make a tab
  // switch feel like a cold load. It does not. The hook keeps its state across
  // the flag change, so returning to Activity paints the last-known fleet
  // immediately; `usePolling` fires a ticker the moment it re-registers, so the
  // refresh is instant rather than a cadence away; and the mount-time reads are
  // not gated at all, so `loading` still resolves on a Monitor that opens
  // straight into Timeline. Nothing here is remembered longer than it is true.
  // The app's one visibility primitive (`@/lib/documentVisibility` via
  // `useSyncExternalStore`) — the same source `PollingCoordinator` suspends its
  // cadence buckets from. Used below for the elapsed-time tick.
  const visible = useDocumentVisibility();

  const isActivityView = view === 'activity';
  const feeds = useMemo(
    () => ({ reviews: isActivityView, messages: isActivityView, personaHealth: isActivityView }),
    [isActivityView],
  );
  // `reviewsError` / `messagesError` / `healthError` / `lastRefreshed` were all
  // produced by the hook (or by its polling layer) and destructured by nobody,
  // which is why a Monitor whose reads had been failing for ten minutes still
  // rendered every tile idle-grey with no "as of" anywhere. See
  // `MonitorFeedStatus`.
  const {
    personas, healthMap, reviews, unreadMessages, activeProcesses,
    reviewsError, messagesError, healthError, lastRefreshed,
    loading, isProcessing, isReviewInFlight, handleReviewAction, handleDispatchAction,
    handleMarkRead,
  } = useMonitorData(feeds);

  const { cards, systemProcesses } = useMemo(
    () => buildMonitorModel(personas, reviews, unreadMessages, activeProcesses, healthMap),
    [personas, reviews, unreadMessages, activeProcesses, healthMap],
  );

  // The lens preset riding along with a Timeline deep-link (team/persona
  // scope). Captured once per mount, then cleared — the same transient
  // contract as monitorInitialView.
  const monitorChannelPreset = useSystemStore((s) => s.monitorChannelPreset);
  const setMonitorChannelPreset = useSystemStore((s) => s.setMonitorChannelPreset);
  const [channelPreset, setChannelPreset] = useState(monitorChannelPreset);
  useEffect(() => {
    if (!monitorChannelPreset) return;
    setChannelPreset(monitorChannelPreset);
    setMonitorChannelPreset(null);
  }, [monitorChannelPreset, setMonitorChannelPreset]);

  // Live-mode pop-ups on/off — surfaced in the header so it's always reachable.
  const liveMode = useSystemStore((s) => s.monitorLiveMode);
  const toggleLiveMode = useSystemStore((s) => s.toggleMonitorLiveMode);

  // Teams power the Activity board's grouping + the three channel surfaces.
  const teams = usePipelineStore((s) => s.teams);
  const fetchTeams = usePipelineStore((s) => s.fetchTeams);
  useEffect(() => {
    void fetchTeams();
  }, [fetchTeams]);

  // Everything the three channel surfaces share (roster, team filter, Slack
  // bridges, map drill-in). Bridges are only fetched once Conversations is up.
  const {
    workspaceTeams, bridges, toggle, allOn, setAll,
    drillCallsign, scopeToPersona, clearDrill, hasChannels,
  } = useChannelWorkspace({
    teams,
    personas,
    preset: channelPreset,
    needBridges: view === 'conversations',
  });

  // Map node click → Timeline scoped to that speaker.
  const handleDrillIn = useCallback(
    (teamId: string, personaId: string) => {
      scopeToPersona(teamId, personaId);
      setView('timeline');
    },
    [scopeToPersona],
  );

  // Tick once a second only while something is running.
  const anyRunning = useMemo(
    () => Object.values(activeProcesses).some((p) => p.status === 'running'),
    [activeProcesses],
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // `now` drives the SystemBand's elapsed times and the drawer's live timers,
    // both of which are Activity-only. The channel surfaces consume none of it,
    // so ticking there would re-render the whole workspace for nothing.
    //
    // The third condition is the window itself. This is the Monitor's only raw
    // `setInterval` — everything else runs on the PollingCoordinator, which
    // suspends on `visibilitychange` — so it was the one loop that kept
    // re-rendering the entire Monitor tree once a second behind a hidden
    // window, painting a clock nobody could see. `useDocumentVisibility` is the
    // app's single visibility primitive and reads the same store the
    // coordinator subscribes to, so the two cannot disagree about what
    // "hidden" means.
    //
    // Re-stamping `now` up front is what makes re-show honest rather than just
    // cheap: while hidden, `now` freezes at the last tick, so a window restored
    // after a minute away would render every elapsed time a minute short until
    // the next second elapsed. The effect re-runs on the false→true edge and
    // corrects it in the same commit that restarts the tick.
    if (!anyRunning || view !== 'activity' || !visible) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [anyRunning, view, visible]);

  const [selection, setSelection] = useState<Selection | null>(null);
  // Stable open handler (takes personaId) so the memoized grid squares don't
  // re-render just because an inline onSelect closure changed identity.
  const handleCardSelect = useCallback(
    (personaId: string, section: DrawerSection) => setSelection({ personaId, section }),
    [],
  );
  const selectedCard = useMemo(
    () => cards.find((c) => c.personaId === selection?.personaId) ?? null,
    [cards, selection],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // A MODAL ABOVE US OWNS ESCAPE FIRST.
      //
      // Every modal this surface can raise — the triage card, the channel
      // reply, a fleet terminal, the shared detail modals — portals to
      // `document.body`, so its Escape bubbles to `window` and lands here as
      // well as in the modal's own handler. Without this guard, one press both
      // closed the card and tore down the whole Monitor behind it: the reviewer
      // dismissed a card and lost the queue they were working. Measured, not
      // theorised — it reproduced on the first Escape after this modal landed.
      //
      // Checked against the live DOM rather than tracked as state on purpose:
      // the modals are owned by three different children (and the shared ones by
      // components this file does not import), so a flag would have to be
      // plumbed up from each of them and would go stale the moment a fourth
      // arrives. `[role="dialog"]` is what BaseModal already stamps.
      if (document.querySelector('[role="dialog"]')) return;
      if (selection) setSelection(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, onClose]);

  const selectedPersona = useMemo(
    () => personas.find((p) => p.id === selection?.personaId) ?? null,
    [personas, selection],
  );

  // Stable drawer callbacks — these were inline arrows, so every render of
  // this component (including each 1s tick) handed MonitorDrawer fresh
  // function identities. The drawer legitimately re-renders on `now` while
  // something runs, but when the fleet is idle these were the only unstable
  // props left.
  // Both writers RETURN the promise (they used to `void` it): the drawer's
  // AsyncButton awaits it to keep the pressed control busy, and the `.catch`
  // is what turns a rejected write into a toast rather than a silent no-op.
  const handleDrawerReviewAction = useCallback(
    (id: string, status: Parameters<typeof handleReviewAction>[1], notes?: string) =>
      handleReviewAction(id, status, notes).catch(
        toastCatch('PersonaMonitor:handleReviewAction'),
      ),
    [handleReviewAction],
  );
  const handleDrawerDispatchAction = useCallback(
    (id: string, action: string) =>
      handleDispatchAction(id, action).catch(
        toastCatch('PersonaMonitor:handleDispatchAction'),
      ),
    [handleDispatchAction],
  );
  const handleDrawerMarkRead = useCallback(
    (id: string) => void handleMarkRead(id),
    [handleMarkRead],
  );
  const closeDrawer = useCallback(() => setSelection(null), []);

  // The header router. Each destination keeps the icon its own surface header
  // uses, so the tab and the view it opens read as the same thing.
  const VIEWS: Array<{ id: MonitorView; label: string; hint: string; icon: typeof LayoutGrid }> = [
    { id: 'activity', label: t.monitor.activity_mode, hint: t.monitor.activity_mode_title, icon: LayoutGrid },
    { id: 'timeline', label: t.monitor.channels_layout_timeline, hint: t.monitor.channels_layout_timeline_hint, icon: Radio },
    { id: 'conversations', label: t.monitor.channels_layout_grid, hint: t.monitor.channels_layout_grid_hint, icon: MessagesSquare },
    { id: 'map', label: t.monitor.channels_layout_map, hint: t.monitor.channels_layout_map_hint, icon: Orbit },
  ];
  const selectView = useCallback(
    (next: MonitorView) => {
      // Only the map's node click should carry a callsign into the Timeline.
      clearDrill();
      setView(next);
    },
    [clearDrill],
  );

  // Faint network-of-agents backdrop — dark mode only (the light-theme
  // alternative is a follow-up). Rendered behind everything at low opacity so
  // it reads as premium texture, not a competing foreground.
  const isDark = useIsDarkTheme();

  const channelEmpty = (
    <div className="h-full flex flex-col items-center justify-center gap-2 text-center text-foreground">
      <MessagesSquare className="w-8 h-8 text-foreground" />
      <span className="typo-body">{t.monitor.channels_no_teams}</span>
    </div>
  );

  // The overlay is fully opaque (was bg-background/98 + backdrop-blur-xl): the
  // blur was invisible at 98% opacity but forced the GPU to re-composite the
  // whole app underneath every frame. A full-screen opaque overlay that
  // occludes the layers below lets the browser skip painting them entirely.
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      className="fixed inset-x-0 bottom-0 top-[var(--titlebar-height,40px)] z-50 bg-background flex flex-col"
      data-testid="persona-monitor"
    >
      {/* Faint interconnected-agents backdrop (dark mode only). */}
      {isDark && (
        <img
          aria-hidden
          src="/illustrations/monitor-network-dark.png"
          alt=""
          draggable={false}
          className="pointer-events-none absolute inset-0 z-0 h-full w-full object-cover opacity-[0.07]"
        />
      )}

      {/* Header (z-20 so any floating child menu clears the body) */}
      <div className="relative z-20 flex-shrink-0 flex items-center justify-between gap-4 px-6 h-14 border-b border-primary/10 bg-secondary/15">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-modal bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Activity className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h2 className="typo-heading-lg text-foreground leading-tight">{t.monitor.title}</h2>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* The router: four peer destinations. */}
          <div className="flex items-center gap-1" role="group" data-testid="monitor-view-tabs">
            {VIEWS.map((v) => {
              const Icon = v.icon;
              const on = view === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => selectView(v.id)}
                  aria-pressed={on}
                  title={v.hint}
                  data-testid={`monitor-view-${v.id}`}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border typo-body-lg transition-colors ${
                    on
                      ? 'border-primary/45 bg-primary/15 text-primary'
                      : 'border-primary/15 bg-secondary/20 text-foreground hover:bg-secondary/30'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  {v.label}
                </button>
              );
            })}
          </div>
          {/* Live-mode pop-ups on/off — icon-only, always reachable here. */}
          <button
            type="button"
            onClick={toggleLiveMode}
            aria-pressed={liveMode}
            aria-label={t.monitor.live_toggle}
            title={t.monitor.live_toggle_hint}
            className={`ml-1 inline-flex items-center justify-center p-1.5 rounded-full border transition-colors ${
              liveMode
                ? 'border-status-success/40 bg-status-success/15 text-status-success'
                : 'border-primary/15 bg-secondary/20 text-foreground hover:bg-secondary/30'
            }`}
          >
            <Bell className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-modal border border-primary/15 text-foreground hover:text-foreground hover:bg-secondary/30 transition-colors"
            aria-label={t.monitor.close}
            title={t.monitor.close_hint}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Live fleet pulse — the same executions bar shown under the titlebar
          (reused), so running/queued executions are visible right in the header
          instead of static count badges. */}
      <div className="relative flex-shrink-0 h-2.5 border-b border-primary/10">
        <MemoFleetActivityStrip />
      </div>

      {/* System band — app-level activity with no persona. It belongs above the
          Activity board (the fleet read); the channel surfaces own their full
          height and carry no persona-less work. */}
      {view === 'activity' && <SystemBand processes={systemProcesses} now={now} />}

      {/* A failed feed says so here, above a board that keeps whatever it last
          knew. Renders nothing when all three answered. */}
      {view === 'activity' && (
        <MonitorFeedStatus
          reviewsError={reviewsError}
          messagesError={messagesError}
          healthError={healthError}
          lastRefreshed={lastRefreshed}
        />
      )}

      {view === 'activity' ? (
        /* Body — the fleet board with the drawer layered over it */
        <div className="relative z-10 flex-1 min-h-0 overflow-hidden">
          {/* Same wrapper the three channel surfaces get — the Activity board is
              a card on the HUD atmosphere now, not a bare grid on the page
              background (see FleetGridView's consolidation header).

              TWO elements, not one, and that is load-bearing: `.hud-atmosphere`
              declares `position: relative` in globals.css, which is UNLAYERED
              and therefore beats Tailwind's `@layer utilities` `absolute` no
              matter the class order. Putting both on one div silently demoted
              the wrapper to `relative`, nothing bounded the board's height, and
              the columns grew to 10,505px inside a 975px overlay. Same trap as
              `typo-* font-semibold` — an unlayered rule quietly winning. */}
          <div className="absolute inset-0 overflow-hidden">
            <div className="h-full p-2 hud-atmosphere">
            {loading && cards.length === 0 ? (
              // First-ever cold open only (the warm cache in useMonitorData makes
              // every re-open paint the last-known fleet immediately): permanent
              // chrome above stays, and the body shows the shared delayed ghost
              // instead of the view's settled empty state — "all clear" before
              // the first read lands would be an empty-flash lie (law 1 / law 3).
              <RouteChunkSkeleton showIcon showActions={false} />
            ) : (
              <FleetGridView
                cards={cards}
                personas={personas}
                teams={teams}
                selectedPersonaId={selection?.personaId ?? null}
                onSelect={handleCardSelect}
                feedTeams={workspaceTeams}
                onOpenSpeaker={handleDrillIn}
              />
            )}
            </div>
          </div>

          <AnimatePresence>
            {selectedCard && selection && (
              <>
                <motion.div
                  key="backdrop"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.16 }}
                  onClick={() => setSelection(null)}
                  className="absolute inset-0 z-10 bg-background/55 backdrop-blur-sm"
                />
                <motion.div
                  key="drawer"
                  initial={{ y: '-100%' }}
                  animate={{ y: 0 }}
                  exit={{ y: '-100%' }}
                  transition={{ type: 'spring', stiffness: 300, damping: 34 }}
                  className="absolute inset-x-0 top-0 z-20 max-h-full flex flex-col rounded-b-modal border-b border-x border-primary/15 bg-background shadow-elevation-4"
                >
                  <MonitorDrawer
                    card={selectedCard}
                    initialSection={selection.section}
                    designContext={selectedPersona?.design_context ?? null}
                    isProcessing={isProcessing}
                    isReviewInFlight={isReviewInFlight}
                    now={now}
                    onReviewAction={handleDrawerReviewAction}
                    onDispatchAction={handleDrawerDispatchAction}
                    onMarkRead={handleDrawerMarkRead}
                    onClose={closeDrawer}
                  />
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      ) : (
        <div className="relative z-10 flex-1 min-h-0">
          <div className="h-full p-2 hud-atmosphere">
            {!hasChannels ? (
              channelEmpty
            ) : view === 'timeline' ? (
              <Stream
                teams={workspaceTeams}
                onToggle={toggle}
                allOn={allOn}
                onSetAll={setAll}
                initialCallsign={drillCallsign}
              />
            ) : view === 'map' ? (
              <ChannelMap teams={workspaceTeams} onDrillIn={handleDrillIn} />
            ) : (
              <ConversationBriefing teams={workspaceTeams} personas={personas} bridges={bridges} />
            )}
          </div>
        </div>
      )}

      {/* THE COMMAND CONSOLE, where the footer's legend + count line used to be.
          Both of those were passive restatements of things already on screen —
          the legend of a colour key that now lives in the Activity header, the
          counts of numbers the rail tabs badge. The footer strip is better spent
          on the one thing no Monitor view could do: start work. It sits at
          Monitor level rather than inside the Activity card so it is reachable
          from the Timeline, Conversations and the Map too. */}
      <QuickDispatchDock />
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// System band
// ---------------------------------------------------------------------------

function SystemBand({ processes, now }: { processes: ProcessEntry[]; now: number }) {
  const { t } = useTranslation();
  if (processes.length === 0) return null;
  return (
    <div className="relative z-10 flex-shrink-0 flex items-center gap-2 px-5 py-2 border-b border-primary/8 bg-secondary/12 overflow-x-auto">
      <span className="flex-shrink-0 flex items-center gap-1.5 typo-caption uppercase tracking-wider text-foreground">
        <Activity className="w-3 h-3" /> {t.monitor.system}
      </span>
      {processes.map(({ key, proc }) => {
        const M = processStatusMeta(proc.status);
        return (
          <span
            key={key}
            className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/12 bg-background/60 typo-caption"
            title={proc.lastEvent ?? proc.domain}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${M.dot} ${M.pulse ? 'animate-pulse' : ''}`} />
            <span className="text-foreground max-w-[160px] truncate">{proc.label ?? proc.domain}</span>
            <span className={M.text}>
              {proc.status === 'running' ? elapsedStr(proc.startedAt, now) : processStatusLabel(t, proc.status)}
            </span>
          </span>
        );
      })}
    </div>
  );
}

export default PersonaMonitor;
