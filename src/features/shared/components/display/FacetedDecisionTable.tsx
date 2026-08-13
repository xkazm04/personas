/**
 * @catalog Left group-rail + toolbar + DataGrid table over a derived slash-path facet tree.
 *
 * The rail renders whatever slash-path hierarchy the data actually contains
 * (arbitrary depth, counts bubbled up, nothing hardcoded); the right pane lists
 * the selected branch through the shared DataGrid — paginated, per-column
 * sortable/filterable, so it stays crisp at hundreds of rows.
 *
 * Fully domain-agnostic: rows, columns, the group accessor, the search haystack,
 * the comparator and every label are injected. Summary labels arrive as
 * FUNCTIONS so interpolation stays in the (translated) caller — no i18n import
 * lives in this file.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { ChevronRight, Search } from 'lucide-react';

import { DataGrid, type DataGridBulkAction, type DataGridColumn } from './DataGrid';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import type { Density } from '@/lib/density';

import { buildGroupTree, itemsUnderGroup, searchItems, type GroupNode } from './facetedTableModel';

/** Already-translated strings/formatters the table needs. */
export interface FacetedDecisionTableLabels {
  /** Label of the synthetic root node in the rail. */
  allGroups: string;
  /** Summary line above the table. `group` is '' when the root is selected. */
  summary: (group: string, count: number) => string;
  searchPlaceholder?: string;
  /** aria-label for a collapsed node's disclosure button. */
  expand: string;
  /** aria-label for an expanded node's disclosure button. */
  collapse: string;
  emptyTitle: string;
  emptyDescription: string;
}

export interface FacetedDecisionTableProps<T> {
  items: T[];
  getRowKey: (row: T) => string;
  /** Slash-delimited group path for a row ('' = ungrouped, sits at the root). */
  getGroupPath: (row: T) => string;
  columns: DataGridColumn<T>[];
  /**
   * In-flight fetch flag, forwarded to the inner `DataGrid`. Pass the real
   * request state and nothing else: the grid shows its calm delayed ghost rows
   * only while `isLoading && rows.length === 0`, so a refetch with rows on
   * screen changes nothing and the empty state stays unreachable until the
   * fetch has settled (`docs/design/overview-loading.md` laws 1 and 5).
   */
  isLoading?: boolean;
  /** Caller-owned row predicate (status/kind/project/... filters). */
  filterRow?: (row: T) => boolean;
  /** Fields the search box matches against. Omit to hide the search box. */
  searchHaystack?: (row: T) => string[];
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  /** Comparator for the visible rows — build it from sortKey/sortDir in the caller. */
  compare?: (a: T, b: T) => number;
  /** Receives the clicked row plus the CURRENT visible ordering (queue contract). */
  onRowClick?: (row: T, orderedVisible: T[]) => void;
  /** Extra controls rendered between the summary line and the search box. */
  toolbar?: ReactNode;
  emptyIcon?: React.ComponentType<{ className?: string }>;
  pageSize?: number;
  density?: Density;
  /** Display transform for a rail node's segment (e.g. token → translated label). */
  formatSegment?: (segment: string, path: string) => string;
  /**
   * Optional per-node encoding for the rail. Depth alone is a weak signal: a
   * 66-item branch and a 10-item branch render as identical rows differing only
   * by a number you have to read. `share` (0..1 of the largest sibling) draws a
   * proportional bar so the corpus's shape is visible at a glance, and
   * `pending` surfaces how much of the branch still needs a decision.
   *
   * Opt-in — consumers that don't pass it get exactly the previous rail.
   */
  nodeMeta?: (path: string, count: number) => { share: number; pending: number } | null;
  labels: FacetedDecisionTableLabels;
  /* -- DataGrid selection / bulk pass-throughs ------------------------------ */
  isRowSelected?: (row: T) => boolean;
  selectAll?: boolean;
  onSelectAll?: () => void;
  selectedCount?: number;
  bulkActions?: DataGridBulkAction[];
  onClearSelection?: () => void;
}

