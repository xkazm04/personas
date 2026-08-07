import { lazy, Suspense, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSystemStore } from '@/stores/systemStore';

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
 * grid's raise/minimize behaviour and defers everything visual to the lazy host.
 *
 * It used to own the fleet's app-wide **bootstrap** too. That was a defect: this
 * component's mount is dev-gated (correctly — the overlay is dev tooling), so
 * the bootstrap was dead-code-eliminated from production alongside it. The
 * bootstrap now lives in its own always-mounted `FleetBootstrap`; do not move it
 * back in here.
 */
export default function FleetGridLayer() {
  const gridOpen = useSystemStore((s) => s.fleetGridOpen);
  const setGridOpen = useSystemStore((s) => s.fleetSetGridOpen);
  const sessions = useSystemStore(useShallow((s) => s.fleetSessions));

  // Exited/hibernated sessions keep their tiles (in-place tombstones), so the
  // grid only auto-minimizes once NOTHING is tracked at all — i.e. the last
  // tombstone was dismissed. Tiles never vanish out from under the operator.
  const gridCount = sessions.length;
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
