import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, LayoutGrid, BookOpen, Play, Table2 } from 'lucide-react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { PendingApproval } from '@/api/companion';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { FleetOverlayTile } from './FleetOverlayTile';
import { FleetAttentionLegend } from './FleetAttentionLegend';
import { FleetDebugLogButton } from './FleetDebugLogButton';
import { DESKTOP_FOOTER_HEIGHT_PX } from '@/features/shared/chrome/DesktopFooter';
import { setFleetFontOverride, MAX_WEBGL } from './fleetTerminalManager';
import { approvalsForSession, needsLiveAttention } from './fleetAttention';
import { gridDim, densityFont } from './fleetGridLayout';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { MonitorView } from './sub_monitor/MonitorView';

// Two grid views: the classic terminal tiles and the minimized monitor
// ledger. Which one an open lands on is decided in ./fleetGridView (one-shot
// requests > the operator's explicit pick > the fleet-size default) so other
// surfaces — the footer cluster's "open the ledger" click — stay in sync.
import {
  peekGridViewOnOpen, resolveGridViewOnOpen, recordGridViewPick, type GridViewId,
} from './fleetGridView';

/**
 * How long a tile keeps its live terminal after it stops needing the operator.
 *
 * A tile's pane is mounted from `needsLiveAttention` (awaiting_input) or from
 * being the focused tile, and an agent crosses that line constantly: every tool
 * call it makes flips running -> awaiting_input -> running again. Each crossing
 * used to run a full teardown (unsubscribe, dispose the WebGL renderer, park)
 * and a full attach (re-subscribe, the lossy `term.reset()`, replay of up to
 * 512 KiB of ring, reload WebGL) — the dominant terminal cost in a 16-session
 * fleet, and a visible flash in the one tile the operator is watching.
 *
 * 5 seconds is chosen the way MAX_PARKED and MAX_WEBGL are: against the
 * behaviour, not as a round number. A prompt-approval round trip and a tool
 * loop's think-act-think cycle both land inside it, so the overwhelmingly
 * common flip-and-flip-back is absorbed entirely; past that the session has
 * genuinely settled into autonomous work and the pane is worth releasing.
 * Longer would start holding renderers for tiles nobody returns to; shorter
 * would let an ordinary agent pause reopen the whole teardown.
 */
const TILE_KEEPALIVE_MS = 5_000;

/**
 * Hold a tile's live pane for `TILE_KEEPALIVE_MS` after its attention lapses,
 * and cancel the hold outright if attention comes back inside the window.
 *
 * Returns the ids currently held on grace; the caller unions them with the ones
 * that genuinely want a pane right now. Deliberately a hysteresis in the
 * OVERLAY rather than a keep-alive in the manager: the manager's contract is
 * "attached means subscribed", and the thing that is actually flapping is this
 * component's render policy, not the terminal's lifecycle. Putting the delay
 * here leaves `attachTerminal`/`detachTerminal` exactly as honest as they were,
 * and leaves every other pane call site (the preview panel, the passport modal,
 * the single-pane view) unaffected.
 *
 * The hold is BUDGETED, not unbounded: a kept pane is an attached terminal and
 * therefore holds a WebGL renderer like any other, so the grace set is capped at
 * whatever headroom is left under `MAX_WEBGL` after the tiles that genuinely
 * want a pane. Past the cap the oldest hold is released immediately — a fleet
 * already at the renderer budget gets no grace at all, which is the correct
 * answer: adding kept panes there would only churn the manager's WebGL LRU and
 * demote a terminal somebody is reading.
 */
