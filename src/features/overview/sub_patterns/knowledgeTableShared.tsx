// Shared review mechanics for the Knowledge browser variants.
//
// The baseline binds everything (filters, comparator, bulk selection, columns)
// inline against FacetedDecisionTable. The directional variants replace only the
// NAVIGATION half of that surface, so the decision half lives here once and both
// variants — plus a future consolidated winner — bind to it identically.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Search, X } from 'lucide-react';

import type { DataGridBulkAction, DataGridColumn } from '@/features/shared/components/display/DataGrid';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import type { KnowledgeKind, KnowledgeStatus } from '@/api/devTools/workspaces';
import type { DevProject } from '@/lib/bindings/DevProject';
import { useTranslation } from '@/i18n/useTranslation';

import { KnowledgeStatusChip } from '@/features/plugins/dev-tools/sub_workspaces/centerShared';
import { reviewValue, STATUS_RANK, type KnowledgeItemView } from './libraryModel';

export const KIND_VALUES: KnowledgeKind[] = ['pattern', 'pitfall', 'decision', 'howto', 'fact'];
export const STATUS_VALUES: KnowledgeStatus[] = [
  'proposed',
  'observed',
  'adopted',
  'deprecated',
  'rejected',
];

export type SortDir = 'asc' | 'desc';

/** The props contract every variant (and the baseline) accepts, unchanged. */
export interface KnowledgeTreeProps {
  items: KnowledgeItemView[];
  projectById: Map<string, DevProject>;
  onBulkDecide?: (ids: string[], decision: 'adopt' | 'reject') => Promise<void>;
  onRowClick?: (item: KnowledgeItemView, ordered: KnowledgeItemView[]) => void;
}

/** Undecided — the only rows a batch adopt/reject may touch. */
export const isPending = (i: KnowledgeItemView) =>
  i.status === 'observed' || i.status === 'proposed';

/** Topic is `area/cluster`; the area is the first segment. */
export const areaOf = (i: KnowledgeItemView) => i.topic.split('/')[0] ?? '';

export type KnowledgeReviewState = ReturnType<typeof useKnowledgeReview>;

