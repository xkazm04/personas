// Recovery for a lost `dev_lifecycle_*` push. The journey refetches on
// `lifecycleRevision`, which the eventBridge bumps per DEV_TOOLS_LIFECYCLE_CHANGED,
// and that push rides CDC's bounded channel, which drops events when its drain
// falls behind (`db/src/cdc.rs`). `reconcileShip` reads the process-wide drop
// counter and bumps BOTH the Ship and the lifecycle revisions when it moved, but
// until this hook only the Ship planner ever called it, so a Lifecycle page open
// on its own stayed stale until the next write. Same triggers as `useShipLive`:
// route entry, window focus, `visibilitychange -> visible`. Evidence, not a clock.
import { useEffect } from 'react';

import { subscribeDocumentVisibility } from '@/lib/documentVisibility';
import { useDevToolsLiveStore } from '@/stores/devToolsLiveStore';

/** Mounted once by the Lifecycle page: reconcile the CDC drop counter on entry, focus and re-show. */
export function useLifecycleReconcile(): void {
  const reconcile = useDevToolsLiveStore((s) => s.reconcileShip);

  useEffect(() => {
    void reconcile();
    const stopVisibility = subscribeDocumentVisibility((visible) => {
      if (visible) void reconcile();
    });
    // The store's in-flight guard makes a focus + visible pair cost one read.
    const onFocus = () => { void reconcile(); };
    window.addEventListener('focus', onFocus);
    return () => {
      stopVisibility();
      window.removeEventListener('focus', onFocus);
    };
  }, [reconcile]);
}
