/**
 * The settled half of the operator's lane - landed, declined, failed and
 * withdrawn requests, newest first - drawn in the queue drawer only when the
 * operator asks for it from the drawer's head.
 *
 * It pages: the history only grows, so it is read twenty rows at a time and
 * the next page is asked for when the reader scrolls to the end of the last
 * one, never all of it up front. The "Load more" control under the rows is the
 * same request for a reader who does not scroll (keyboard, a short page that
 * never reaches the sentinel).
 *
 * Mounted lazily by the page, so a drawer nobody opens to its history costs no
 * chunk and no read.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { curatorRequestsHistory } from '@/api/curator';
import Button from '@/features/shared/components/buttons/Button';
import type { CuratorRequest } from '@/lib/bindings/CuratorRequest';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { silentCatch } from '@/lib/silentCatch';

import { useWords } from '../words';

import { RequestRow } from './RequestRow';

/** One page of history. */
export const HISTORY_PAGE = 20;

interface HistoryState {
  rows: CuratorRequest[];
  /** Index of the first row of the most recent page - its stagger origin. */
  pageStart: number;
  loading: boolean;
  done: boolean;
  failed: boolean;
}

const INITIAL: HistoryState = { rows: [], pageStart: 0, loading: false, done: false, failed: false };

export default function RequestHistory({ onCancel }: { onCancel: (id: string) => Promise<void> }) {
  const { w } = useWords();
  const [state, setState] = useState<HistoryState>(INITIAL);
  // The in-flight guard lives in a ref: two intersection callbacks in one frame
  // must not both read `loading: false` and fetch the same offset twice.
  const busy = useRef(false);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const offset = useRef(0);
  // Each page fades in once, from its own first row; a row already shown never
  // replays when the next page lands under it.
  const enter = useRevealTracker();

  const loadMore = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setState((s) => ({ ...s, loading: true, failed: false }));
    try {
      const page = await curatorRequestsHistory(HISTORY_PAGE, offset.current);
      offset.current += page.length;
      setState((s) => ({
        rows: [...s.rows, ...page],
        pageStart: s.rows.length,
        loading: false,
        done: page.length < HISTORY_PAGE,
        failed: false,
      }));
    } catch (err) {
      silentCatch('curator:history:page')(err);
      setState((s) => ({ ...s, loading: false, failed: true }));
    } finally {
      busy.current = false;
    }
  }, []);

  // First page on mount: the history is read when it is opened, not before.
  useEffect(() => {
    void loadMore();
  }, [loadMore]);

  // The next page when the end of the last one scrolls into the drawer's view.
  const canLoad = !state.done && !state.failed;
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !canLoad) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: '120px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [canLoad, loadMore, state.rows.length]);

  const first = state.rows.length === 0;
  if (first && state.failed) {
    return (
      <div className="cb-lane" data-role="cb-history" data-state="unread">
        <span className="cb-unset typo-caption">{w.console.lane_history_unread}</span>
      </div>
    );
  }

  return (
    <div
      className="cb-lane"
      data-role="cb-history"
      data-state={state.rows.length ? 'filled' : first && (state.loading || !state.done) ? 'loading' : 'empty'}
    >
      {state.rows.length === 0 ? (
        state.done && (
          <p className="cb-lane-empty typo-caption" data-role="cb-history-empty">
            {w.console.lane_history_empty}
          </p>
        )
      ) : (
        <ul className="cb-lane-rows typo-caption" aria-label={w.console.lane_view_history}>
          {state.rows.map((request, i) => (
            <RequestRow
              key={request.id}
              request={request}
              onCancel={onCancel}
              reveal={{ order: i - state.pageStart, ...enter }}
            />
          ))}
        </ul>
      )}
      <div ref={sentinel} aria-hidden="true" />
      {state.rows.length > 0 && (
        <div className="cb-lane-head typo-caption" data-role="cb-history-foot">
          {state.done ? (
            <i>{w.console.lane_history_end}</i>
          ) : state.failed ? (
            <span className="cb-unset">{w.console.lane_history_unread}</span>
          ) : null}
          <span className="cb-sp" />
          {!state.done && (
            <Button
              variant="ghost"
              size="xs"
              className="cb-keep"
              loading={state.loading}
              onClick={() => void loadMore()}
              data-role="cb-history-more"
            >
              {w.console.lane_history_more}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
