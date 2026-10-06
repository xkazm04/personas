// PersonaMonitor — the full-screen fleet monitor.
//
// The header is the ROUTER: four peer views, one click apart, no nesting.
//   Activity      — every persona as a state-coloured square (FleetGridView)
//   Timeline      — the merged cross-team transmission log (Stream)
//   Conversations — the messenger, one project at a time (ConversationBriefing)
//   Map           — the live constellation of one project (ChannelMap)
//   Board         — the whole fleet as one full-frame picture (fleetboard/)
// The old two-level switching (a "Channels" mode that then nested its own
// stream/conversations/map pill) is retired: the three channel surfaces are
// top-level destinations now, and the project-columns fleet view is gone.
// A live-mode pop-up toggle sits at the right of the router. The global fleet
// pulse lives in the app chrome (see FleetActivityStrip), not here.

import { memo, Suspense, useState, useMemo, useEffect, useCallback, startTransition } from 'react';
import { motion } from 'framer-motion';
import { X, Activity, MessagesSquare, Bell, LayoutGrid, LayoutDashboard, Radio, Orbit } from 'lucide-react';
import FleetActivityStrip from '@/features/shared/chrome/FleetActivityStrip';
import { RouteChunkSkeleton } from '@/features/shared/components/layout/RouteChunkSkeleton';
import { lazyRetry } from '@/lib/lazyRetry';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { useIsDarkTheme } from '@/stores/themeStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import { toastCatch } from '@/lib/silentCatch';
import { useDocumentVisibility } from '@/hooks/utility/useDocumentVisibility';
import { useMonitorData } from './useMonitorData';
import { MonitorVisibilityContext } from './monitorVisibility';
import { useChannelWorkspace } from './channels';
import { MonitorFeedStatus } from './MonitorFeedStatus';
import { MonitorDrawerShell } from './MonitorDrawerShell';
import { FleetGridView } from './grid/FleetGridView';
import { takeBoardBack } from './fleetboard/boardEscape';
import {
  buildMonitorModel,
  processStatusMeta, processStatusLabel, elapsedStr,
  type ProcessEntry, type DrawerSection,
} from './monitorModel';

// THE CHUNK BOUNDARIES SIT ONE LEVEL DEEPER THAN THE MONITOR.
//
// Measured 2026-09-06 by walking static imports from this file: 551 modules,
// against the ~90 the app shell already holds. Almost all of the rest hangs
// off five components that are not on screen when the Monitor opens onto
// Activity — the drawer (366 modules, capabilities + reasoning trace), the
// three channel surfaces (235–248 each), and the dispatch dock (117). Each
// is its own chunk now, fetched the first time it is needed, behind a
// fallback that holds its exact footprint: the dock's 36px bar, the
// channel card's header ghost, nothing for a drawer that has not been
// opened. The Activity board itself keeps only what it paints in frame one.
const MonitorDrawer = lazyRetry(() => import('./MonitorDrawer').then((m) => ({ default: m.MonitorDrawer })));
const RemoteSessionDrawer = lazyRetry(() => import('./remote/RemoteSessionDrawer'));
const Stream = lazyRetry(() => import('./channels/Stream'));
const ConversationBriefing = lazyRetry(() =>
  import('./channels/ConversationBriefing').then((m) => ({ default: m.ConversationBriefing })),
);
const ChannelMap = lazyRetry(() => import('./channels/map/ChannelMap'));
const QuickDispatchDock = lazyRetry(() => import('./grid/QuickDispatchDock'));
const BoardView = lazyRetry(() => import('./fleetboard'));

/** The dock's footprint while its chunk loads: the same 36px collapsed bar. */
function DockPlaceholder() {
  return <div aria-hidden className="h-9 flex-shrink-0 border-t border-border bg-foreground/[0.015]" />;
}

/** A channel surface's footprint while its chunk loads: header ghost, no body. */
function SurfaceFallback() {
  return <RouteChunkSkeleton showIcon showActions={false} showSubtitle={false} />;
}

