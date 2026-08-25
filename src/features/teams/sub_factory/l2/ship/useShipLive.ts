// Live-refresh for the Ship planner. Returns a number that CHANGES whenever a
// Ship-table write landed outside this tab; `useShipData` puts it in its fetch
// effect's deps and that is the whole wiring.
//
// Two paths, deliberately no third:
//   PUSH        — `EventName.DEV_TOOLS_SHIP_CHANGED` (SQLite update hook →
//                 `eventBridge`, debounced) bumps `shipRevision`.
//   RECONCILE   — CDC's bounded channel drops events when its drain falls
//                 behind, so push alone is lossy. On mount / window focus /
//                 `visibilitychange → visible` we read the drop counter and
//                 refetch ONLY if it moved. Evidence, not a clock.
//
// There is no interval and no watermark query loop here, and adding one would
// be a regression: polling was ruled out for this surface.
import { useEffect } from 'react';

import { subscribeDocumentVisibility } from '@/lib/documentVisibility';
import { useDevToolsLiveStore } from '@/stores/devToolsLiveStore';

/**
 * Subscribe the caller to out-of-tab Ship-table writes.
 *
 * @returns a monotonic revision. Feed it to a fetch effect's dependency array;
 *          treat any change as "refetch the slice". It carries no information
 *          about WHAT changed on purpose — the CDC payload cannot say, because
 *          a DELETE has no row left to identify.
 */
export function useShipLiveRevision(): number {
  const revision = useDevToolsLiveStore((s) => s.shipRevision);
  const reconcile = useDevToolsLiveStore((s) => s.reconcileShip);

  useEffect(() => {
    // Route entry: this hook mounts when the planner does (lazy routes fully
    // unmount on nav-away), so this covers "came back to the tab".
    void reconcile();

    const stopVisibility = subscribeDocumentVisibility((visible) => {
      if (visible) void reconcile();
    });
    // `visibilitychange` covers minimise/restore; app-switch on desktop often
    // only produces a window focus, so both are wired. `reconcileShip` holds an
    // in-flight guard, so a focus+visible pair still costs one read.
    const onFocus = () => { void reconcile(); };
    window.addEventListener('focus', onFocus);

    return () => {
      stopVisibility();
      window.removeEventListener('focus', onFocus);
    };
  }, [reconcile]);

  return revision;
}
