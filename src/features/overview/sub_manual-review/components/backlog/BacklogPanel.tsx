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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';

import { nextQueueIndex } from '@/features/plugins/dev-tools/sub_workspaces/libraryModel';
// Cross-feature imports, precedented (see BacklogTable): these are the triage
// instruments the Idea Triage page owned. The page is gone; the instruments
// stay where they are defined and dock here instead of being copied.
import { EffortRiskFilter } from '@/features/plugins/dev-tools/sub_triage/EffortRiskFilter';
import { TriageRulesPanel } from '@/features/plugins/dev-tools/sub_triage/TriageRulesPanel';
import { SensorScoreboard } from '@/features/plugins/dev-tools/sub_triage/findings/SensorScoreboard';
import { SweepButton } from '@/features/plugins/dev-tools/sub_triage/findings/SweepButton';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';

import { BacklogDetailModal } from './BacklogDetailModal';
import { BacklogFocusDeck } from './BacklogFocusDeck';
import { BacklogTable } from './BacklogTable';
import { useCategoryLabel } from './backlogLabels';
import {
  applyBacklogSort,
  FULL_LEVEL_RANGE,
  hasLevelFilter,
  SORT_MODE_COLUMN,
  withinLevelRanges,
  type BacklogIdea,
  type BacklogSortMode,
  type LevelRange,
} from './backlogModel';
import type { BacklogQueue, BacklogStatus } from './useBacklogQueue';

const STATUSES: BacklogStatus[] = ['pending', 'accepted', 'rejected', 'archived'];
const SORT_MODES: BacklogSortMode[] = ['default', 'value', 'quick'];

type BacklogView = 'table' | 'focus';

