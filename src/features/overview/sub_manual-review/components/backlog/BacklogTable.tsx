// The Backlog's table view — the Approvals binding of the shared
// FacetedDecisionTable (the same engine the Workspaces knowledge library runs
// on). The rail is the taxonomy the data actually has: category, then the
// sensor that raised the finding. Classic scanner ideas carry no origin, so
// they sit on the category node itself rather than under a fake "scanner"
// child.
//
// Columns are deliberately few. Reasoning, evidence and the E/I/R breakdown are
// review detail — they live in the ledger, not here, or the title column starves.
import { useCallback, useMemo, useState } from 'react';
import { Check, CheckSquare, ScanSearch, Square, X } from 'lucide-react';

import { FacetedDecisionTable } from '@/features/shared/components/display/FacetedDecisionTable';
import type { DataGridBulkAction, DataGridColumn } from '@/features/shared/components/display/DataGrid';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { CATEGORY_TW, DEFAULT_CATEGORY_TW } from '@/features/plugins/dev-tools/constants/ideaColors';
// Cross-feature import, precedented: the sensor palette is defined once next to
// the badge that renders it, and the Backlog must label origins identically to
// the findings surfaces or the same sensor reads as two different things.
import { FindingBadge, originMeta } from '@/features/plugins/dev-tools/sub_triage/findings/FindingBadge';
import { ValueBadge } from '@/features/plugins/dev-tools/sub_scanner/IdeaScannerCards';
import { useTranslation } from '@/i18n/useTranslation';

import {
  backlogGroupPath,
  backlogHaystack,
  compareBacklog,
  isOriginSegment,
  type BacklogIdea,
  type BacklogSortKey,
  type SortDir,
} from './backlogModel';
import { BACKLOG_CATEGORY_KEYS, useCategoryLabel } from './backlogLabels';

