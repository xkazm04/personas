// RailSlot — the rail's footprint, filled in two stages.
//
// The rail's three feeds reach the unified triage queue, the dispatch backlog
// and the channel modals — ~230 modules beyond the app shell — so it is a chunk
// of its own and it lands one staged frame after the tiles. Until then this
// paints the PERSISTED WIDTH and nothing else, so neither the stage change nor
// the chunk arriving shifts the columns beside it.

import { Suspense } from 'react';
import { lazyRetry } from '@/lib/lazyRetry';
import type { FeedTeam } from '../../channels/types';
import type { RailProjectFilter } from '../rail/railFilter';
import { useRailWidth } from '../rail/useRailWidth';
import type { SimRailRows } from '../simulation';

// `lazyRetry`, not raw `lazy`: a chunk fetch that fails once (a dev server
// restart, a flaky disk) must not cache its rejection forever.
const ActivityRail = lazyRetry(() => import('../ActivityRail'));

/** The rail's footprint while the rail itself waits a frame or a chunk. */
export function RailPlaceholder() {
  const rail = useRailWidth();
  return (
    <div
      aria-hidden
      className="flex min-h-0 flex-shrink-0 border-l border-border"
      style={{ width: rail.width }}
      data-testid="fleet-grid-rail-placeholder"
    />
  );
}

export function RailSlot({
  ready, feedTeams, onOpenSpeaker, filter, onClearFilter, simulated,
}: {
  /** The rail's stage has arrived. Before it, the placeholder holds the width. */
  ready: boolean;
  feedTeams: FeedTeam[];
  onOpenSpeaker?: (teamId: string, personaId: string) => void;
  filter: RailProjectFilter | null;
  onClearFilter: () => void;
  /** Mock rows for all three tabs, or null to read the real feeds. */
  simulated?: SimRailRows | null;
}) {
  if (!ready) return <RailPlaceholder />;
  return (
    <Suspense fallback={<RailPlaceholder />}>
      <ActivityRail
        feedTeams={feedTeams}
        onOpenSpeaker={onOpenSpeaker}
        filter={filter}
        onClearFilter={onClearFilter}
        simulated={simulated ?? null}
      />
    </Suspense>
  );
}

export default RailSlot;
