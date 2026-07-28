// The Backlog's table view — the Approvals binding of the shared
// FacetedDecisionTable (the same engine the Workspaces knowledge library runs
// on). The rail is the taxonomy the data actually has: category, then the
// sensor that raised the finding. Classic scanner ideas carry no origin, so
// they sit on the category node itself rather than under a fake "scanner"
// child.
//
// Columns are deliberately few — fewer still after the truncation fix: with
// select + category + project + value + created all fixed-width, the flexible
// Idea column collapsed to a few px inside the Approvals panel. Category
// already lives in the left rail (the group tree IS the category filter) and
// the value score stays reachable via the sort pills and the ledger, so both
// columns are gone and the Idea column gets the room the content needs.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Check, CheckSquare, ScanSearch, Square, X } from 'lucide-react';

import { FacetedDecisionTable } from '@/features/shared/components/display/FacetedDecisionTable';
import type { DataGridBulkAction, DataGridColumn } from '@/features/shared/components/display/DataGrid';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
// Cross-feature import, precedented: the sensor palette is defined once next to
// the badge that renders it, and the Backlog must label origins identically to
// the findings surfaces or the same sensor reads as two different things.
import { FindingBadge, useOriginLabel } from '@/features/plugins/dev-tools/sub_triage/findings/FindingBadge';
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
import { useCategoryLabel } from './backlogLabels';

export function BacklogTable({
  rows,
  projectOptions,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onBulkAccept,
  onBulkReject,
  onBulkAthena,
  onClearSelection,
  onRowClick,
  toolbar,
  sortHint,
}: {
  rows: BacklogIdea[];
  projectOptions: { value: string; label: string }[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onBulkAccept: () => void;
  onBulkReject: () => void;
  /** Send the current selection to Athena for one batch verdict. */
  onBulkAthena: () => void;
  onClearSelection: () => void;
  /** Receives the clicked row plus the CURRENT visible ordering (queue contract). */
  onRowClick: (row: BacklogIdea, ordered: BacklogIdea[]) => void;
  toolbar?: React.ReactNode;
  /** Panel-level sort pill, mirrored onto the column sort so the two agree.
   *  The user can still override it by clicking any column header. */
  sortHint?: { key: BacklogSortKey; dir: SortDir };
}) {
  const { t, tx } = useTranslation();
  const r = t.overview.review;

  const categoryLabel = useCategoryLabel();
  const originLabel = useOriginLabel();

  const [projectFilter, setProjectFilter] = useState('all');
  const [sortKey, setSortKey] = useState<BacklogSortKey>(sortHint?.key ?? 'created');
  const [sortDir, setSortDir] = useState<SortDir>(sortHint?.dir ?? 'desc');

  // Adopt the panel's sort pill whenever it changes. Deliberately NOT a
  // controlled prop: once the pill has been applied, clicking a column header
  // still wins until the pill moves again.
  const hintKey = sortHint?.key;
  const hintDir = sortHint?.dir;
  useEffect(() => {
    if (!hintKey || !hintDir) return;
    setSortKey(hintKey);
    setSortDir(hintDir);
  }, [hintKey, hintDir]);

  const filterRow = useCallback(
    (i: BacklogIdea) => projectFilter === 'all' || (i.projectId ?? '') === projectFilter,
    [projectFilter],
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
      setSortDir(key === 'title' || key === 'project' ? 'asc' : 'desc');
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
      key: 'title',
      label: r.backlog_col_title,
      width: 'minmax(0, 1fr)',
      sortable: true,
      render: (row) => (
        <span className="flex items-center gap-2 min-w-0">
          <span className="typo-body text-foreground truncate min-w-0" title={row.title}>
            {row.title}
          </span>
          {row.origin && (
            <span onClick={(e) => e.stopPropagation()} className="shrink-0">
              <FindingBadge origin={row.origin} evidence={row.evidence} />
            </span>
          )}
          {/* basis-0 + grow: the snippet only ever fills space the title and
              badge left over — the headline is the row's identity and wins. */}
          {row.description && (
            <span
              className="typo-caption text-muted-foreground truncate min-w-0 flex-1 basis-0"
              title={row.description}
            >
              {row.description}
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
      key: 'created',
      label: r.backlog_col_created,
      width: '96px',
      sortable: true,
      align: 'right',
      render: (row) => (
        <RelativeTime timestamp={row.createdAt} className="typo-caption text-muted-foreground" />
      ),
    },
  ], [r, projectFilter, projectOptions, selectedIds, onToggleSelect]);

  const bulkActions: DataGridBulkAction[] = [
    { id: 'accept', label: r.backlog_bulk_accept, icon: Check, onClick: onBulkAccept },
    { id: 'reject', label: r.backlog_bulk_reject, icon: X, variant: 'danger', onClick: onBulkReject },
    { id: 'athena', label: r.backlog_athena_send, icon: Bot, onClick: onBulkAthena },
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
        isOriginSegment(path) ? originLabel(segment) : categoryLabel(segment)
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
