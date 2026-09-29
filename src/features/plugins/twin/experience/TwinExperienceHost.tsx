/**
 * Mount point for the Twin experience. `TwinPage` renders this once, beside
 * its tab router rather than inside it, so the overlay outlives whatever the
 * page underneath does while it is open — the roster swapping its first-run
 * hero for the grid the moment a twin exists, for one.
 *
 * The frame is a capped `BaseModal`, not a bleed: `min(96vw, 110rem)` keeps it
 * a deliberate centred surface on a wide screen rather than a near-full-bleed
 * box with a hairline of page showing at the edges. Header and composer are
 * pinned by the children; only the table body scrolls.
 *
 * The body is its own chunk — most visits to the Twin pages never open it —
 * and while that chunk loads the frame is already painted and holds a calm,
 * header-shaped ghost (loading pattern v2), never a spinner.
 */

import { Suspense, useCallback, useEffect } from 'react';
import { lazyRetry } from '@/lib/lazyRetry';
import { BaseModal } from '@/lib/ui/BaseModal';
import { RouteChunkSkeleton } from '@/features/shared/components/layout/RouteChunkSkeleton';
import { useSystemStore } from '@/stores/systemStore';
import { closeTwinExperience, useTwinExperienceRequest } from './launcher';
import { EXPERIENCE_TITLE_ID } from './experienceIds';

const ExperienceBody = lazyRetry(() => import('./ExperienceBody'));

export function TwinExperienceHost() {
  const request = useTwinExperienceRequest();
  const setTwinTab = useSystemStore((s) => s.setTwinTab);

  // A request must not outlive the page that hosts it: left set, it would
  // re-open the overlay the next time the Twin pages mount.
  useEffect(() => () => closeTwinExperience(), []);

  /** Memories and the Brain are reviewed in the Hub: leave the table for it. */
  const openHub = useCallback(() => {
    closeTwinExperience();
    setTwinTab('hub');
  }, [setTwinTab]);

  if (!request) return null;

  return (
    <BaseModal
      isOpen
      onClose={closeTwinExperience}
      titleId={EXPERIENCE_TITLE_ID}
      portal
      staggerChildren={false}
      maxWidthClass="max-w-[min(96vw,110rem)]"
      panelClassName="h-[92vh] max-h-[92vh] w-full flex flex-col overflow-hidden rounded-modal glass-lg shadow-elevation-4 border border-primary/20 bg-background"
    >
      <Suspense fallback={<RouteChunkSkeleton showActions={false} />}>
        <ExperienceBody request={request} onClose={closeTwinExperience} onOpenHub={openHub} />
      </Suspense>
    </BaseModal>
  );
}

export default TwinExperienceHost;