export function BacklogPanel({ queue }: { queue: BacklogQueue }) {
  const { t, tx } = useTranslation();
  const r = t.overview.review;
  const categoryLabel = useCategoryLabel();
  const activeProjectId = useSystemStore((s) => s.activeProjectId);

  const [view, setView] = useState<BacklogView>('table');
  const [sortMode, setSortMode] = useState<BacklogSortMode>('default');
  const [effortRange, setEffortRange] = useState<LevelRange>(FULL_LEVEL_RANGE);
  const [riskRange, setRiskRange] = useState<LevelRange>(FULL_LEVEL_RANGE);
  const [levelsOpen, setLevelsOpen] = useState(false);
  const levelsRef = useRef<HTMLDivElement>(null);
  useClickOutside(levelsRef, levelsOpen, () => setLevelsOpen(false));

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

  // ONE derivation feeds both surfaces. The table further narrows it with its
  // own rail/search/column filters, but the row SET and the base ORDER are
  // decided here so the deck and the table are always looking at the same queue.
  const visibleRows = useMemo(
    () => applyBacklogSort(
      queue.rows.filter((i) => withinLevelRanges(i, effortRange, riskRange)),
      sortMode,
    ),
    [queue.rows, effortRange, riskRange, sortMode],
  );

  const byId = useMemo(
    () => new Map(visibleRows.map((i) => [i.id, i])),
    [visibleRows],
  );

  // Focus mode is a verdict surface: swiping an already-decided row would
  // silently re-decide it, so it only exists over the pending bucket.
  const focusAvailable = queue.status === 'pending';
  useEffect(() => {
    if (!focusAvailable) setView('table');
  }, [focusAvailable]);

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
      prev.size === visibleRows.length && visibleRows.length > 0
        ? new Set()
        : new Set(visibleRows.map((i) => i.id)),
    );
  }, [visibleRows]);

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

  // Sort pills + the effort/risk popover. Defined once, docked twice: into the
  // table's toolbar (right next to its search box) in table mode, and above the
  // deck in focus mode — the same controls in whichever place the eye already is.
  const levelFilterActive = hasLevelFilter(effortRange, riskRange);
  const sortControls = (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center gap-1">
        {SORT_MODES.map((mode) => {
          const active = sortMode === mode;
          const label = { default: r.backlog_sort_default, value: r.backlog_sort_value, quick: r.backlog_sort_quick }[mode];
          const tip = { default: undefined, value: r.backlog_sort_value_tip, quick: r.backlog_sort_quick_tip }[mode];
          return (
            <button
              key={mode}
              type="button"
              onClick={() => setSortMode(mode)}
              title={tip}
              aria-pressed={active}
              className={`typo-label rounded-card px-2 py-1 border transition-colors ${
                active
                  ? 'bg-primary/10 text-foreground border-primary/25'
                  : 'text-muted-foreground border-transparent hover:bg-primary/5'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div className="relative" ref={levelsRef}>
        <button
          type="button"
          onClick={() => setLevelsOpen((o) => !o)}
          aria-expanded={levelsOpen}
          title={r.backlog_levels_filter}
          aria-label={r.backlog_levels_filter}
          className={`flex items-center gap-1 typo-label rounded-card px-2 py-1 border transition-colors ${
            levelFilterActive
              ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
              : 'text-muted-foreground border-primary/15 hover:bg-primary/5'
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden />
          {r.backlog_levels_filter}
        </button>
        {levelsOpen && (
          <div className="absolute right-0 top-full mt-1 z-30 w-64 p-3 rounded-card border border-primary/15 bg-background shadow-elevation-3">
            <EffortRiskFilter
              effortRange={effortRange}
              riskRange={riskRange}
              onEffortChange={setEffortRange}
              onRiskChange={setRiskRange}
            />
          </div>
        )}
      </div>
    </div>
  );

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
        <div className="ml-auto flex items-center gap-2">
          <SweepButton projectId={activeProjectId} onSwept={queue.reload} />
          <SegmentedTabs<BacklogView>
            tabs={[
              { id: 'table', label: r.backlog_view_table },
              {
                id: 'focus',
                label: r.backlog_view_focus,
                disabled: !focusAvailable,
                ariaLabel: r.backlog_view_focus,
              },
            ]}
            activeTab={view}
            onTabChange={setView}
            ariaLabel={r.backlog_view_switch_label}
            variant="segment"
            size="sm"
            fullWidth={false}
            layoutId="backlog-view"
            idPrefix="backlog-view"
          />
          {queue.hasMore && (
            <button
              type="button"
              onClick={queue.loadMore}
              disabled={queue.loadingMore}
              className="typo-label rounded-interactive border border-primary/20 bg-primary/10 px-2.5 py-1 text-foreground hover:bg-primary/15 disabled:opacity-40 transition-colors"
            >
              {tx(r.backlog_load_more, { count: queue.rows.length })}
            </button>
          )}
        </div>
      </div>

      {/* Auto-triage rules — self-collapsing disclosure, project-scoped. */}
      {activeProjectId && <TriageRulesPanel projectId={activeProjectId} />}
      {/* Renders itself away until a sensor has actually raised something. */}
      <SensorScoreboard />

      <div className="flex-1 min-h-0">
        {queue.loading && queue.rows.length === 0 ? (
          <BacklogGhostRows />
        ) : view === 'focus' ? (
          <div className="h-full min-h-0 flex flex-col gap-2">
            <div className="flex justify-end">{sortControls}</div>
            <div className="flex-1 min-h-0">
              <BacklogFocusDeck
                rows={visibleRows}
                counts={queue.counts}
                categoryLabel={categoryLabel}
                busy={queue.actingId !== null}
                onAccept={queue.accept}
                onReject={queue.reject}
                onDelete={queue.remove}
              />
            </div>
          </div>
        ) : (
          <BacklogTable
            rows={visibleRows}
            projectOptions={queue.projectOptions}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
            onBulkAccept={() => bulkDecide('accept')}
            onBulkReject={() => bulkDecide('reject')}
            onClearSelection={clearSelection}
            onRowClick={openDetail}
            toolbar={sortControls}
            sortHint={SORT_MODE_COLUMN[sortMode]}
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
