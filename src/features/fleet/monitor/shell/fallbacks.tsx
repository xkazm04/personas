// The footprints the Monitor's lazy chunks hold while they load.

import { RouteChunkSkeleton } from '@/features/shared/components/layout/RouteChunkSkeleton';

/**
 * The dock's footprint while its chunk loads: the resting plate's 52px (a 40px
 * plate in a 4px / 8px gutter, `DockRestingRow`), as an empty plate.
 */
export function DockPlaceholder() {
  return (
    <div aria-hidden className="flex-shrink-0 px-2.5 pb-2 pt-1">
      <div className="h-10 rounded-card border border-border" />
    </div>
  );
}

/** A channel surface's footprint while its chunk loads: header ghost, no body. */
export function SurfaceFallback() {
  return <RouteChunkSkeleton showIcon showActions={false} showSubtitle={false} />;
}

/**
 * The body region's footprint while a view's chunk loads — the same geometry
 * each branch gives its own content (`flex-1 min-h-0` outer, `h-full p-2`
 * inner), so the swap moves nothing.
 *
 * It belongs to ONE boundary around the whole body rather than one per branch,
 * and that is what makes `startTransition` worth anything here. React only
 * holds already-revealed content through a suspension when the boundary that
 * suspends has already committed something: a fresh boundary inside the
 * incoming branch has not, so it drops straight to its fallback and the
 * outgoing view is thrown away whether the update is a transition or not. With
 * one boundary spanning every branch, the Activity board it is already
 * showing stays on screen — painted and interactive — until the incoming
 * chunk is ready to replace it. This only ever paints on a FIRST view whose
 * chunk is cold (a deep link straight into Conversations).
 */
export function BodyFallback() {
  return (
    <div className="relative z-10 flex-1 min-h-0">
      <div className="h-full p-2">
        <SurfaceFallback />
      </div>
    </div>
  );
}
