// How many of the ledger's rows are in the DOM, and what grows that.
//
// The backend hands over every contest at once (see `ledgerPaging.ts`), so
// this is a render window: pages of `LEDGER_PAGE_SIZE` revealed as the owner
// reaches the end of the list, by scroll or by keyboard. The window resets to
// one page whenever the filtered set changes identity, because a new set is a
// new reading task — but never when the SAME set merely refetches, so a poll
// cannot shrink what is already on screen (overview-loading law: a fetch never
// hides already-rendered rows).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { LedgerGroup } from './ledgerModel';
import { countLedgerRows, LEDGER_PAGE_SIZE, windowLedger, type LedgerWindow } from './ledgerPaging';

export interface LedgerPager {
  total: number;
  shown: number;
  hasMore: boolean;
  loadMore: () => void;
  /** Attach to a node after the last row; entering the viewport loads a page. */
  sentinelRef: (el: HTMLDivElement | null) => void;
}

export interface LedgerWindowState {
  window: LedgerWindow;
  pager: LedgerPager;
  /** Make sure row index `i` is rendered (keyboard walking past the window). */
  revealThrough: (i: number) => void;
}

export function useLedgerWindow(groups: readonly LedgerGroup[], resetKey: string): LedgerWindowState {
  const total = useMemo(() => countLedgerRows(groups), [groups]);
  // A different filter/query is a different reading task, so the limit is
  // stored WITH the key it belongs to and read back as one page when the key
  // moves on. No render-phase setState, and a refetch of the same set keeps
  // every page the owner has already opened.
  const [paging, setPaging] = useState({ key: resetKey, limit: LEDGER_PAGE_SIZE });
  const limit = paging.key === resetKey ? paging.limit : LEDGER_PAGE_SIZE;

  const grow = useCallback(
    (next: (n: number) => number) => {
      setPaging((p) => {
        const from = p.key === resetKey ? p.limit : LEDGER_PAGE_SIZE;
        return { key: resetKey, limit: Math.max(from, next(from)) };
      });
    },
    [resetKey],
  );

  const loadMore = useCallback(() => grow((n) => n + LEDGER_PAGE_SIZE), [grow]);

  const revealThrough = useCallback(
    (i: number) => grow((n) => (i < n ? n : Math.ceil((i + 1) / LEDGER_PAGE_SIZE) * LEDGER_PAGE_SIZE)),
    [grow],
  );

  const window_ = useMemo(() => windowLedger(groups, limit), [groups, limit]);

  // Infinite loading: observe a node past the last row. Re-observed whenever
  // the window grows, so one scroll to the bottom walks page after page.
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const sentinelRef = useCallback((el: HTMLDivElement | null) => {
    nodeRef.current = el;
    setNode(el);
  }, []);
  const hasMore = window_.hasMore;

  useEffect(() => {
    if (!node || !hasMore || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { rootMargin: '240px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [node, hasMore, loadMore, window_.shown]);

  return {
    window: window_,
    pager: { total, shown: window_.shown, hasMore, loadMore, sentinelRef },
    revealThrough,
  };
}