/**
 * The body region's footprint while a view's chunk loads — the same geometry
 * each branch gives its own content (`flex-1 min-h-0` outer, `h-full p-2
 * hud-atmosphere` inner), so the swap moves nothing.
 *
 * It belongs to ONE boundary around the whole body rather than one per branch,
 * and that is what makes `startTransition` worth anything here. React only
 * holds already-revealed content through a suspension when the boundary that
 * suspends has already committed something: a fresh boundary inside the
 * incoming branch has not, so it drops straight to its fallback and the
 * outgoing view is thrown away whether the update is a transition or not. With
 * one boundary spanning both branches, the Activity board it is already
 * showing stays on screen — painted and interactive — until Timeline's chunk
 * is ready to replace it. This only ever paints on a FIRST view whose chunk is
 * cold (a deep link straight into Timeline), which is exactly what it used to
 * paint for.
 */
function BodyFallback() {
  return (
    <div className="relative z-10 flex-1 min-h-0">
      <div className="h-full p-2 hud-atmosphere">
        <SurfaceFallback />
      </div>
    </div>
  );
}

interface PersonaMonitorProps {
  onClose: () => void;
  /**
   * Is the overlay on screen? The Monitor is mounted once per app session and
   * hidden rather than torn down (see `monitorVisibility.ts` and the
   * suspension block below), so this is the only thing that moves when the
   * operator opens or closes it. Defaults to `true` for the standalone mounts
   * that have no owner to drive it (tests, the dev-only grid overlay).
   */
  visible?: boolean;
}

/**
 * How long the hide waits for the exit fade. The fade is 0.16s (below); a
 * little slack past it means the overlay is still painted for the whole
 * animation and goes `content-visibility: hidden` only once it is already
 * fully transparent.
 */
const HIDE_AFTER_EXIT_MS = 220;

// The strip takes no props and owns its own store subscriptions, so there is
// nothing for it to learn from a parent render — but the 1s elapsed-time tick
// below re-renders this whole component, and an unmemoized strip (233 lines of
// execution-bar work) re-rendered with it every second. memo turns the tick
// into a bail-out at this boundary.
const MemoFleetActivityStrip = memo(FleetActivityStrip);

/** The five top-level Monitor destinations. */
type MonitorView = 'activity' | 'timeline' | 'conversations' | 'map' | 'board';

