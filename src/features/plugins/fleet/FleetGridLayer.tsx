import { lazy, Suspense, useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSystemStore } from '@/stores/systemStore';
import { isGridEligible } from './fleetSessionScope';

// The overlay drags in xterm + the terminal manager, so it is only imported
// once the grid is actually raised. Keeping it out of the app-boot graph is
// deliberate: @xterm/* is a heavy, WebView2-sensitive dependency (see the
// frozen-Object.prototype note in docs/features/plugins/dev tools/fleet.md)
// and nothing about the *footer* status cluster needs it.
const FleetGridOverlayHost = lazy(() => import('./FleetGridOverlayHost'));

/**
 * App-wide host for the fullscreen fleet grid (DEV-only surface).
 *
 * Previously the overlay was rendered by `FleetGridPage`, so it could only
 * exist while the user was standing on Dev Tools → Fleet. That made the footer
 * toggle a *navigation*: checking on a session meant leaving whatever you were
 * doing. Mounting the overlay at app root instead makes grid mode a **layer**
 * — raise it over any page, reply to whatever needs you, minimize, and the
 * page underneath never moved.
 *
 * This component is intentionally cheap (no terminal imports): it owns the
 * fleet's app-wide *bootstrap* and defers everything visual to the lazy host.
 */
export default function FleetGridLayer() {
  const gridOpen = useSystemStore((s) => s.fleetGridOpen);
  const setGridOpen = useSystemStore((s) => s.fleetSetGridOpen);
  const sessions = useSystemStore(useShallow((s) => s.fleetSessions));
  const refresh = useSystemStore((s) => s.fleetRefresh);
  const startSessionListeners = useSystemStore((s) => s.fleetStartSessionListeners);

  // Bootstrap the fleet client cache once per app process. Before this, the
  // session list only became live when someone opened the Fleet page — which
  // left the footer status cluster blank until then. It also lands the
  // persisted auto-hibernate / live-slot / cutoff policy on the Rust ticker at
  // startup instead of on first Fleet visit (the follow-up noted in fleet.md).
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    startSessionListeners();
    void refresh();
  }, [startSessionListeners, refresh]);

  const gridCount = useMemo(() => sessions.filter(isGridEligible).length, [sessions]);

  // If every session exits or sleeps while the grid is up, minimize rather
  // than leave an empty fullscreen surface covering the app.
  useEffect(() => {
    if (gridOpen && gridCount === 0) setGridOpen(false);
  }, [gridOpen, gridCount, setGridOpen]);

  if (!gridOpen) return null;

  return (
    <Suspense fallback={null}>
      <FleetGridOverlayHost />
    </Suspense>
  );
}
