// The unified Backlog — Approvals' second decision mode, and now the ONLY
// triage home for `dev_ideas`.
//
// It replaces the flat "pending ideas" list this tab used to be: a faceted
// table over the whole corpus (cross-project), a status filter fed by real
// server-side counts, checkbox bulk verdicts, and a detail ledger that walks
// the queue the user is actually looking at.
//
// This component owns the three things the table and the ledger must NOT: the
// status filter, the selection set, and the modal's snapshotted queue.
import { useCallback, useMemo, useState } from 'react';

import { nextQueueIndex } from '@/features/plugins/dev-tools/sub_workspaces/libraryModel';
import { useTranslation } from '@/i18n/useTranslation';

import { BacklogDetailModal } from './BacklogDetailModal';
import { BacklogTable } from './BacklogTable';
import { useCategoryLabel } from './backlogLabels';
import type { BacklogIdea } from './backlogModel';
import type { BacklogQueue, BacklogStatus } from './useBacklogQueue';

const STATUSES: BacklogStatus[] = ['pending', 'accepted', 'rejected', 'archived'];

export function BacklogPanel({ queue }: { queue: BacklogQueue }) {
  const { t, tx } = useTranslation();
  const r = t.overview.review;
  const categoryLabel = useCategoryLabel();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // The modal walks a SNAPSHOT of the ordering taken when it opened. Recomputing
  // from the live rows would re-sort the queue under the cursor the moment a
  // verdict changes a row's status, and "next" would stop meaning next.
  const [queueIds, setQueueIds] = useState<string[]>([]);
  const [queueIdx, setQueueIdx] = useState(0);

  const statusLabel: Record<BacklogStatus, string> = {
    pending: r.backlog_status_pending,
    accepted: r.backlog_status_accepted,
    rejected: r.backlog_status_rejected,
    archived: r.backlog_status_archived,
  };

  const byId = useMemo(
    () => new Map(queue.rows.map((i) => [i.id, i])),
    [queue.rows],
  );

  const setStatus = (s: BacklogStatus) => {
    queue.setStatus(s);
    setSelectedIds(new Set());
    closeDetail();
  };

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) =>
      prev.size === queue.rows.length && queue.rows.length > 0
        ? new Set()
        : new Set(queue.rows.map((i) => i.id)),
    );
  }, [queue.rows]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Bulk verdicts run SEQUENTIALLY: each call mutates the shared triage slice,
  // and firing them in parallel would race the counts into nonsense.
  const bulkDecide = useCallback(
    (verdict: 'accept' | 'reject') => {
      const ids = [...selectedIds];
      setSelectedIds(new Set());
      void (async () => {
        for (const id of ids) {
          await (verdict === 'accept' ? queue.accept(id) : queue.reject(id));
        }
      })();
    },
    [selectedIds, queue],
  );

  function closeDetail() {
    setQueueIds([]);
    setQueueIdx(0);
  }

  const openDetail = useCallback((row: BacklogIdea, ordered: BacklogIdea[]) => {
    const ids = ordered.map((i) => i.id);
    const at = ids.indexOf(row.id);
    setQueueIds(ids.length > 0 ? ids : [row.id]);
    setQueueIdx(Math.max(0, at));
  }, []);

  const stepDetail = useCallback((delta: -1 | 1) => {
    setQueueIdx((idx) => {
      const next = nextQueueIndex(queueIds, idx, delta, (id) => byId.has(id));
      if (next === null) {
        setQueueIds([]);
        return 0;
      }
      return next;
    });
  }, [queueIds, byId]);

  const detailIdea = queueIds.length > 0 ? byId.get(queueIds[queueIdx] ?? '') ?? null : null;

  return (
    <div className="flex flex-col min-h-0 h-full gap-3 px-4 pt-3 pb-4">
      <div className="flex items-center gap-2 flex-wrap">
        {STATUSES.map((s) => {
          const count = queue.counts?.[s] ?? 0;
          const active = queue.status === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              aria-pressed={active}
              className={`typo-label rounded-full px-2.5 py-1 border transition-colors ${
                active
                  ? 'bg-primary/15 text-foreground border-primary/30'
                  : 'bg-primary/5 text-muted-foreground border-primary/10 hover:bg-primary/10'
              }`}
            >
              {statusLabel[s]}
              <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
        {/* P5 docks the sweep button, the triage-rules panel and the
            table|focus deck toggle here. */}
        {queue.hasMore && (
          <button
            type="button"
            onClick={queue.loadMore}
            disabled={queue.loadingMore}
            className="ml-auto typo-label rounded-interactive border border-primary/20 bg-primary/10 px-2.5 py-1 text-foreground hover:bg-primary/15 disabled:opacity-40 transition-colors"
          >
            {tx(r.backlog_load_more, { count: queue.rows.length })}
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0">
        {queue.loading && queue.rows.length === 0 ? (
          <BacklogGhostRows />
        ) : (
          <BacklogTable
            rows={queue.rows}
            projectOptions={queue.projectOptions}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
            onBulkAccept={() => bulkDecide('accept')}
            onBulkReject={() => bulkDecide('reject')}
            onClearSelection={clearSelection}
            onRowClick={openDetail}
          />
        )}
      </div>

      {detailIdea && (
        <BacklogDetailModal
          idea={detailIdea}
          categoryLabel={categoryLabel}
          busy={queue.actingId !== null}
          onAccept={queue.accept}
          onReject={queue.reject}
          onClose={closeDetail}
          nav={
            queueIds.length > 1
              ? { index: queueIdx, total: queueIds.length, onStep: stepDetail }
              : undefined
          }
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BacklogGhostRows — calm, delayed ghost rows for the only moment the backlog
// body has nothing to show while a fetch is in flight
// (docs/design/overview-loading.md). No `animate-pulse`; each row enters via
// `animate-fade-in` behind a >=120ms staggered delay, so a fast fetch never
// paints one.
// ---------------------------------------------------------------------------

const BACKLOG_GHOST_BAR = 'rounded bg-primary/[0.06]';
const BACKLOG_GHOST_TITLE_WIDTHS = ['w-48', 'w-36', 'w-44', 'w-40'];

function BacklogGhostRows() {
  return (
    <div className="flex h-full min-h-0 gap-4" aria-hidden="true">
      <div className="w-60 shrink-0 rounded-card border border-primary/10 p-2 space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <span
            key={i}
            className={`block h-3.5 w-3/4 ${BACKLOG_GHOST_BAR} animate-fade-in`}
            style={{ animationDelay: `${120 + i * 35}ms` }}
          />
        ))}
      </div>
      <ul className="flex-1 min-w-0 overflow-hidden rounded-card border border-primary/10">
        {Array.from({ length: 8 }).map((_, i) => {
          const titleW = BACKLOG_GHOST_TITLE_WIDTHS[i % BACKLOG_GHOST_TITLE_WIDTHS.length];
          return (
            <li
              key={i}
              className="flex items-center gap-3 px-4 border-b border-primary/[0.06] animate-fade-in"
              style={{ height: 44, animationDelay: `${120 + i * 35}ms` }}
            >
              <span className="h-2.5 w-16 rounded-full bg-primary/[0.06] shrink-0" />
              <span className={`block h-3 ${titleW} max-w-full ${BACKLOG_GHOST_BAR}`} />
              <span className="ml-auto h-2.5 w-20 rounded bg-primary/[0.06] shrink-0" />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