/**
 * Last-selected tab, remembered for the life of the session.
 *
 * It was module-scoped because the Monitor fully unmounted on close, so
 * component state could not carry it. **That is no longer true** — the overlay
 * now persists for the app session and hides instead, so `view` itself
 * survives a close and this is redundant for the close/reopen case it was
 * written for. It is kept deliberately: it is still the initializer for the
 * genuine remounts that remain (the dev-only standalone mount, a Fast Refresh
 * boundary, a test), and other code may yet read the last destination from
 * here. Deliberately NOT persisted — a fresh app launch should land on
 * Activity.
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

export function PersonaMonitor({ onClose, visible = true }: PersonaMonitorProps) {
  const { t } = useTranslation();

  /* OVERLAY SUSPENSION — the mirror of App.tsx's "C5 — SHELL SUSPENSION".
   *
   * `TrayOverlays` keeps this component mounted from the first open onward, so
   * "closed" has to mean something other than "gone". It means what C5 already
   * means one level up, pointed the other way: `inert` + `content-visibility:
   * hidden`, so the browser skips paint, layout and hit-testing for the whole
   * subtree and drops it out of the a11y tree, while React state, effects and
   * every scroll offset inside stay alive. Reopening is therefore instant and
   * lands on the same view, the same scroll position and the same selection —
   * which `display: none` would not give us.
   *
   * `invisible` (visibility: hidden) rides along because this element is NOT
   * the shell: it is a fixed, fully-opaque, z-50 sheet covering the app.
   * `content-visibility: hidden` only skips the CONTENTS — the element itself
   * would still paint its own `bg-background` over everything and still be the
   * hit-test target for every click in the app. `pointer-events-none` is the
   * belt to that braces, because an `inert` element is not hit-tested as a
   * target but is also not transparent to what is behind it.
   *
   * THE ASYMMETRY IS THE SAME ONE C5 MAKES, INVERTED. C5 delays suspending the
   * shell past the overlay's ENTRANCE so nothing visibly vanishes mid-fade,
   * and restores immediately on close so the exit fade plays over live
   * content. Here it is this overlay that fades: hiding is DELAYED past its
   * own 0.16s exit fade (so the fade is seen), showing is IMMEDIATE (so the
   * entrance fade plays over an already-live subtree). Both directions keep
   * the rule: never suspend something that is still animating.
   */
  const [hidden, setHidden] = useState(!visible);
  useEffect(() => {
    if (visible) {
      setHidden(false);
      return;
    }
    const id = setTimeout(() => setHidden(true), HIDE_AFTER_EXIT_MS);
    return () => clearTimeout(id);
  }, [visible]);

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
  /**
   * THE TAB THE OPERATOR JUST PRESSED, which is not the same thing as the tab
   * being rendered.
   *
   * `goToView` below hands the actual view change to `startTransition`, so the
   * outgoing surface stays mounted and interactive while the incoming one (a
   * lazy chunk, in three of the five cases) builds. The standard trap with
   * that is the one thing the operator can see: the tab strip reads `view`, so
   * the pill they clicked would not light up until the new body had finished
   * arriving, and a 300ms chunk fetch would read as a dead click. This holds
   * the pressed destination as an URGENT update, cleared inside the same
   * transition that commits the view, so the affordance moves on the frame of
   * the click and the two can never end up disagreeing.
   */
  const [pressedView, setPressedView] = useState<MonitorView | null>(null);
  /** What the tab strip highlights: the press if one is in flight, else the view. */
  const activeTab = pressedView ?? view;
  const goToView = useCallback((next: MonitorView) => {
    setPressedView(next);
    startTransition(() => {
      setView(next);
      setPressedView(null);
    });
  }, []);
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
  // cadence buckets from. Used below for the elapsed-time tick. Renamed from
  // `visible` when the overlay gained its own `visible` prop: the WINDOW being
  // visible and the OVERLAY being on screen are two independent questions, and
  // the tick below has to ask both.
  const documentVisible = useDocumentVisibility();

  // Activity and Board are the two FLEET views: both draw cards built from
  // these feeds and both host the persona drawer.
  const isFleetView = view === 'activity' || view === 'board';
  const feeds = useMemo(
    () => ({
      reviews: isFleetView,
      messages: isFleetView,
      personaHealth: isFleetView,
      badgeCounts: true,
    }),
    [isFleetView],
  );
  // `reviewsError` / `messagesError` / `healthError` / `lastRefreshed` were all
  // produced by the hook (or by its polling layer) and destructured by nobody,
  // which is why a Monitor whose reads had been failing for ten minutes still
  // rendered every tile idle-grey with no "as of" anywhere. See
  // `MonitorFeedStatus`.
  const {
    personas, healthMap, reviews, unreadMessages, activeProcesses,
    reviewBadgeCounts, messageBadgeCounts, refreshAttention,
    reviewsError, messagesError, healthError, lastRefreshed,
    loading, isProcessing, isReviewInFlight, handleReviewAction, handleDispatchAction,
    handleMarkRead,
  } = useMonitorData(feeds);

  const { cards, systemProcesses } = useMemo(
    () => buildMonitorModel(personas, reviews, unreadMessages, activeProcesses, healthMap, {
      reviews: reviewBadgeCounts,
      messages: messageBadgeCounts,
    }),
    [personas, reviews, unreadMessages, activeProcesses, healthMap, reviewBadgeCounts, messageBadgeCounts],
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
    workspaceTeams, bridges, selectOnly, allOn, setAll,
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
      goToView('timeline');
    },
    [scopeToPersona, goToView],
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
    // The fourth condition is the OVERLAY itself, and it arrived with
    // persistence. A closed Monitor used to be an unmounted Monitor, so this
    // interval could not outlive it; now the whole tree stays alive behind
    // `content-visibility: hidden` and the clock would keep ticking against a
    // surface nobody can see — re-rendering the Monitor once a second to paint
    // into a subtree the browser is not painting. It is CLEARED, not merely
    // skipped in the body: an interval that wakes every second to decide it
    // has nothing to do is still a wake, and `now` is re-stamped on the
    // false→true edge exactly as it is for the window, so reopening after ten
    // minutes away shows honest elapsed times in the first commit.
    if (!anyRunning || !isFleetView || !documentVisible || !visible) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [anyRunning, isFleetView, documentVisible, visible]);

  const [selection, setSelection] = useState<Selection | null>(null);
  // A remote session's drawer (a `remote:<jobId>` tile). One drawer at a time:
  // opening either closes the other.
  const [remoteJobId, setRemoteJobId] = useState<string | null>(null);
  // Stable open handler (takes personaId) so the memoized grid squares don't
  // re-render just because an inline onSelect closure changed identity.
  const handleCardSelect = useCallback(
    (personaId: string, section: DrawerSection) => {
      setRemoteJobId(null);
      setSelection({ personaId, section });
    },
    [],
  );
  const openRemote = useCallback((jobId: string) => {
    setSelection(null);
    setRemoteJobId(jobId);
  }, []);
  const closeRemote = useCallback(() => setRemoteJobId(null), []);
  const selectedCard = useMemo(
    () => cards.find((c) => c.personaId === selection?.personaId) ?? null,
    [cards, selection],
  );

  useEffect(() => {
    // A HIDDEN MONITOR DOES NOT ANSWER ESCAPE.
    //
    // This is a `window` listener, and before persistence a closed Monitor was
    // an unmounted Monitor, so there was no listener to answer with. Keeping
    // it registered while hidden would be a behaviour change, not an
    // optimisation: the handler reaches `takeBoardBack()` and `onClose()`, so
    // one Escape pressed anywhere else in the app — dismissing a sidebar
    // popover, leaving a field — would silently unzoom a Board nobody is
    // looking at, or clear a drawer selection the operator left open on
    // purpose and expects to find again. Escape belongs to whatever is on
    // screen, and a `content-visibility: hidden` overlay is not. Gating the
    // REGISTRATION rather than the body also means a hidden Monitor costs the
    // keyboard path nothing at all.
    if (!visible) return;
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
      // Innermost first: the drawer, the remote drawer, then the Board's team
      // zoom (one level back to the fleet), and only then the Monitor itself.
      if (selection) setSelection(null);
      else if (remoteJobId) setRemoteJobId(null);
      else if (!takeBoardBack()) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, remoteJobId, onClose, visible]);

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
    { id: 'board', label: t.monitor.board_mode, hint: t.monitor.board_mode_title, icon: LayoutDashboard },
  ];
  const selectView = useCallback(
    (next: MonitorView) => {
      // Only the map's node click should carry a callsign into the Timeline.
      clearDrill();
      goToView(next);
    },
    [clearDrill, goToView],
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
    /* The signal the whole subtree gates its own cost on. See
       `monitorVisibility.ts` for why this is a context and not a store read,
       and why its default is `true`. It carries the PROP, not `!hidden`: the
       160ms of exit fade is time nobody is reading, so a poll that stops at
       the start of the fade rather than at the end of it stops at the right
       moment. */
    <MonitorVisibilityContext.Provider value={visible}>
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
      {/* Faint interconnected-agents backdrop (dark mode only). */}
      {isDark && (
        <img
          aria-hidden
          src="/illustrations/monitor-network-dark.webp"
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
            <h2 className="typo-heading-lg text-foreground">{t.monitor.title}</h2>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* The router: four peer destinations. */}
          <div className="flex items-center gap-1" role="group" data-testid="monitor-view-tabs">
            {VIEWS.map((v) => {
              const Icon = v.icon;
              const on = activeTab === v.id;
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
      {isFleetView && (
        <MonitorFeedStatus
          reviewsError={reviewsError}
          messagesError={messagesError}
          healthError={healthError}
          lastRefreshed={lastRefreshed}
        />
      )}

      {/* ONE boundary for the whole body — see `BodyFallback`. */}
      <Suspense fallback={<BodyFallback />}>
      {isFleetView ? (
        /* Body — the fleet board (Activity or Board) with the drawer layered over it */
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
              {/* First-ever cold open only (the warm cache in useMonitorData
                  makes every re-open paint the last-known fleet immediately):
                  the board renders its OWN chrome — header, usage strip, rail
                  footprint — with a geometry-matched ghost where the columns
                  will be, never a settled empty state before the first read
                  lands (law 1 / law 3). This used to swap the whole board for
                  a header-only skeleton, so the cold open painted a page
                  header, then a blank, then everything at once. */}
              {view === 'board' ? (
                <BoardView
                  cards={cards}
                  personas={personas}
                  teams={teams}
                  systemProcesses={systemProcesses}
                  now={now}
                  selectedPersonaId={selection?.personaId ?? null}
                  onSelect={handleCardSelect}
                  isLoading={loading && cards.length === 0}
                />
              ) : (
                <FleetGridView
                  cards={cards}
                  personas={personas}
                  teams={teams}
                  selectedPersonaId={selection?.personaId ?? null}
                  onSelect={handleCardSelect}
                  feedTeams={workspaceTeams}
                  onOpenSpeaker={handleDrillIn}
                  isLoading={loading && cards.length === 0}
                  onOpenRemote={openRemote}
                />
              )}
            </div>
          </div>

          <MonitorDrawerShell open={!!(selectedCard && selection)} onClose={closeDrawer}>
            {selectedCard && selection && (
              <Suspense fallback={<SurfaceFallback />}>
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
                  onAttentionChanged={refreshAttention}
                  onClose={closeDrawer}
                />
              </Suspense>
            )}
          </MonitorDrawerShell>
          {/* A session sent to a paired device: same shell, its own content. */}
          <MonitorDrawerShell open={remoteJobId !== null} onClose={closeRemote}>
            {remoteJobId !== null && (
              <Suspense fallback={<SurfaceFallback />}>
                <RemoteSessionDrawer jobId={remoteJobId} onClose={closeRemote} />
              </Suspense>
            )}
          </MonitorDrawerShell>
        </div>
      ) : (
        <div className="relative z-10 flex-1 min-h-0">
          <div className="h-full p-2 hud-atmosphere">
            {!hasChannels ? (
              channelEmpty
            ) : view === 'timeline' ? (
              <Stream
                teams={workspaceTeams}
                onSelectTeam={selectOnly}
                allOn={allOn}
                onSetAll={setAll}
                initialCallsign={drillCallsign}
              />
            ) : view === 'map' ? (
              <ChannelMap teams={workspaceTeams} onDrillIn={handleDrillIn} />
            ) : (
              <ConversationBriefing
                teams={workspaceTeams}
                personas={personas}
                bridges={bridges}
                preset={channelPreset}
              />
            )}
          </div>
        </div>
      )}
      </Suspense>

      {/* THE COMMAND CONSOLE, where the footer's legend + count line used to be.
          Both of those were passive restatements of things already on screen —
          the legend of a colour key that now lives in the Activity header, the
          counts of numbers the rail tabs badge. The footer strip is better spent
          on the one thing no Monitor view could do: start work. It sits at
          Monitor level rather than inside the Activity card so it is reachable
          from the Timeline, Conversations and the Map too. */}
      <Suspense fallback={<DockPlaceholder />}>
        <QuickDispatchDock />
      </Suspense>
    </motion.div>
    </MonitorVisibilityContext.Provider>
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