export function useKnowledgeReview({ items, projectById, onBulkDecide }: KnowledgeTreeProps) {
  const { t } = useTranslation();
  const tw = t.plugins.dev_tools.workspaces;

  const statusLabel: Record<KnowledgeStatus, string> = useMemo(
    () => ({
      observed: tw.status_observed,
      proposed: tw.status_proposed,
      adopted: tw.status_adopted,
      deprecated: tw.status_deprecated,
      rejected: tw.status_rejected,
    }),
    [tw],
  );
  const kindLabel: Record<KnowledgeKind, string> = useMemo(
    () => ({
      pattern: tw.kind_pattern,
      pitfall: tw.kind_pitfall,
      decision: tw.kind_decision,
      howto: tw.kind_howto,
      fact: tw.kind_fact,
    }),
    [tw],
  );

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [kindFilter, setKindFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [sortKey, setSortKey] = useState('value');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Only origins that actually occur in the corpus — a filter that can only
  // ever produce an empty table is noise, not a control.
  const projectOptions = useMemo(() => {
    const ids = new Set<string>();
    let hasWorkspaceLevel = false;
    for (const i of items) {
      if (i.originProjectId) ids.add(i.originProjectId);
      else hasWorkspaceLevel = true;
    }
    const opts = [...ids]
      .map((id) => ({ value: id, label: projectById.get(id)?.name ?? tw.origin_removed }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return [
      { value: 'all', label: tw.all_projects },
      ...(hasWorkspaceLevel ? [{ value: '', label: tw.origin_workspace }] : []),
      ...opts,
    ];
  }, [items, projectById, tw]);

  useEffect(() => {
    if (projectFilter !== 'all' && !projectOptions.some((o) => o.value === projectFilter)) {
      setProjectFilter('all');
    }
  }, [projectOptions, projectFilter]);

  const statusOptions = useMemo(
    () => [
      { value: 'all', label: tw.all_statuses },
      ...STATUS_VALUES.map((s) => ({ value: s, label: statusLabel[s] })),
    ],
    [tw, statusLabel],
  );
  const kindOptions = useMemo(
    () => [
      { value: 'all', label: tw.all_kinds },
      ...KIND_VALUES.map((k) => ({ value: k, label: kindLabel[k] })),
    ],
    [tw, kindLabel],
  );
  const sortOptions = useMemo(
    () => [
      { value: 'value', label: tw.sort_value },
      { value: 'updated', label: tw.col_updated },
      { value: 'title', label: tw.col_practice },
      { value: 'status', label: tw.col_status },
      { value: 'kind', label: tw.col_kind },
    ],
    [tw],
  );

  const filterRow = useCallback(
    (i: KnowledgeItemView) =>
      (statusFilter === 'all' || i.status === statusFilter) &&
      (kindFilter === 'all' || i.kind === kindFilter) &&
      (projectFilter === 'all' || (i.originProjectId ?? '') === projectFilter),
    [statusFilter, kindFilter, projectFilter],
  );

  const matchesQuery = useCallback(
    (i: KnowledgeItemView) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return [i.title, i.statement, i.topic].some((f) => f.toLowerCase().includes(q));
    },
    [query],
  );

  const compare = useCallback(
    (a: KnowledgeItemView, b: KnowledgeItemView): number => {
      const dir = sortDir === 'asc' ? 1 : -1;
      switch (sortKey) {
        case 'status':
          return (STATUS_RANK[a.status] - STATUS_RANK[b.status]) * dir;
        case 'kind':
          return a.kind.localeCompare(b.kind) * dir;
        case 'title':
          return a.title.localeCompare(b.title) * dir;
        case 'updated':
          return a.updatedAt.localeCompare(b.updatedAt) * dir;
        case 'value':
        default: {
          // Undecided first — a reviewed item is not competing for attention.
          const rank = (i: KnowledgeItemView) => (isPending(i) ? 0 : 1);
          const byPending = rank(a) - rank(b);
          if (byPending !== 0) return byPending;
          const byValue = (reviewValue(a) - reviewValue(b)) * dir;
          return byValue !== 0 ? byValue : a.updatedAt.localeCompare(b.updatedAt) * dir;
        }
      }
    },
    [sortKey, sortDir],
  );

  const onSort = useCallback(
    (key: string) => {
      if (key === sortKey) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortKey(key);
        setSortDir(key === 'title' ? 'asc' : 'desc');
      }
    },
    [sortKey],
  );
  const toggleSortDir = useCallback(() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')), []);

  const toggleRow = useCallback((row: KnowledgeItemView) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
  }, []);

  const bulk = useCallback(
    async (decision: 'adopt' | 'reject', ids: string[]) => {
      if (!onBulkDecide || ids.length === 0) return;
      setBulkBusy(true);
      try {
        await onBulkDecide(ids, decision);
        setSelected(new Set());
      } finally {
        setBulkBusy(false);
      }
    },
    [onBulkDecide],
  );

  /** Rows a variant is showing → the selection/bulk props DataGrid needs. */
  const selectionProps = useCallback(
    (rows: KnowledgeItemView[]) => {
      if (!onBulkDecide) return {};
      const selectableIds = rows.filter(isPending).map((i) => i.id);
      const allSelected =
        selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
      const actions: DataGridBulkAction[] = [
        {
          id: 'adopt',
          label: tw.bulk_adopt,
          icon: Check,
          disabled: bulkBusy,
          onClick: () => void bulk('adopt', [...selected]),
        },
        {
          id: 'reject',
          label: tw.bulk_reject,
          icon: X,
          variant: 'danger' as const,
          disabled: bulkBusy,
          onClick: () => void bulk('reject', [...selected]),
        },
      ];
      return {
        isRowSelected: (r: KnowledgeItemView) => selected.has(r.id),
        selectAll: allSelected,
        onSelectAll: () => setSelected(allSelected ? new Set() : new Set(selectableIds)),
        selectedCount: selected.size,
        onClearSelection: () => setSelected(new Set()),
        bulkActions: actions,
      };
    },
    [onBulkDecide, selected, bulkBusy, bulk, tw],
  );

  return {
    tw,
    query,
    setQuery,
    statusFilter,
    setStatusFilter,
    kindFilter,
    setKindFilter,
    projectFilter,
    setProjectFilter,
    statusOptions,
    kindOptions,
    projectOptions,
    sortOptions,
    sortKey,
    sortDir,
    onSort,
    toggleSortDir,
    statusLabel,
    kindLabel,
    filterRow,
    matchesQuery,
    compare,
    selected,
    toggleRow,
    selectionProps,
    hasBulk: !!onBulkDecide,
  };
}

/** scope → search → facet filters → sort. The one ordering every variant uses. */
export function applyView(
  items: KnowledgeItemView[],
  scope: (i: KnowledgeItemView) => boolean,
  state: Pick<KnowledgeReviewState, 'matchesQuery' | 'filterRow' | 'compare'>,
): KnowledgeItemView[] {
  return items
    .filter((i) => scope(i) && state.matchesQuery(i) && state.filterRow(i))
    .sort(state.compare);
}

/* -- toolbar --------------------------------------------------------------- */

/** Search + facet selects, with an optional explicit sort control for variants
 *  whose list has no column headers to sort from. */
export function PracticeFilters({
  state,
  showSort = false,
  showFacets = false,
}: {
  state: KnowledgeReviewState;
  showSort?: boolean;
  showFacets?: boolean;
}) {
  const { tw } = state;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground pointer-events-none" />
        <input
          className={`${INPUT_FIELD} pl-8 w-56`}
          placeholder={tw.search_practices}
          value={state.query}
          onChange={(e) => state.setQuery(e.target.value)}
        />
      </div>
      {showFacets && (
        <>
          <ThemedSelect
            filterable
            hideSearch
            options={state.statusOptions}
            value={state.statusFilter}
            onValueChange={state.setStatusFilter}
            placeholder={tw.all_statuses}
            aria-label={tw.all_statuses}
            className="typo-label !py-1 w-36"
          />
          <ThemedSelect
            filterable
            hideSearch
            options={state.kindOptions}
            value={state.kindFilter}
            onValueChange={state.setKindFilter}
            placeholder={tw.all_kinds}
            aria-label={tw.all_kinds}
            className="typo-label !py-1 w-32"
          />
        </>
      )}
      <ThemedSelect
        filterable
        hideSearch={state.projectOptions.length < 8}
        options={state.projectOptions}
        value={state.projectFilter}
        onValueChange={state.setProjectFilter}
        placeholder={tw.all_projects}
        aria-label={tw.filter_by_project}
        className="typo-label !py-1 w-44"
      />
      {showSort && (
        <div className="flex items-center gap-1">
          <ThemedSelect
            filterable
            hideSearch
            options={state.sortOptions}
            value={state.sortKey}
            onValueChange={state.onSort}
            placeholder={tw.sort_order}
            aria-label={tw.sort_order}
            className="typo-label !py-1 w-36"
          />
          <button
            type="button"
            onClick={state.toggleSortDir}
            aria-label={state.sortDir === 'asc' ? tw.sort_dir_asc : tw.sort_dir_desc}
            className="p-1.5 rounded-interactive border border-primary/12 text-foreground hover:bg-secondary/50 transition-colors focus-ring"
          >
            {state.sortDir === 'asc' ? (
              <ArrowUp className="w-3.5 h-3.5" />
            ) : (
              <ArrowDown className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      )}
    </div>
  );
}

/* -- columns --------------------------------------------------------------- */

/** The baseline's four-column practice grid, reusable by any variant that keeps
 *  a conventional row (status · kind · practice · updated). */
export function usePracticeColumns(state: KnowledgeReviewState) {
  const { tw, statusLabel, kindLabel } = state;
  return useMemo<DataGridColumn<KnowledgeItemView>[]>(
    () => [
      ...(state.hasBulk ? [selectColumn(state)] : []),
      {
        key: 'status',
        label: tw.col_status,
        width: '120px',
        sortable: true,
        filterOptions: state.statusOptions,
        filterValue: state.statusFilter,
        onFilterChange: state.setStatusFilter,
        render: (r: KnowledgeItemView) => (
          <KnowledgeStatusChip status={r.status} label={statusLabel[r.status]} />
        ),
      },
      {
        key: 'kind',
        label: tw.col_kind,
        width: '110px',
        sortable: true,
        filterOptions: state.kindOptions,
        filterValue: state.kindFilter,
        onFilterChange: state.setKindFilter,
        render: (r: KnowledgeItemView) => (
          <span className="typo-body text-foreground/90">{kindLabel[r.kind]}</span>
        ),
      },
      {
        key: 'title',
        label: tw.col_practice,
        width: 'minmax(0, 1fr)',
        sortable: true,
        render: (r: KnowledgeItemView) => (
          <span className="typo-body text-foreground truncate" title={r.statement}>
            {r.title}
          </span>
        ),
      },
      {
        key: 'updated',
        label: tw.col_updated,
        width: '96px',
        sortable: true,
        align: 'right' as const,
        render: (r: KnowledgeItemView) => (
          <RelativeTime timestamp={r.updatedAt} className="typo-caption" />
        ),
      },
    ],
    [state, tw, statusLabel, kindLabel],
  );
}

/** Checkbox cell — only undecided rows get one. */
export function selectColumn(state: KnowledgeReviewState): DataGridColumn<KnowledgeItemView> {
  return {
    key: 'select',
    label: '',
    width: '36px',
    render: (row: KnowledgeItemView) =>
      isPending(row) ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            state.toggleRow(row);
          }}
          aria-label={state.tw.bulk_select_row}
          aria-pressed={state.selected.has(row.id)}
          className={`w-4 h-4 shrink-0 rounded border transition-colors flex items-center justify-center focus-ring ${
            state.selected.has(row.id)
              ? 'bg-primary/80 border-primary/60'
              : 'border-primary/25 hover:border-primary/50'
          }`}
        >
          {state.selected.has(row.id) && <Check className="w-3 h-3 text-foreground" />}
        </button>
      ) : null,
  };
}