function useAttentionKeepAlive(wantedKey: string): ReadonlyMap<string, number> {
  // id -> the timestamp its hold expires at. Insertion-ordered, so the first
  // key is the oldest hold — the one the renderer budget releases first.
  const [kept, setKept] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [seenKey, setSeenKey] = useState(wantedKey);

  // Adjusted DURING RENDER, not in an effect — React's documented pattern for
  // deriving state from changed props, and here it is load-bearing rather than
  // stylistic. An effect runs after the commit, so the render in which
  // attention lapses would still see the old (empty) grace set, unmount the
  // pane, and only then be told to keep it: the teardown this exists to prevent
  // happens anyway, followed by an immediate re-attach. Measured that way: 6
  // mounts over 5 flips — exactly the unfixed number. React re-runs this
  // component before committing, so the set is correct on the first paint.
  if (wantedKey !== seenKey) {
    const wanted = new Set(wantedKey ? wantedKey.split('|') : []);
    const previously = seenKey ? seenKey.split('|') : [];
    const next = new Map(kept);
    // Attention just lapsed — hold the pane instead of tearing it down.
    const expiresAt = Date.now() + TILE_KEEPALIVE_MS;
    for (const id of previously) if (!wanted.has(id) && !next.has(id)) next.set(id, expiresAt);
    // Attention returned inside the window — the teardown never happens.
    for (const id of wanted) next.delete(id);
    // A kept pane still costs a renderer, so the grace set only gets whatever
    // headroom is left under MAX_WEBGL.
    const budget = Math.max(0, MAX_WEBGL - wanted.size);
    while (next.size > budget) next.delete(next.keys().next().value as string);
    setSeenKey(wantedKey);
    setKept(next);
  }

  // ONE timer for the nearest expiry rather than one per hold: the set is
  // re-derived whenever it fires, so a second pass picks up whatever is due
  // next. Nothing here is left running past a re-run or an unmount.
  useEffect(() => {
    if (kept.size === 0) return;
    const soonest = Math.min(...kept.values());
    const handle = window.setTimeout(
      () => {
        const now = Date.now();
        setKept((prev) => {
          const next = new Map([...prev].filter(([, expires]) => expires > now));
          return next.size === prev.size ? prev : next;
        });
      },
      Math.max(0, soonest - Date.now()),
    );
    return () => window.clearTimeout(handle);
  }, [kept]);

  return kept;
}

