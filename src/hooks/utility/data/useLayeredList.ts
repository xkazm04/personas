import { useCallback, useEffect, useRef, useState } from 'react';
import { createLogger } from '@/lib/log';

const logger = createLogger('layered-list');

/**
 * useLayeredList — the shared client primitive for the Overview
 * layered-fetch contract.
 *
 * The Overview modules must stay responsive with thousands of rows
 * (Messages, Reviews, Memories) and hundreds of agents. A single
 * "fetch-all on mount" call is a scalability dead-end: it blocks the
 * IPC bus, balloons the store, and forces the UI to reconcile every row.
 *
 * This hook implements three loading layers so cost scales with what the
 * user actually looks at, not with table size:
 *
 *  - **L0 — skeleton/counts.** One cheap aggregate query (`fetchCounts`)
 *    renders headers, filter-tab badges and list sizing instantly. No
 *    row data.
 *  - **L1 — first viewport.** One keyset page (`fetchPage(null)`) — the
 *    ~40 rows the user can actually see — rendered into a virtualized
 *    list.
 *  - **L2 — lazy continuation.** `sentinelRef` wires an
 *    IntersectionObserver near the list end; scrolling toward it pulls
 *    the next keyset page and appends it.
 *
 * Anti-"big-bang": pass `enabled: false` for off-screen tabs/sections so
 * a dashboard landing only pays L1 for the surface in view; flip it true
 * when the tab activates.
 *
 * Stale-response safety: an internal epoch counter is bumped on every
 * filter change / reload, and every resolution checks it — late responses
 * from a superseded filter are dropped (Tauri `invoke` has no abort, so
 * this is the cancellation mechanism).
 */

export interface LayeredPage<Row> {
  rows: Row[];
  /** Opaque cursor for the next page, or `null` when the list is exhausted. */
  nextCursor: string | null;
  hasMore: boolean;
}

export interface UseLayeredListOptions<Row, Counts> {
  /**
   * Stable string identifying the current filter set (status, persona,
   * search, …). Changing it resets the list and refetches L0 + L1.
   */
  filterKey: string;
  /** L1/L2 — fetch one keyset page. `cursor` is `null` for the first page. */
  fetchPage: (cursor: string | null) => Promise<LayeredPage<Row>>;
  /** L0 — fetch counts/skeleton. Optional; failure is non-fatal. */
  fetchCounts?: () => Promise<Counts>;
  /** When false, no fetching happens — used to defer off-screen surfaces. */
  enabled?: boolean;
}

export interface UseLayeredListResult<Row, Counts> {
  rows: Row[];
  counts: Counts | null;
  /** L1 (first-page) load in flight. */
  loading: boolean;
  /** L2 (next-page) load in flight. */
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  /**
   * Callback ref — attach to a sentinel element rendered near the end of
   * the list. Entering the viewport pulls the next page.
   */
  sentinelRef: (el: HTMLElement | null) => void;
  /** Manually pull the next page (a "Load more" button fallback). */
  loadMore: () => void;
  /** Force a full reload (L0 + L1) — e.g. after a mutation. */
  reload: () => void;
}

export function useLayeredList<Row, Counts = unknown>(
  opts: UseLayeredListOptions<Row, Counts>,
): UseLayeredListResult<Row, Counts> {
  const { filterKey, fetchPage, fetchCounts, enabled = true } = opts;

  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Latest-callback refs keep the load effect's deps limited to
  // `filterKey`/`enabled` — callers may pass inline closures.
  const fetchPageRef = useRef(fetchPage);
  fetchPageRef.current = fetchPage;
  const fetchCountsRef = useRef(fetchCounts);
  fetchCountsRef.current = fetchCounts;

  // Epoch guards against stale responses after a filter change / reload.
  const epochRef = useRef(0);
  const cursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(false);
  const inFlightRef = useRef(false);

  const runFirstLoad = useCallback(() => {
    const epoch = ++epochRef.current;
    cursorRef.current = null;
    hasMoreRef.current = false;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);

    // L0 — counts. Fire-and-forget; a failure must not block the rows.
    const countsFn = fetchCountsRef.current;
    if (countsFn) {
      countsFn().then(
        (c) => { if (epoch === epochRef.current) setCounts(c); },
        (e) => {
          if (epoch === epochRef.current) {
            logger.warn('L0 counts fetch failed', { err: e instanceof Error ? e.message : String(e) });
          }
        },
      );
    }

    // L1 — first viewport page.
    fetchPageRef.current(null).then(
      (page) => {
        if (epoch !== epochRef.current) return;
        setRows(page.rows);
        cursorRef.current = page.nextCursor;
        hasMoreRef.current = page.hasMore;
        setHasMore(page.hasMore);
        setLoading(false);
        inFlightRef.current = false;
      },
      (e) => {
        if (epoch !== epochRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setRows([]);
        setHasMore(false);
        setLoading(false);
        inFlightRef.current = false;
      },
    );
  }, []);

  const loadMore = useCallback(() => {
    if (inFlightRef.current || !hasMoreRef.current) return;
    const epoch = epochRef.current;
    inFlightRef.current = true;
    setLoadingMore(true);
    fetchPageRef.current(cursorRef.current).then(
      (page) => {
        if (epoch !== epochRef.current) return;
        setRows((prev) => [...prev, ...page.rows]);
        cursorRef.current = page.nextCursor;
        hasMoreRef.current = page.hasMore;
        setHasMore(page.hasMore);
        setLoadingMore(false);
        inFlightRef.current = false;
      },
      (e) => {
        if (epoch !== epochRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoadingMore(false);
        inFlightRef.current = false;
      },
    );
  }, []);

  const reload = useCallback(() => {
    if (enabled) runFirstLoad();
  }, [enabled, runFirstLoad]);

  // L0 + L1 fire when the filter changes or the surface becomes enabled.
  useEffect(() => {
    if (!enabled) return;
    runFirstLoad();
    // runFirstLoad is stable; filterKey/enabled are the real triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, enabled]);

  // L2 — IntersectionObserver sentinel. `rootMargin` pre-loads slightly
  // before the sentinel is visible so scrolling feels seamless.
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useCallback(
    (el: HTMLElement | null) => {
      observerRef.current?.disconnect();
      if (!el) return;
      observerRef.current = new IntersectionObserver(
        (entries) => {
          if (entries.some((en) => en.isIntersecting)) loadMore();
        },
        { rootMargin: '240px' },
      );
      observerRef.current.observe(el);
    },
    [loadMore],
  );

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return { rows, counts, loading, loadingMore, hasMore, error, sentinelRef, loadMore, reload };
}