export function FacetedDecisionTable<T>({
  items,
  getRowKey,
  getGroupPath,
  columns,
  isLoading,
  filterRow,
  searchHaystack,
  sortKey,
  sortDir = 'desc',
  onSort,
  compare,
  onRowClick,
  toolbar,
  emptyIcon,
  pageSize = 25,
  density = 'compact',
  formatSegment,
  nodeMeta,
  labels,
  isRowSelected,
  selectAll,
  onSelectAll,
  selectedCount,
  bulkActions,
  onClearSelection,
}: FacetedDecisionTableProps<T>) {
  const [selected, setSelected] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']));
  const [query, setQuery] = useState('');

  const tree = useMemo(() => buildGroupTree(items, getGroupPath), [items, getGroupPath]);

  const rows = useMemo(() => {
    const branch = itemsUnderGroup(items, getGroupPath, selected);
    const searched = searchHaystack ? searchItems(branch, query, searchHaystack) : branch;
    const filtered = filterRow ? searched.filter(filterRow) : searched;
    return compare ? [...filtered].sort(compare) : filtered;
  }, [items, getGroupPath, selected, query, searchHaystack, filterRow, compare]);

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div className="flex min-h-0 h-full gap-4">
      <aside className="w-60 shrink-0 overflow-y-auto rounded-card border border-primary/10 p-2">
        <NodeButton
          label={labels.allGroups}
          count={tree.total}
          depth={0}
          active={selected === ''}
          hasChildren={false}
          expanded
          expandLabel={labels.expand}
          collapseLabel={labels.collapse}
          meta={nodeMeta?.('', tree.total) ?? null}
          onSelect={() => setSelected('')}
          onToggle={() => {}}
        />
        {tree.children.map((node) => (
          <TreeBranch
            key={node.path}
            node={node}
            depth={0}
            selected={selected}
            expanded={expanded}
            expandLabel={labels.expand}
            collapseLabel={labels.collapse}
            formatSegment={formatSegment}
            nodeMeta={nodeMeta}
            onSelect={setSelected}
            onToggle={toggle}
          />
        ))}
      </aside>

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="flex items-center gap-3 pb-2">
          <span className="typo-caption text-muted-foreground">
            {labels.summary(selected, rows.length)}
          </span>
          {toolbar}
          {searchHaystack && (
            <div className={`relative ${toolbar ? '' : 'ml-auto'}`}>
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                className={`${INPUT_FIELD} pl-8 w-56`}
                placeholder={labels.searchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          )}
        </div>

        <DataGrid
          columns={columns}
          data={rows}
          getRowKey={getRowKey}
          onRowClick={onRowClick ? (r) => onRowClick(r, rows) : undefined}
          isLoading={isLoading}
          sortKey={sortKey}
          sortDirection={sortDir}
          onSort={onSort}
          pageSize={pageSize}
          density={density}
          emptyIcon={emptyIcon}
          emptyTitle={labels.emptyTitle}
          emptyDescription={labels.emptyDescription}
          isRowSelected={isRowSelected}
          selectAll={selectAll}
          onSelectAll={onSelectAll}
          selectedCount={selectedCount}
          bulkActions={bulkActions}
          onClearSelection={onClearSelection}
          className="flex-1 min-h-0 rounded-card border border-primary/10"
        />
      </div>
    </div>
  );
}

function TreeBranch({
  node,
  depth,
  selected,
  expanded,
  expandLabel,
  collapseLabel,
  formatSegment,
  nodeMeta,
  onSelect,
  onToggle,
}: {
  node: GroupNode;
  depth: number;
  selected: string;
  expanded: Set<string>;
  expandLabel: string;
  collapseLabel: string;
  formatSegment?: (segment: string, path: string) => string;
  nodeMeta?: (path: string, count: number) => { share: number; pending: number } | null;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
}) {
  const isOpen = expanded.has(node.path);
  return (
    <>
      <NodeButton
        meta={nodeMeta?.(node.path, node.total) ?? null}
        label={formatSegment ? formatSegment(node.segment, node.path) : node.segment}
        count={node.total}
        depth={depth}
        active={selected === node.path}
        hasChildren={node.children.length > 0}
        expanded={isOpen}
        expandLabel={expandLabel}
        collapseLabel={collapseLabel}
        onSelect={() => onSelect(node.path)}
        onToggle={() => onToggle(node.path)}
      />
      {isOpen &&
        node.children.map((child) => (
          <TreeBranch
            key={child.path}
            node={child}
            depth={depth + 1}
            selected={selected}
            expanded={expanded}
            expandLabel={expandLabel}
            collapseLabel={collapseLabel}
            formatSegment={formatSegment}
            nodeMeta={nodeMeta}
            onSelect={onSelect}
            onToggle={onToggle}
          />
        ))}
    </>
  );
}

function NodeButton({
  label,
  count,
  depth,
  active,
  hasChildren,
  expanded,
  expandLabel,
  collapseLabel,
  meta,
  onSelect,
  onToggle,
}: {
  label: string;
  count: number;
  depth: number;
  active: boolean;
  hasChildren: boolean;
  expanded: boolean;
  expandLabel: string;
  collapseLabel: string;
  meta?: { share: number; pending: number } | null;
  onSelect: () => void;
  onToggle: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-1 rounded-interactive pr-2 transition-colors ${
        active ? 'bg-primary/10' : 'hover:bg-secondary/40'
      }`}
      style={{ paddingLeft: `${depth * 14 + 4}px` }}
    >
      {hasChildren ? (
        <button
          type="button"
          aria-label={expanded ? collapseLabel : expandLabel}
          onClick={onToggle}
          className="p-0.5 text-foreground/70 hover:text-foreground"
        >
          <ChevronRight
            className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
        </button>
      ) : (
        <span className="w-[18px]" />
      )}
      <button
        type="button"
        onClick={onSelect}
        className="flex-1 min-w-0 flex flex-col gap-0.5 py-1 text-left"
      >
        <span className="flex items-center justify-between gap-2">
          <span className="typo-body text-foreground truncate">{label}</span>
          <span className="shrink-0 flex items-baseline gap-1">
            {/* Undecided count leads: it is the number that asks something of
                the reader. Suppressed when zero so a fully-reviewed branch
                reads as quiet rather than as a zero to parse. */}
            {meta && meta.pending > 0 && (
              <span className="typo-caption text-status-warning tabular-nums">{meta.pending}</span>
            )}
            <span className="typo-caption text-muted-foreground tabular-nums">{count}</span>
          </span>
        </span>
        {/* Proportional bar — width is the branch's share of its largest
            sibling, so relative mass is visible without reading any number.
            Only drawn when the consumer opts in via `nodeMeta`. */}
        {meta && (
          <span aria-hidden="true" className="h-px w-full bg-primary/10 overflow-hidden rounded-full">
            <span
              className="block h-full bg-primary/40"
              style={{ width: `${Math.max(2, Math.round(meta.share * 100))}%` }}
            />
          </span>
        )}
      </button>
    </div>
  );
}

export default FacetedDecisionTable;
