// The dispatch panel's table — the shared FacetedDecisionTable bound to the
// ONE question the panel asks. The rail is projects, because a Fleet dispatch
// targets a project's directory: grouping by anything else would hide the axis
// the decision actually turns on.
import { useCallback, useMemo } from 'react';
import { CheckSquare, Inbox, Square, TimerOff } from 'lucide-react';

import { FacetedDecisionTable } from '@/features/shared/components/display/FacetedDecisionTable';
import type { DataGridColumn } from '@/features/shared/components/display/DataGrid';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { AttentionThresholds } from '@/lib/bindings/AttentionThresholds';

import {
  compareDispatch,
  dispatchGroupPath,
  dispatchHaystack,
  isStale,
  NO_PROJECT_SEGMENT,
  type DispatchRow,
} from './dispatchModel';

export function DispatchTable({
  rows,
  isLoading,
  thresholds,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
}: {
  rows: DispatchRow[];
  /**
   * The panel's cold-load flag. The shared grid ghosts under its permanent
   * column header only while `isLoading && rows.length === 0`, so a refetch
   * with rows on screen changes nothing (overview-loading laws 1 and 5).
   */
  isLoading?: boolean;
  thresholds: AttentionThresholds | null;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
}) {
  const { t, tx } = useTranslation();
  const c = t.chrome;

  const segmentLabel = useCallback(
    (segment: string) => (segment === NO_PROJECT_SEGMENT ? c.dispatch_project_none : segment),
    [c.dispatch_project_none],
  );

  const columns: DataGridColumn<DispatchRow>[] = useMemo(() => [
    {
      key: 'select',
      label: '',
      width: '40px',
      // The label names the ROW. "Select this idea" repeated down a column is
      // an announcement a screen-reader user cannot act on.
      render: (row) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleSelect(row.id); }}
          aria-label={tx(c.dispatch_select_row, { title: row.title })}
          aria-pressed={selectedIds.has(row.id)}
          className="text-foreground hover:text-primary transition-colors"
        >
          {selectedIds.has(row.id)
            ? <CheckSquare className="w-3.5 h-3.5 text-primary" />
            : <Square className="w-3.5 h-3.5" />}
        </button>
      ),
    },
    {
      key: 'title',
      label: c.dispatch_col_idea,
      width: 'minmax(0, 1fr)',
      render: (row) => (
        <span className="flex items-center gap-2 min-w-0">
          <span className="typo-body text-foreground truncate min-w-0" title={row.title}>
            {row.title}
          </span>
          {/* Glyph + word, never colour alone: the whole point of the row is
              that it is DIFFERENT, and a reader who cannot see the hue has to
              get the same answer (WCAG 1.4.1). */}
          {row.undispatched && (
            <span
              data-testid={`dispatch-row-undispatched-${row.id}`}
              className="shrink-0 inline-flex items-center gap-1 rounded-card border border-status-warning/30 bg-status-warning/10 px-1.5 py-0.5 typo-caption text-status-warning"
            >
              <TimerOff className="w-3 h-3" aria-hidden />
              {isStale(row, thresholds) && thresholds
                ? tx(c.dispatch_tag_stale, { days: thresholds.ideaDispatchDays })
                : c.dispatch_tag_never_sent}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'waiting',
      label: c.dispatch_col_waiting,
      width: '104px',
      align: 'right',
      render: (row) => (
        // The age is the BACKEND's — `accepted_at` as the undispatched query
        // reported it, not a timestamp this panel re-derived from the idea row.
        row.acceptedAt ? (
          <RelativeTime
            timestamp={row.acceptedAt}
            className="typo-caption text-foreground"
          />
        ) : (
          <Tooltip content={c.dispatch_waiting_none_hint}>
            <span className="typo-caption text-foreground">{c.dispatch_waiting_none}</span>
          </Tooltip>
        )
      ),
    },
  ], [c, tx, thresholds, selectedIds, onToggleSelect]);

  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));

  return (
    <FacetedDecisionTable
      items={rows}
      isLoading={isLoading}
      getRowKey={(r) => r.id}
      getGroupPath={dispatchGroupPath}
      columns={columns}
      searchHaystack={dispatchHaystack}
      compare={compareDispatch}
      emptyIcon={Inbox}
      pageSize={25}
      density="compact"
      formatSegment={segmentLabel}
      labels={{
        allGroups: c.dispatch_all_projects,
        summary: (group, count) =>
          group
            ? tx(c.dispatch_group_summary, { group: segmentLabel(group), count })
            : tx(c.dispatch_all_summary, { count }),
        searchPlaceholder: c.dispatch_search,
        expand: c.dispatch_expand,
        collapse: c.dispatch_collapse,
        emptyTitle: c.dispatch_empty_title,
        emptyDescription: c.dispatch_empty_subtitle,
      }}
      isRowSelected={(r) => selectedIds.has(r.id)}
      selectAll={allSelected}
      onSelectAll={onToggleSelectAll}
      selectedCount={selectedIds.size}
    />
  );
}
