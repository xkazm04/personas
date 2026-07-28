import { ContentHeaderSkeleton } from './ContentHeaderSkeleton';

/**
 * @catalog RouteChunkSkeleton — the delayed, header-only Suspense fallback for a lazy route/section chunk. Renders nothing for the first ~150ms (CSS `animate-fade-in` + `animationDelay`, fill-mode both), then a calm `ContentHeaderSkeleton` ghost — so a warm chunk resolves before a single pixel paints and only a genuinely slow chunk shows chrome instead of a blank gap.
 *
 * Use it as `<Suspense fallback={<RouteChunkSkeleton />}>` for a section/tab whose
 * lazy chunk would otherwise flash a blank content area on first navigation.
 * This is the shared, parametrized version of the `OverviewRouteSkeleton` pattern
 * (docs/design/overview-loading.md §D "Chunk (Suspense) fallbacks"):
 *
 * - **Invisible unless the chunk is genuinely slow** — the whole fallback sits
 *   behind a 150ms `animation-delay` with `fill-mode: both`, so warm chunks (and
 *   prefetched ones) never paint it. No JS timer; the delay is pure CSS.
 * - **Never fake the incoming body** — only the header band ghosts, because it is
 *   the one region every route shares at the same position, so the swap to the
 *   real `ContentHeader` moves nothing. Body silhouettes lie about each page's
 *   geometry and produce exactly the skeleton→content blink the doctrine forbids.
 *
 * Keep the `show*` flags aligned with the header the route actually renders
 * (icon? actions? subtitle?) so the swap is shift-free.
 */
interface RouteChunkSkeletonProps {
  /** Render the leading icon-chip placeholder. Match the route's real header. */
  showIcon?: boolean;
  /** Render the trailing actions placeholder (e.g. a select / button). Default on. */
  showActions?: boolean;
  /** Render the large subtitle bar. Default on (most page headers carry one). */
  showSubtitle?: boolean;
}

export function RouteChunkSkeleton({
  showIcon = false,
  showActions = true,
  showSubtitle = true,
}: RouteChunkSkeletonProps = {}) {
  return (
    <div
      aria-hidden="true"
      className="flex-1 min-h-0 flex flex-col animate-fade-in"
      style={{ animationDelay: '150ms' }}
    >
      <ContentHeaderSkeleton showIcon={showIcon} showActions={showActions} showSubtitle={showSubtitle} calm />
    </div>
  );
}

export default RouteChunkSkeleton;
