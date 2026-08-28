import { useEffect, useRef } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import {
  attachTerminal,
  detachTerminal,
  focusTerminal,
  setFleetTerminalDeadNotice,
} from './fleetTerminalManager';

interface FleetTerminalPaneProps {
  /** Internal Fleet session id (UUID v4 minted by fleet_spawn_session). */
  sessionId: string;
  /** Optional className for the outer container. */
  className?: string;
  /** Grid tiles disable auto-focus so tabbing between many panes is sane. */
  autoFocus?: boolean;
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
export function FleetTerminalPane({ sessionId, className, autoFocus = true }: FleetTerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { t } = useTranslation();

  // Hand the manager the translated dead-session notice BEFORE attaching. The
  // manager is a plain module with no `t`, and a failed subscribe there used to
  // paint nothing at all — leaving a black box the operator could not tell from
  // a session that had simply not printed yet. This effect is declared first so
  // it runs before the attach effect below on the same mount. Every terminal in
  // the app goes through this pane, which is why the string is pushed from here
  // rather than from the grid-only settings hook.
  useEffect(() => {
    setFleetTerminalDeadNotice(t.plugins.fleet.terminal_session_gone);
  }, [t]);

  // Attach the managed terminal on mount / session change; detach (NOT
  // dispose) on unmount so the buffer and PTY subscription persist.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    attachTerminal(sessionId, container);
    if (autoFocus) focusTerminal(sessionId);
    return () => detachTerminal(sessionId);
  }, [sessionId, autoFocus]);

  return (
    <div
      ref={containerRef}
      className={`h-full w-full bg-[#0a0a0c] ${className ?? ''}`}
      data-testid={`fleet-terminal-${sessionId}`}
    />
  );
}
