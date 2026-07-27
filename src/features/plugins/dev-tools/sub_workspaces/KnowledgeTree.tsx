// Knowledge library — the CONSOLIDATED surface (Topics won round B). The table
// mechanics (derived topic rail + toolbar + paginated DataGrid) live in the
// shared FacetedDecisionTable; this file is the Workspaces-specific binding:
// columns, filters, comparator and i18n labels.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, CheckSquare, Library, Square, X } from 'lucide-react';

import { FacetedDecisionTable } from '@/features/shared/components/display/FacetedDecisionTable';
import type { DataGridColumn } from '@/features/shared/components/display/DataGrid';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import type { KnowledgeKind, KnowledgeStatus } from '@/api/devTools/workspaces';
import type { DevProject } from '@/lib/bindings/DevProject';
import { useTranslation } from '@/i18n/useTranslation';

import { KnowledgeStatusChip } from './centerShared';
import { reviewValue, STATUS_RANK, type KnowledgeItemView } from './libraryModel';

const KIND_VALUES: KnowledgeKind[] = ['pattern', 'pitfall', 'decision', 'howto', 'fact'];
const STATUS_VALUES: KnowledgeStatus[] = ['proposed', 'observed', 'adopted', 'deprecated', 'rejected'];

type SortDir = 'asc' | 'desc';

const groupPath = (i: KnowledgeItemView) => i.topic;
const haystack = (i: KnowledgeItemView) => [i.title, i.statement, i.topic];

