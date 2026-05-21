import { useLayeredList, type LayeredPage } from '@/hooks/utility/data/useLayeredList';
import { listManualReviewsPage, getManualReviewCounts } from '@/api/overview/reviews';
import type { PersonaManualReview } from '@/lib/bindings/PersonaManualReview';
import type { ManualReviewCounts } from '@/lib/bindings/ManualReviewCounts';

/** A concrete manual-review status, or `undefined` for "all statuses". */
export type ManualReviewQueueStatus = 'pending' | 'approved' | 'rejected' | 'resolved';

export interface ManualReviewQueueFilters {
  status?: ManualReviewQueueStatus;
  /** Restrict to one persona, or `undefined` for every persona. */
  personaId?: string;
  /** Defer fetching until the surface is on-screen (anti-"big-bang"). */
  enabled?: boolean;
}

/** Rows requested per keyset page — see `list_manual_reviews_page`'s clamp. */
const PAGE_SIZE = 40;

/**
 * Layered-fetch data source for the Manual Reviews queue — the reference
 * adoption of `useLayeredList` for the Overview layered-fetch contract
 * (see `docs/architecture/overview-layered-fetch.md`).
 *
 * - **L0** — `getManualReviewCounts` drives the filter-tab badges and list
 *   sizing without loading rows.
 * - **L1** — the first ~40 rows for the current status/persona filter.
 * - **L2** — `sentinelRef` pulls further keyset pages on scroll.
 *
 * Status and persona filters are applied **server-side** (folded into
 * `filterKey`), so the client never materialises the whole
 * `persona_manual_reviews` table — the queue stays O(viewport) at any
 * volume.
 */
export function useManualReviewQueue(filters: ManualReviewQueueFilters) {
  const { status, personaId, enabled } = filters;
  // Any change to status/persona resets the list and refetches L0 + L1.
  const filterKey = `${status ?? 'all'}::${personaId ?? 'all'}`;

  return useLayeredList<PersonaManualReview, ManualReviewCounts>({
    filterKey,
    enabled,
    fetchPage: (cursor): Promise<LayeredPage<PersonaManualReview>> =>
      listManualReviewsPage({
        status,
        personaId,
        cursor: cursor ?? undefined,
        limit: PAGE_SIZE,
      }).then((page) => ({
        rows: page.rows,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      })),
    fetchCounts: () => getManualReviewCounts(personaId),
  });
}
