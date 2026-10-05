// The Backlog table's columns, split out of BacklogTable.tsx (Gate 2).
//
// The Idea cell is ONE line: the title, full text in a Tooltip when cut. It was
// two — a sensor badge and a description caption underneath — and the second line
// was removed on operator instruction (2026-10-05): the descriptions it rendered
// come from five producers writing five different shapes (87% of pending items
// are unstructured prose), so the caption was a per-row lottery rather than a
// column. Origin stays reachable: the left rail groups by category then sensor,
// and the detail ledger carries the badge, the evidence and the full body.
import { useMemo } from 'react';
import { CheckSquare, Square } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import type { DataGridColumn } from '@/features/shared/components/display/DataGrid';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { TruncateWithTooltip } from '@/features/shared/components/display/TruncateWithTooltip';
import type { Translations } from '@/i18n/en';

import type { BacklogIdea } from './backlogModel';

export function useBacklogColumns({
  r,
  selectedIds,
  onToggleSelect,
  showProject,
  projectFilter,
  projectOptions,
  onProjectFilter,
}: {
  r: Translations['overview']['review'];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  /** False when the loaded rows span one project: the column would repeat one name. */
  showProject: boolean;
  projectFilter: string;
  projectOptions: { value: string; label: string }[];
  onProjectFilter: (value: string) => void;
}): DataGridColumn<BacklogIdea>[] {
  return useMemo(() => {
    const cols: DataGridColumn<BacklogIdea>[] = [
      {
        key: 'select',
        label: '',
        width: '40px',
        render: (row) => (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => { e.stopPropagation(); onToggleSelect(row.id); }}
            aria-label={r.backlog_select_row}
            aria-pressed={selectedIds.has(row.id)}
          >
            {selectedIds.has(row.id)
              ? <CheckSquare className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
              : <Square className="w-3.5 h-3.5" aria-hidden="true" />}
          </Button>
        ),
      },
      {
        key: 'title',
        label: r.backlog_col_title,
        width: 'minmax(0, 1fr)',
        sortable: true,
        render: (row) => (
          <TruncateWithTooltip text={row.title} className="typo-body text-foreground min-w-0 w-full" />
        ),
      },
    ];
    if (showProject) {
      cols.push({
        key: 'project',
        label: r.backlog_col_project,
        width: '160px',
        sortable: true,
        filterOptions: [{ value: 'all', label: r.backlog_all_projects }, ...projectOptions],
        filterValue: projectFilter,
        onFilterChange: onProjectFilter,
        render: (row) => (
          <span className="typo-caption truncate">{row.projectName || r.backlog_project_none}</span>
        ),
      });
    }
    cols.push({
      key: 'created',
      label: r.backlog_col_created,
      width: '96px',
      sortable: true,
      align: 'right',
      nowrap: true,
      // `elapsed` ("8 min", "21 hr"): one line in a fixed width; the column head
      // already says Raised, and the Tooltip carries the full date.
      render: (row) => (
        <RelativeTime timestamp={row.createdAt} format="elapsed" className="typo-caption tabular-nums" />
      ),
    });
    return cols;
  }, [r, selectedIds, onToggleSelect, showProject, projectFilter, projectOptions, onProjectFilter]);
}
