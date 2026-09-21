/**
 * Mount point for the Twin experience. `TwinPage` renders this once, beside
 * its tab router rather than inside it, so the overlay outlives whatever the
 * page underneath does while it is open (the roster swapping its first-run
 * hero for the grid the moment a twin exists, for one).
 *
 * The body is its own chunk: most visits to the Twin pages never open it.
 * While that chunk loads, the shell is already painted and holds a calm,
 * header-shaped ghost (loading pattern v2) — never a spinner.
 */

import { Suspense, useCallback, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { lazyRetry } from '@/lib/lazyRetry';
import { RouteChunkSkeleton } from '@/features/shared/components/layout/RouteChunkSkeleton';
import { useSystemStore } from '@/stores/systemStore';
import { closeTwinExperience, useTwinExperienceRequest } from './launcher';
import { ExperienceShell } from './ExperienceShell';
import { EXPERIENCE_TITLE_ID } from './experienceIds';

const ExperienceBody = lazyRetry(() => import('./ExperienceBody'));

export function TwinExperienceHost() {
  const request = useTwinExperienceRequest();
  const setTwinTab = useSystemStore((s) => s.setTwinTab);

  // A request must not outlive the page that hosts it: left set, it would
  // re-open the layer the next time the Twin pages mount.
  useEffect(() => () => closeTwinExperience(), []);

  /** Memories and the Brain are reviewed in the Hub: leave the table for it. */
  const openHub = useCallback(() => {
    closeTwinExperience();
    setTwinTab('hub');
  }, [setTwinTab]);

  return (
    <AnimatePresence>
      {request && (
        <ExperienceShell key="twin-experience" onClose={closeTwinExperience} labelledBy={EXPERIENCE_TITLE_ID}>
          <Suspense fallback={<RouteChunkSkeleton showActions={false} />}>
            <ExperienceBody request={request} onClose={closeTwinExperience} onOpenHub={openHub} />
          </Suspense>
        </ExperienceShell>
      )}
    </AnimatePresence>
  );
}

export default TwinExperienceHost;