export default function KnowledgeTree({
  items,
  projectById,
  onRowClick,
  onBulkDecide,
}: {
  items: KnowledgeItemView[];
  projectById: Map<string, DevProject>;
  /** Adjudicate the current selection. Absent = selection UI stays off. */
  onBulkDecide?: (ids: string[], decision: 'adopt' | 'reject') => Promise<void>;
  /** Open the practice's detail/review surface. Receives the CURRENT visible
   *  ordering alongside the clicked row so the modal can walk the same queue
   *  the user is looking at — filters, sort and search included. */
  onRowClick?: (item: KnowledgeItemView, ordered: KnowledgeItemView[]) => void;
}) {
  const { t, tx } = useTranslation();
  const tw = t.plugins.dev_tools.workspaces;
  const statusLabel: Record<KnowledgeStatus, string> = {
    observed: tw.status_observed,
    proposed: tw.status_proposed,
    adopted: tw.status_adopted,
    deprecated: tw.status_deprecated,
    rejected: tw.status_rejected,
  };
  const kindLabel: Record<KnowledgeKind, string> = {
    pattern: tw.kind_pattern,
    pitfall: tw.kind_pitfall,
    decision: tw.kind_decision,
    howto: tw.kind_howto,
    fact: tw.kind_fact,
  };
  const [statusFilter, setStatusFilter] = useState('all');
  const [kindFilter, setKindFilter] = useState('all');
  // Origin filter: which member repo a practice was harvested from. '' is the
  // workspace itself (hand-authored, no origin project).
  const [projectFilter, setProjectFilter] = useState('all');
  // Default to review VALUE, not ingest order: at a few hundred pending items
  // the order decides what gets adjudicated before attention runs out.
  const [sortKey, setSortKey] = useState('value');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  // Bulk review. Only UNDECIDED rows are selectable — "adopt" on something
  // already rejected is not a batch operation, it is a mistake.
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
  }, [items, projectById, tw.all_projects, tw.origin_removed, tw.origin_workspace]);

  // A workspace whose corpus loses its last row from the filtered project would
  // otherwise strand the user on an empty table with no obvious way back.
  useEffect(() => {
    if (projectFilter !== 'all' && !projectOptions.some((o) => o.value === projectFilter)) {
      setProjectFilter('all');
    }
  }, [projectOptions, projectFilter]);

  const filterRow = useCallback(
    (i: KnowledgeItemView) =>
      (statusFilter === 'all' || i.status === statusFilter) &&
      (kindFilter === 'all' || i.kind === kindFilter) &&
      (projectFilter === 'all' || (i.originProjectId ?? '') === projectFilter),
    [statusFilter, kindFilter, projectFilter],
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
          const pending = (i: KnowledgeItemView) =>
            i.status === 'observed' || i.status === 'proposed' ? 0 : 1;
          const byPending = pending(a) - pending(b);
          if (byPending !== 0) return byPending;
          const byValue = (reviewValue(a) - reviewValue(b)) * dir;
          return byValue !== 0 ? byValue : a.updatedAt.localeCompare(b.updatedAt) * dir;
        }
      }
    },
    [sortKey, sortDir],
  );

  const pending = useCallback(
    (i: KnowledgeItemView) => i.status === 'observed' || i.status === 'proposed',
    [],
  );
  // Everything the current filters expose, so select-all means "all of what I
  // am looking at" — not all of what happens to be on this page.
  const selectablePendingIds = useMemo(
    () => items.filter((i) => pending(i) && filterRow(i)).map((i) => i.id),
    [items, pending, filterRow],
  );
  const allSelected =
    selectablePendingIds.length > 0 && selectablePendingIds.every((id) => selected.has(id));

  const toggleRow = useCallback((row: KnowledgeItemView) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
  }, []);

  const bulk = async (decision: 'adopt' | 'reject') => {
    if (!onBulkDecide || selected.size === 0) return;
    setBulkBusy(true);
    try {
      await onBulkDecide([...selected], decision);
      setSelected(new Set());
    } finally {
      setBulkBusy(false);
    }
  };

  const onSort = (key: string) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'title' ? 'asc' : 'desc');
    }
  };

  // Four columns only. Topic lives in the left tree, and origin / altitude /
  // confidence are review detail — carrying them here starved the Practice
  // column until titles were unreadable. They all surface in the detail modal.
  const columns: DataGridColumn<KnowledgeItemView>[] = [
    // Only present when bulk review is wired, and only undecided rows get a
    // box: batch-adopting something already rejected is a mistake, not a
    // shortcut.
    ...(onBulkDecide
      ? [
          {
            key: 'select',
            label: '',
            width: '36px',
            render: (row: KnowledgeItemView) =>
              pending(row) ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleRow(row);
                  }}
                  aria-label={tw.bulk_select_row}
                  aria-pressed={selected.has(row.id)}
                  title={tw.bulk_select_row}
                  className="text-foreground/60 hover:text-primary transition-colors"
                >
                  {selected.has(row.id) ? (
                    <CheckSquare className="w-3.5 h-3.5 text-primary" />
                  ) : (
                    <Square className="w-3.5 h-3.5" />
                  )}
                </button>
              ) : null,
          } as DataGridColumn<KnowledgeItemView>,
        ]
      : []),
    {
      key: 'status',
      label: tw.col_status,
      width: '120px',
      sortable: true,
      filterOptions: [
        { value: 'all', label: tw.all_statuses },
        ...STATUS_VALUES.map((s) => ({ value: s, label: statusLabel[s] })),
      ],
      filterValue: statusFilter,
      onFilterChange: setStatusFilter,
      render: (r) => <KnowledgeStatusChip status={r.status} label={statusLabel[r.status]} />,
    },
    {
      key: 'kind',
      label: tw.col_kind,
      width: '110px',
      sortable: true,
      filterOptions: [
        { value: 'all', label: tw.all_kinds },
        ...KIND_VALUES.map((k) => ({ value: k, label: kindLabel[k] })),
      ],
      filterValue: kindFilter,
      onFilterChange: setKindFilter,
      render: (r) => <span className="typo-body text-muted-foreground">{kindLabel[r.kind]}</span>,
    },
    {
      key: 'title',
      label: tw.col_practice,
      width: 'minmax(0, 1fr)',
      sortable: true,
      render: (r) => (
        <span className="typo-body text-foreground" title={r.statement}>
          {r.title}
          {r.evidenceCount != null && r.evidenceCount > 1 && (
            <span className="typo-label text-muted-foreground ml-1.5">×{r.evidenceCount}</span>
          )}
        </span>
      ),
    },
    {
      key: 'updated',
      label: tw.col_updated,
      width: '96px',
      sortable: true,
      align: 'right',
      render: (r) => (
        <RelativeTime timestamp={r.updatedAt} className="typo-caption text-muted-foreground" />
      ),
    },
  ];

  return (
    <FacetedDecisionTable
      items={items}
      getRowKey={(r) => r.id}
      getGroupPath={groupPath}
      columns={columns}
      filterRow={filterRow}
      searchHaystack={haystack}
      sortKey={sortKey}
      sortDir={sortDir}
      onSort={onSort}
      compare={compare}
      onRowClick={onRowClick}
      isRowSelected={onBulkDecide ? (r) => selected.has(r.id) : undefined}
      selectAll={allSelected}
      onSelectAll={
        onBulkDecide
          ? () => setSelected(allSelected ? new Set() : new Set(selectablePendingIds))
          : undefined
      }
      selectedCount={selected.size}
      onClearSelection={() => setSelected(new Set())}
      bulkActions={
        onBulkDecide
          ? [
              {
                id: 'adopt',
                label: tw.bulk_adopt,
                icon: Check,
                disabled: bulkBusy,
                onClick: () => void bulk('adopt'),
              },
              {
                id: 'reject',
                label: tw.bulk_reject,
                icon: X,
                variant: 'danger' as const,
                disabled: bulkBusy,
                onClick: () => void bulk('reject'),
              },
            ]
          : undefined
      }
      emptyIcon={Library}
      pageSize={25}
      density="compact"
      labels={{
        allGroups: tw.all_topics,
        summary: (topic, count) =>
          topic ? tx(tw.branch_summary, { topic, count }) : tx(tw.all_topics_summary, { count }),
        searchPlaceholder: tw.search_practices,
        expand: tw.expand,
        collapse: tw.collapse,
        emptyTitle: tw.library_empty_title,
        emptyDescription: tw.library_empty_desc,
      }}
      toolbar={
        <ThemedSelect
          filterable
          hideSearch={projectOptions.length < 8}
          options={projectOptions}
          value={projectFilter}
          onValueChange={setProjectFilter}
          placeholder={tw.all_projects}
          aria-label={tw.filter_by_project}
          wrapperClassName="ml-auto"
          className="typo-label !py-1 w-44"
        />
      }
    />
  );
}
