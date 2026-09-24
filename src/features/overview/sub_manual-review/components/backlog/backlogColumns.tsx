// The Backlog table's columns, split out of BacklogTable.tsx (Gate 2).
//
// The Idea cell is two lines: the title on its own line (the row's identity,
// one line, full text in a Tooltip when cut), then the sensor badge and the
// description as a muted caption. A description that merely repeats the title
// loses that prefix; one that is nothing but the title is not shown at all.
import { useMemo } from 'react';
import { CheckSquare, Square } from 'lucide-react';

import type { DataGridColumn } from '@/features/shared/components/display/DataGrid';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { TruncateWithTooltip } from '@/features/shared/components/display/TruncateWithTooltip';
// Cross-feature import, precedented: the sensor palette is defined once next to
// the badge that renders it, and the Backlog must label origins identically to
// the findings surfaces or the same sensor reads as two different things.
import { FindingBadge } from '@/features/plugins/dev-tools/sub_triage/findings/FindingBadge';
import type { Translations } from '@/i18n/en';

import type { BacklogIdea } from './backlogModel';

/** Separators a description tends to put after a repeated title: space, `.`, `:`, `;`, `,`, hyphen, en and em dash. */
const LEADING_SEPARATORS = /^[\s.:;,\-–—]+/;

/** The description without a leading copy of the title; '' when nothing else is left. */
export function descriptionAfterTitle(description: string, title: string): string {
  const d = description.trim();
  const t = title.trim();
  if (!t || !d.toLowerCase().startsWith(t.toLowerCase())) return d;
  return d.slice(t.length).replace(LEADING_SEPARATORS, '').trim();
}

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
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleSelect(row.id); }}
            aria-label={r.backlog_select_row}
            aria-pressed={selectedIds.has(row.id)}
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
        render: (row) => {
          const detail = descriptionAfterTitle(row.description, row.title);
          return (
            <span className="flex flex-col gap-1 min-w-0 w-full py-0.5">
              <TruncateWithTooltip text={row.title} className="typo-body text-foreground min-w-0" />
              {(row.origin || detail) && (
                <span className="flex items-center gap-2 min-w-0">
                  {row.origin && (
                    <span onClick={(e) => e.stopPropagation()} className="shrink-0">
                      <FindingBadge origin={row.origin} evidence={row.evidence} />
                    </span>
                  )}
                  {detail && <span className="typo-caption truncate min-w-0">{detail}</span>}
                </span>
              )}
            </span>
          );
        },
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