export function BacklogTable({
  rows,
  projectOptions,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onBulkAccept,
  onBulkReject,
  onClearSelection,
  onRowClick,
  toolbar,
}: {
  rows: BacklogIdea[];
  projectOptions: { value: string; label: string }[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onBulkAccept: () => void;
  onBulkReject: () => void;
  onClearSelection: () => void;
  /** Receives the clicked row plus the CURRENT visible ordering (queue contract). */
  onRowClick: (row: BacklogIdea, ordered: BacklogIdea[]) => void;
  toolbar?: React.ReactNode;
}) {
  const { t, tx } = useTranslation();
  const r = t.overview.review;

  const categoryLabel = useCategoryLabel();

  const [categoryFilter, setCategoryFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [sortKey, setSortKey] = useState<BacklogSortKey>('created');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const filterRow = useCallback(
    (i: BacklogIdea) =>
      (categoryFilter === 'all' || i.category === categoryFilter) &&
      (projectFilter === 'all' || (i.projectId ?? '') === projectFilter),
    [categoryFilter, projectFilter],
  );

  const compare = useCallback(
    (a: BacklogIdea, b: BacklogIdea) => compareBacklog(a, b, sortKey, sortDir),
    [sortKey, sortDir],
  );

  const onSort = (key: string) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key as BacklogSortKey);
      // Text sorts read best A→Z; scores and dates read best best/newest-first.
      setSortDir(key === 'title' || key === 'project' || key === 'category' ? 'asc' : 'desc');
    }
  };

  const allSelected = rows.length > 0 && rows.every((i) => selectedIds.has(i.id));

  const columns: DataGridColumn<BacklogIdea>[] = useMemo(() => [
    {
      key: 'select',
      label: '',
      width: '40px',
      render: (row) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleSelect(row.id); }}
          aria-label={r.backlog_select_row}
          aria-pressed={selectedIds.has(row.id)}
          title={r.backlog_select_row}
          className="text-foreground/60 hover:text-primary transition-colors"
        >
          {selectedIds.has(row.id)
            ? <CheckSquare className="w-3.5 h-3.5 text-primary" />
            : <Square className="w-3.5 h-3.5" />}
        </button>
      ),
    },
    {
      key: 'category',
      label: r.backlog_col_category,
      width: '132px',
      sortable: true,
      filterOptions: [
        { value: 'all', label: r.backlog_all_categories },
        ...BACKLOG_CATEGORY_KEYS.map((k) => ({ value: k, label: categoryLabel(k) })),
      ],
      filterValue: categoryFilter,
      onFilterChange: setCategoryFilter,
      render: (row) => {
        const tw = CATEGORY_TW[row.category] ?? DEFAULT_CATEGORY_TW;
        return (
          <span className={`typo-label rounded-full px-2 py-0.5 border ${tw.bg} ${tw.text} ${tw.border}`}>
            {categoryLabel(row.category)}
          </span>
        );
      },
    },
    {
      key: 'title',
      label: r.backlog_col_title,
      width: 'minmax(0, 1fr)',
      sortable: true,
      render: (row) => (
        <span className="flex items-center gap-2 min-w-0">
          <span className="typo-body text-foreground truncate" title={row.description || row.title}>
            {row.title}
          </span>
          {row.origin && (
            <span onClick={(e) => e.stopPropagation()} className="shrink-0">
              <FindingBadge origin={row.origin} evidence={row.evidence} />
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'project',
      label: r.backlog_col_project,
      width: '150px',
      sortable: true,
      filterOptions: [
        { value: 'all', label: r.backlog_all_projects },
        ...projectOptions,
      ],
      filterValue: projectFilter,
      onFilterChange: setProjectFilter,
      render: (row) => (
        <span className="typo-body text-muted-foreground truncate">
          {row.projectName || r.backlog_project_none}
        </span>
      ),
    },
    {
      key: 'value',
      label: r.backlog_col_value,
      width: '190px',
      sortable: true,
      render: (row) => (
        <span className="flex items-center gap-1.5 min-w-0">
          <ValueBadge idea={row} />
          <span
            className="typo-caption text-muted-foreground tabular-nums whitespace-nowrap"
            title={`${r.backlog_effort_title} · ${r.backlog_impact_title} · ${r.backlog_risk_title}`}
          >
            E{row.effort} I{row.impact} R{row.risk}
          </span>
        </span>
      ),
    },
    {
      key: 'created',
      label: r.backlog_col_created,
      width: '96px',
      sortable: true,
      align: 'right',
      render: (row) => (
        <RelativeTime timestamp={row.createdAt} className="typo-caption text-muted-foreground" />
      ),
    },
  ], [r, categoryLabel, categoryFilter, projectFilter, projectOptions, selectedIds, onToggleSelect]);

  const bulkActions: DataGridBulkAction[] = [
    { id: 'accept', label: r.backlog_bulk_accept, icon: Check, onClick: onBulkAccept },
    { id: 'reject', label: r.backlog_bulk_reject, icon: X, variant: 'danger', onClick: onBulkReject },
    // "Send to Athena" docks here in P8.
  ];

  return (
    <FacetedDecisionTable
      items={rows}
      getRowKey={(i) => i.id}
      getGroupPath={backlogGroupPath}
      columns={columns}
      filterRow={filterRow}
      searchHaystack={backlogHaystack}
      sortKey={sortKey}
      sortDir={sortDir}
      onSort={onSort}
      compare={compare}
      onRowClick={onRowClick}
      toolbar={toolbar}
      emptyIcon={ScanSearch}
      pageSize={25}
      density="compact"
      formatSegment={(segment, path) =>
        isOriginSegment(path) ? originMeta(segment)?.label ?? segment : categoryLabel(segment)
      }
      labels={{
        allGroups: r.backlog_all_groups,
        summary: (group, count) =>
          group
            ? tx(r.backlog_group_summary, { group, count })
            : tx(r.backlog_all_summary, { count }),
        searchPlaceholder: r.backlog_search,
        expand: r.backlog_expand,
        collapse: r.backlog_collapse,
        emptyTitle: r.backlog_empty_title,
        emptyDescription: r.backlog_empty_subtitle,
      }}
      isRowSelected={(i) => selectedIds.has(i.id)}
      selectAll={allSelected}
      onSelectAll={onToggleSelectAll}
      selectedCount={selectedIds.size}
      bulkActions={bulkActions}
      onClearSelection={onClearSelection}
    />
  );
}
