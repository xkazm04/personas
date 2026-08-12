// Knowledge library — the CONSOLIDATED surface (Topics won round B). The table
// mechanics (derived topic rail + toolbar + paginated DataGrid) live in the
// shared FacetedDecisionTable; this file is the Workspaces-specific binding:
// columns, filters, comparator and i18n labels.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, CheckSquare, Library, Square, X } from 'lucide-react';

import { FacetedDecisionTable } from '@/features/shared/components/display/FacetedDecisionTable';
import type { DataGridColumn } from '@/features/shared/components/display/DataGrid';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import type { KnowledgeKind, KnowledgeStatus } from '@/api/devTools/workspaces';
import type { DevProject } from '@/lib/bindings/DevProject';
import { useTranslation } from '@/i18n/useTranslation';

import { KnowledgeStatusChip } from '@/features/plugins/dev-tools/sub_workspaces/centerShared';
import { isDirection, reviewValue, STATUS_RANK, type KnowledgeItemView } from './libraryModel';

const KIND_VALUES: KnowledgeKind[] = ['pattern', 'pitfall', 'decision', 'howto', 'fact'];
/**
 * The status filter's real axis is REVIEWED vs NOT — not the five-value
 * lifecycle. Measured on the live library: 349 `observed`, 168 `adopted`, 5
 * `rejected`, 1 `deprecated`, 0 `proposed`. Offering five options meant four of
 * them filtered to almost nothing, so the control looked useful and wasn't.
 * These three buckets each hold a real population and together cover every row.
 */
const STATUS_BUCKETS = {
  pending: ['observed', 'proposed'],
  adopted: ['adopted'],
  archived: ['rejected', 'deprecated'],
} as const satisfies Record<string, readonly KnowledgeStatus[]>;

type StatusBucket = keyof typeof STATUS_BUCKETS;

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

  // FIX 4: the rail encoded depth as indentation and nothing else, so a
  // 66-item area and a 10-item area were the same row with a different number.
  // `share` is the branch's size relative to its largest sibling at that depth
  // (drawn as a bar), `pending` is how much of it still needs a decision.
  // Computed once over the whole corpus, not per render of a node.
  const railMeta = useMemo(() => {
    const total = new Map<string, number>();
    const pending = new Map<string, number>();
    const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
    for (const i of items) {
      const undecided = i.status === 'observed' || i.status === 'proposed';
      const segs = String(i.topic ?? '').split('/').filter(Boolean);
      // Every ancestor path plus the root, so a parent's bar reflects its whole
      // subtree rather than only the rows filed directly on it.
      for (let n = 0; n <= segs.length; n += 1) {
        const path = segs.slice(0, n).join('/');
        bump(total, path);
        if (undecided) bump(pending, path);
      }
    }
    // Largest sibling per depth is the bar's denominator: comparing a cluster
    // against the whole corpus would make every cluster look like a sliver.
    const maxAtDepth = new Map<number, number>();
    for (const [path, n] of total) {
      if (path === '') continue;
      const d = path.split('/').length;
      maxAtDepth.set(d, Math.max(maxAtDepth.get(d) ?? 0, n));
    }
    return (path: string, count: number) => {
      if (path === '') return { share: 1, pending: pending.get('') ?? 0 };
      const peak = maxAtDepth.get(path.split('/').length) ?? count;
      return {
        share: peak > 0 ? count / peak : 0,
        pending: pending.get(path) ?? 0,
      };
    };
  }, [items]);

  const filterRow = useCallback(
    (i: KnowledgeItemView) =>
      (statusFilter === 'all' ||
        (STATUS_BUCKETS[statusFilter as StatusBucket] as readonly string[] | undefined)?.includes(
          i.status,
        ) === true) &&
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
          // Directions before techniques within the same review tier — the
          // inverted library opens on doctrine, and evidence is drilled into.
          const byTier = (isDirection(a) ? 0 : 1) - (isDirection(b) ? 0 : 1);
          if (byTier !== 0) return byTier;
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
        { value: 'pending', label: tw.filter_pending },
        { value: 'adopted', label: tw.filter_adopted },
        { value: 'archived', label: tw.filter_archived },
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
      // The STATEMENT is the practice. It used to live in `title={r.statement}`
      // — a native browser tooltip — so recognising a row meant hovering it one
      // at a time. Rendering it as a second line is the whole difference
      // between scanning a list of labels and reading a list of claims.
      render: (r) => (
        <span className="flex flex-col gap-0.5 min-w-0">
          <span className="flex items-center gap-1.5 min-w-0">
            {isDirection(r) && (
              <span className="typo-label flex-shrink-0 rounded-pill border border-primary/30 bg-primary/10 px-1.5 py-px text-primary">
                {tw.direction_badge}
              </span>
            )}
            <span className={`typo-body truncate ${isDirection(r) ? 'font-medium text-foreground' : 'text-foreground'}`}>
              {r.title}
            </span>
          </span>
          <span className="typo-caption text-foreground/70 line-clamp-2">{r.statement}</span>
        </span>
      ),
    },
    {
      // Prevalence was a 12px suffix glued to a truncating title, so the most
      // decision-relevant number in the row was the first thing to get cut off.
      // Its own sortable column means "which practices are everywhere?" is one
      // click rather than a read-every-row exercise.
      key: 'evidence',
      label: tw.col_evidence,
      width: '72px',
      sortable: true,
      align: 'right',
      render: (r) =>
        r.evidenceCount != null && r.evidenceCount > 0 ? (
          <Tooltip content={tx(tw.evidence_hint, { count: r.evidenceCount })}>
            <span className="typo-body text-foreground/80 tabular-nums">×{r.evidenceCount}</span>
          </Tooltip>
        ) : (
          <span className="typo-caption text-muted-foreground">—</span>
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
      nodeMeta={railMeta}
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
