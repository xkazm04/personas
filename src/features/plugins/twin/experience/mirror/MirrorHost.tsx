/**
 * Mount point for the Mirror. `TwinPage` renders this once, beside its tab
 * router rather than inside it, so the layer outlives whatever the page
 * underneath does while it is open (the roster swapping its first-run hero for
 * the grid the moment a twin exists, for one).
 *
 * The body is its own chunk: most visits to the Twin pages never open it.
 * While that chunk loads the shell is already painted and holds a calm,
 * header-shaped ghost (loading pattern v2) — never a spinner.
 */

import { Suspense, useCallback, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { lazyRetry } from '@/lib/lazyRetry';
import { RouteChunkSkeleton } from '@/features/shared/components/layout/RouteChunkSkeleton';
import { useSystemStore } from '@/stores/systemStore';
import { closeMirror, useMirrorRequest } from './launcher';
import { MirrorShell } from './MirrorShell';
import { MIRROR_TITLE_ID } from './mirrorIds';

const MirrorBody = lazyRetry(() => import('./MirrorBody'));

export function MirrorHost() {
  const request = useMirrorRequest();
  const setTwinTab = useSystemStore((s) => s.setTwinTab);

  // A request must not outlive the page that hosts it: left set, it would
  // re-open the layer the next time the Twin pages mount.
  useEffect(() => () => closeMirror(), []);

  /** Memories and the Brain are reviewed in the Hub: leave the lane for it. */
  const openHub = useCallback(() => {
    closeMirror();
    setTwinTab('hub');
  }, [setTwinTab]);

  return (
    <AnimatePresence>
      {request && (
        <MirrorShell key="mirror-experience" onClose={closeMirror} labelledBy={MIRROR_TITLE_ID}>
          <Suspense fallback={<RouteChunkSkeleton showActions={false} />}>
            <MirrorBody request={request} onClose={closeMirror} onOpenHub={openHub} />
          </Suspense>
        </MirrorShell>
      )}
    </AnimatePresence>
  );
}

export default MirrorHost;
