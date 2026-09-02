import { useCallback, useEffect, useRef, useState } from 'react';
import { MonitorUp } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import {
  attachTerminal,
  detachTerminal,
  focusTerminal,
  onTerminalHolderLost,
  setFleetTerminalDeadNotice,
  setFleetTerminalListenerNotice,
  setTerminalLiveness,
} from './fleetTerminalManager';

interface FleetTerminalPaneProps {
  /** Internal Fleet session id (UUID v4 minted by fleet_spawn_session). */
  sessionId: string;
  /** Optional className for the outer container. */
  className?: string;
  /** Grid tiles disable auto-focus so tabbing between many panes is sane. */
  autoFocus?: boolean;
  /**
   * False once the session's process is gone (exited / hibernated — the same
   * tombstone predicate `FleetOverlayTile` computes). The pane then stops the
   * cursor blinking and refuses stdin instead of pretending a dead rung of the
   * ladder is still typeable. Defaults to true.
   */
  live?: boolean;
}

/**
 * Live PTY terminal pane for one Fleet session — a thin *mount point* over
 * `fleetTerminalManager`. The durable xterm instance (renderer, keyboard, PTY
 * subscription, scrollback) lives in the manager keyed by `sessionId`, so
 * switching the active session or tiling many sessions attaches/detaches the
 * same terminal instead of disposing and re-creating it. Attaching subscribes
 * to live PTY output and replays the backend ring snapshot; detaching
 * unsubscribes (the Rust reader keeps buffering into the ring, but stops
 * streaming over IPC) — so an unwatched session costs nothing to render and
 * switching back replays the recent tail.
 *
 * The pane is deliberately chrome-free — font size, copy-on-select and theme
 * live in Fleet Settings, applied live across all terminals via the manager.
 */
export function FleetTerminalPane({ sessionId, className, autoFocus = true, live = true }: FleetTerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { t } = useTranslation();

  // Hand the manager the translated dead-session notice BEFORE attaching. The
  // manager is a plain module with no `t`, and a failed subscribe there used to
  // paint nothing at all — leaving a black box the operator could not tell from
  // a session that had simply not printed yet. This effect is declared first so
  // it runs before the attach effect below on the same mount. Every terminal in
  // the app goes through this pane, which is why the string is pushed from here
  // rather than from the grid-only settings hook.
  // The manager has TWO failure doors and both need a translated line pushed in
  // before an attach: the per-session subscribe (`terminal_session_gone`) and
  // the app-wide output listener (`terminal_output_stalled`). A pane whose
  // subscribe succeeded and whose listener never registered paints its snapshot
  // and then freezes — the second string is what stops that reading as a hung
  // agent.
  useEffect(() => {
    setFleetTerminalDeadNotice(t.plugins.fleet.terminal_session_gone);
    setFleetTerminalListenerNotice(t.plugins.fleet.terminal_output_stalled);
  }, [t]);

  /**
   * True once another mount point has taken this session's terminal away.
   *
   * There is ONE holder element per session, so two panes cannot both display
   * it — and five independent call sites mount a pane for a session id they
   * choose, two of them (the mastermind preview, the passport modal) outside
   * the fleet overlay entirely. The loser used to find out by rendering an
   * empty black box that never updated again, indistinguishable from a session
   * that has printed nothing. Saying so, and offering the terminal back, is the
   * difference between a dead pane and a moved one.
   */
  const [displaced, setDisplaced] = useState(false);

  /**
   * Liveness, readable from the attach effect WITHOUT being one of its deps.
   *
   * `live` is a runtime-varying prop — `passportFleet.tsx` and
   * `FleetPreviewPanel.tsx` both compute it as `session?.state !== 'hibernated'`
   * — and listing it in the attach effect's deps meant a hibernation flip ran a
   * full detach + re-attach, whose `hydrate` calls the lossy `term.reset()`
   * (see `hydratedOk` in the manager). The operator opened the pane to read what
   * happened, and the state change that made them open it wiped the scrollback.
   * Liveness has its own effect below and needs no remount; the attach effect
   * only reads it once, to decide whether to steal focus on mount.
   */
  const liveRef = useRef(live);
  liveRef.current = live;

  // Attach the managed terminal on mount / session change; detach (NOT
  // dispose) on unmount so the buffer and PTY subscription persist.
  // Deliberately NOT keyed on `live` — see `liveRef` above.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setDisplaced(false);
    const offHolderLost = onTerminalHolderLost(container, () => setDisplaced(true));
    attachTerminal(sessionId, container);
    if (autoFocus && liveRef.current) focusTerminal(sessionId);
    // Detach with our own container as the owner token: if another pane has
    // since attached the same session, the holder is THEIRS and our unmount
    // must not unsubscribe, drop the renderer and unparent what they display.
    return () => {
      offHolderLost();
      detachTerminal(sessionId, container);
    };
  }, [sessionId, autoFocus]);

  // Take the terminal back. Symmetric by construction: whoever asks last owns
  // the holder, and the pane that loses it is told in exactly the same way.
  const reclaim = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    setDisplaced(false);
    attachTerminal(sessionId, container);
    if (live) focusTerminal(sessionId);
  }, [sessionId, live]);

  // Liveness is pushed AFTER the attach effect so it lands on a terminal that
  // exists; the manager no-ops for an unknown id.
  useEffect(() => {
    setTerminalLiveness(sessionId, live);
  }, [sessionId, live]);

  return (
    <div className={`relative h-full w-full ${className ?? ''}`}>
      <div
        ref={containerRef}
        className={`h-full w-full bg-[#0a0a0c] ${live ? '' : 'opacity-70'}`}
        data-testid={`fleet-terminal-${sessionId}`}
        data-live={live ? 'true' : 'false'}
        data-displaced={displaced ? 'true' : 'false'}
      />
      {displaced ? (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0a0a0c]/95 px-4 text-center"
          data-testid={`fleet-terminal-displaced-${sessionId}`}
        >
          <p role="status" className="text-[13px] text-foreground">
            {t.plugins.fleet.terminal_displaced}
          </p>
          <button
            type="button"
            onClick={reclaim}
            data-testid={`fleet-terminal-reclaim-${sessionId}`}
            className="flex items-center gap-1.5 rounded-interactive border border-primary/25 bg-primary/10 px-2.5 py-1 text-[13px] font-medium text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
          >
            <MonitorUp className="w-3.5 h-3.5" aria-hidden="true" />
            {t.plugins.fleet.terminal_displaced_reclaim}
          </button>
        </div>
      ) : null}
    </div>
  );
}