interface Props {
  open: boolean;
  /** Live (non-exited) sessions to tile, in display order. */
  sessions: FleetSession[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  /** Minimize — return to the single-pane view. */
  onClose: () => void;
  /** Athena copilot wiring (suggestions surfaced on each tile). */
  approvals: PendingApproval[];
  /** Session ids with an in-flight "Ask Athena" turn. */
  askingSessionIds: Set<string>;
  onApprove: (approvalId: string) => void;
  onReject: (approvalId: string) => void;
  onAskAthena: (session: FleetSession) => void;
  /** Open the shared skill-library drawer (applies to the focused tile). */
  onOpenSkills: () => void;
  /** Spawn a new session in the active project. */
  onSpawn: () => void;
  /** Whether a spawn is currently possible (project selected, not spawning). */
  canSpawn: boolean;
  /** Kill a session's process by id. */
  onKill: (id: string) => void;
}

/**
 * Fullscreen, app-wide terminal grid. Portaled to `document.body` so it sits
 * above the (transform-using) framer-motion layout ancestors — a plain
 * `fixed inset-0` nested in the page would be positioned relative to a
 * transformed ancestor, not the viewport.
 *
 * Every tile attaches a durable managed terminal (the same instances the
 * single pane uses), so opening/closing the overlay is lossless. The single
 * pane is unmounted by the parent while this is open so the two don't contend
 * for the same terminal's holder element.
 */
export function FleetTerminalOverlay({
  open,
  sessions,
  activeSessionId,
  onSelect,
  onClose,
  approvals,
  askingSessionIds,
  onApprove,
  onReject,
  onAskAthena,
  onOpenSkills,
  onSpawn,
  canSpawn,
  onKill,
}: Props) {
  const { t, tx } = useTranslation();
  const setBackInterceptor = useSystemStore((s) => s.setBackInterceptor);
  const dim = useMemo(() => gridDim(sessions.length), [sessions.length]);

  // NOTE: this component must NEVER write `fleetGridOpen`. That flag is now
  // the *input* that decides whether the app-wide `FleetGridLayer` mounts this
  // overlay at all — it used to also be an output here (an effect that set it
  // on mount and cleared it on unmount, so the Athena orb could lift itself
  // above the z-[200] overlay). Once the layer started rendering FROM the flag
  // that became a cycle: under StrictMode's mount → cleanup → mount effect
  // double-invoke, the cleanup's `setGridOpen(false)` re-entered the layer's
  // render mid-flush and left the overlay wedged open — visibly mounted but
  // no longer closeable from the footer. The orb reads the same store flag, so
  // nothing was lost by deleting the write.

  // Initializer PEEKS (render must stay side-effect-free); the open effect
  // below RESOLVES, consuming any one-shot view request. Same value both
  // times, so the second set is a no-op re-render at most.
  const [view, setView] = useState<GridViewId>(() => peekGridViewOnOpen(sessions.length));
  const changeView = useCallback((v: GridViewId) => {
    recordGridViewPick(v);
    setView(v);
  }, []);

  // Re-decide the landing view on every OPEN, not on every session change — the
  // view must not swap out from under the operator while they are reading it.
  const sessionCount = useRef(sessions.length);
  sessionCount.current = sessions.length;
  useEffect(() => {
    if (!open) return;
    setView(resolveGridViewOnOpen(sessionCount.current));
  }, [open]);

  // Two-phase open (perf): paint the overlay frame + tile chrome/status blocks
  // on the FIRST frame, and only mount the expensive tile bodies (xterm attach,
  // WebGL context creation) a beat later. Opening the grid used to pay the
  // whole xterm cost inside the opening render, which is what made the switch
  // feel heavy.
  const [bodiesReady, setBodiesReady] = useState(false);
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => setBodiesReady(true), 200);
    return () => window.clearTimeout(id);
  }, [open]);

  // Per-tile Terminal/Insights view (P2.1 in the grid). Membership = showing
  // Insights; default (absent) = the live terminal.
  const [insightTiles, setInsightTiles] = useState<Set<string>>(new Set());
  const toggleInsight = useCallback((id: string) => {
    setInsightTiles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Apply the density font override while open; clear it on close/unmount.
  useEffect(() => {
    if (!open) return;
    setFleetFontOverride(densityFont(dim));
    return () => setFleetFontOverride(null);
  }, [open, dim]);

  // Render policy: a tile mounts a live (subscribed) terminal only when it needs
  // the operator (`needsLiveAttention` — awaiting_input) or it's the focused tile
  // (the manual "peek"). Every other session is autonomous and renders a cheap
  // status block — Athena triages those in the background with full backend
  // visibility, so the grid stays calm regardless of how many sessions run.

  // The tiles that want a live pane RIGHT NOW. Joined into a string so the
  // keep-alive effect keys on the membership rather than on a new array
  // identity every render; ids are UUIDs, so '|' cannot appear inside one.
  const wantedKey = useMemo(
    () =>
      bodiesReady
        ? sessions
            .filter((s) => needsLiveAttention(s) || s.id === activeSessionId)
            .map((s) => s.id)
            .join('|')
        : '',
    [sessions, activeSessionId, bodiesReady],
  );
  const keptAlive = useAttentionKeepAlive(wantedKey);

  // Route the global titlebar Back button (and Escape) to minimize, instead of
  // navigating the underlying page out from under the overlay.
  useEffect(() => {
    if (!open) return;
    setBackInterceptor(onClose);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      setBackInterceptor(null);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, setBackInterceptor]);

  if (!open) return null;

  const count = sessions.length;
  const countLabel =
    count === 1
      ? tx(t.plugins.fleet.sessions_one, { count })
      : tx(t.plugins.fleet.sessions_other, { count });

  return createPortal(
    // Terminal grid — a working surface (labeled region), not a centered
    // dialog, so it doesn't use BaseModal. It is deliberately NOT `inset-0`:
    // it stops below the 48px titlebar (`top-12`) so the always-on-top titlebar
    // — window controls and the global Back button — stays usable, and it stops
    // ABOVE the desktop footer so the footer keeps working as the app's
    // navigation strip while the sidebar is covered (see FooterSectionNav).
    //
    // The footer gap is reserved in layout, not left to z-order. Overlapping
    // and relying on the footer's higher z-index is what failed before: the
    // footer lives under a `contain: layout` ancestor, so its z-index was
    // scoped to that subtree and this portal painted straight over it.
    // Dismissal: titlebar/overlay Back, Escape, or the footer's fleet toggle.
    <div
      className="fleet-typescale fixed left-0 right-0 top-12 z-[200] flex flex-col bg-background"
      style={{ bottom: DESKTOP_FOOTER_HEIGHT_PX }}
      data-testid="fleet-terminal-overlay"
      role="region"
      aria-label={t.plugins.fleet.grid_overlay_aria}
    >
      {/* Header — back button (minimize) + count. */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10 bg-secondary/20 shrink-0">
        <button
          type="button"
          data-testid="fleet-overlay-back"
          onClick={onClose}
          className="flex items-center gap-1 rounded-interactive border border-primary/15 px-2 py-1 text-foreground transition-colors hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
        >
          <ChevronLeft className="w-4 h-4" />
          {t.plugins.fleet.grid_back}
        </button>
        <LayoutGrid className="w-4 h-4 text-primary ml-1" aria-hidden="true" />
        <span className="typo-caption text-foreground">{countLabel}</span>
        <FleetAttentionLegend />
        {/* Tiles / Monitor view switcher. */}
        <SegmentedTabs
          tabs={[
            { id: 'tiles' as const, label: <LayoutGrid className="w-3.5 h-3.5" />, ariaLabel: t.plugins.fleet.monitor_tiles_aria },
            { id: 'monitor' as const, label: <Table2 className="w-3.5 h-3.5" />, ariaLabel: t.plugins.fleet.monitor_aria },
          ]}
          activeTab={view}
          onTabChange={changeView}
          fullWidth={false}
          size="sm"
          ariaLabel={t.plugins.fleet.monitor_view_switcher_aria}
          className="ml-2"
        />
        <button
          type="button"
          data-testid="fleet-overlay-spawn"
          onClick={onSpawn}
          disabled={!canSpawn}
          title={t.plugins.fleet.new_session}
          className="ml-auto flex items-center gap-1.5 rounded-interactive border border-primary/25 bg-primary/10 px-2 py-1 text-primary transition-colors hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
        >
          <Play className="w-3.5 h-3.5" />
          {t.plugins.fleet.new_session}
        </button>
        {/* Debug recorder — DEV-only, and deliberately adjacent to New session:
            arming it is a decision you make while watching the grid. */}
        {import.meta.env.DEV && <FleetDebugLogButton />}
        <button
          type="button"
          data-testid="fleet-overlay-skills"
          onClick={onOpenSkills}
          title={t.plugins.fleet.skills_drawer_title}
          className="flex items-center gap-1.5 rounded-interactive border border-primary/15 px-2 py-1 text-foreground transition-colors hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
        >
          <BookOpen className="w-3.5 h-3.5" />
          {t.plugins.fleet.skills_button}
        </button>
      </div>

      {view === 'monitor' ? (
        <MonitorView sessions={sessions} onSelect={onSelect} onOverlayClose={onClose} />
      ) : (
      /* Grid — square columns capped at 4; rows auto-fill, scroll past 4×4. */
      <div
        data-testid="fleet-overlay-grid"
        className="flex-1 min-h-0 grid gap-1.5 p-1.5 overflow-y-auto"
        style={{
          gridTemplateColumns: `repeat(${dim}, minmax(0, 1fr))`,
          gridAutoRows: 'minmax(160px, 1fr)',
        }}
      >
        {sessions.map((s) => (
          <FleetOverlayTile
            key={s.id}
            session={s}
            isActive={s.id === activeSessionId}
            live={bodiesReady && (needsLiveAttention(s) || s.id === activeSessionId || keptAlive.has(s.id))}
            showInsights={insightTiles.has(s.id)}
            onToggleInsight={toggleInsight}
            onSelect={onSelect}
            onKill={onKill}
            approvals={approvalsForSession(approvals, s.id)}
            asking={askingSessionIds.has(s.id)}
            onApprove={onApprove}
            onReject={onReject}
            onAsk={onAskAthena}
          />
        ))}
      </div>
      )}
    </div>,
    document.body,
  );
}
