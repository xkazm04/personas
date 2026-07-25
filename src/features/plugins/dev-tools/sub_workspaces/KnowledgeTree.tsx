// Knowledge library — the CONSOLIDATED surface (Topics won round B). The left
// rail renders whatever slash-path hierarchy the harvest agents actually
// produced (arbitrary depth, counts bubbled up, nothing hardcoded); the right
// pane lists the selected branch through the shared DataGrid — paginated,
// per-column sortable/filterable, so it stays crisp at hundreds of items. We
// reuse DataGrid rather than reinventing table mechanics.
import { useMemo, useState } from 'react';
import { ChevronRight, Library, Search } from 'lucide-react';

import { DataGrid, type DataGridColumn } from '@/features/shared/components/display/DataGrid';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { KnowledgeKind, KnowledgeStatus } from '@/api/devTools/workspaces';
import type { DevProject } from '@/lib/bindings/DevProject';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { useTranslation } from '@/i18n/useTranslation';

import { KnowledgeStatusChip } from './centerShared';
import {
  buildTopicTree,
  itemsUnderTopic,
  searchFilter,
  STATUS_RANK,
  type KnowledgeItemView,
  type TopicNode,
} from './libraryModel';

const KIND_VALUES: KnowledgeKind[] = ['pattern', 'pitfall', 'decision', 'howto', 'fact'];
const STATUS_VALUES: KnowledgeStatus[] = ['proposed', 'observed', 'adopted', 'deprecated', 'rejected'];

type SortDir = 'asc' | 'desc';

export default function KnowledgeTree({
  items,
  projectById,
  onRowClick,
}: {
  items: KnowledgeItemView[];
  projectById: Map<string, DevProject>;
  /** Open the practice's detail/review surface. */
  onRowClick?: (item: KnowledgeItemView) => void;
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
  const [selected, setSelected] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']));
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [kindFilter, setKindFilter] = useState('all');
  const [abstractionFilter] = useState('all');
  const [hideLint, setHideLint] = useState(true);
  const [sortKey, setSortKey] = useState('updated');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const tree = useMemo(() => buildTopicTree(items), [items]);

  const rows = useMemo(() => {
    const branch = itemsUnderTopic(items, selected);
    const searched = searchFilter(branch, query);
    const filtered = searched.filter(
      (i) =>
        (statusFilter === 'all' || i.status === statusFilter) &&
        (kindFilter === 'all' || i.kind === kindFilter) &&
        (abstractionFilter === 'all' || i.abstraction === abstractionFilter) &&
        // "Hide lint layer" drops mechanical/micro items (motivate/avoid): a
        // practice library should surface doctrine, not lint-territory rules.
        (!hideLint || (i.durability !== 'mechanical' && i.abstraction !== 'micro')),
    );
    const dir = sortDir === 'asc' ? 1 : -1;
    const cmp = (a: KnowledgeItemView, b: KnowledgeItemView): number => {
      switch (sortKey) {
        case 'status':
          return (STATUS_RANK[a.status] - STATUS_RANK[b.status]) * dir;
        case 'kind':
          return a.kind.localeCompare(b.kind) * dir;
        case 'title':
          return a.title.localeCompare(b.title) * dir;
        case 'updated':
        default:
          return a.updatedAt.localeCompare(b.updatedAt) * dir;
      }
    };
    return [...filtered].sort(cmp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, selected, query, statusFilter, kindFilter, abstractionFilter, hideLint, sortKey, sortDir, projectById]);

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
          {r.mock && (
            <span className="typo-label text-muted-foreground ml-1.5 opacity-60">{tw.demo_tag}</span>
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
          label={tw.all_topics}
          count={tree.total}
          depth={0}
          active={selected === ''}
          hasChildren={false}
          expanded
          expandLabel={tw.expand}
          collapseLabel={tw.collapse}
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
            expandLabel={tw.expand}
            collapseLabel={tw.collapse}
            onSelect={setSelected}
            onToggle={toggle}
          />
        ))}
      </aside>

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="flex items-center gap-3 pb-2">
          <span className="typo-caption text-muted-foreground">
            {selected
              ? tx(tw.branch_summary, { topic: selected, count: rows.length })
              : tx(tw.all_topics_summary, { count: rows.length })}
          </span>
          <button
            type="button"
            onClick={() => setHideLint((v) => !v)}
            className={`ml-auto typo-label rounded-interactive border px-2 py-1 transition-colors ${
              hideLint
                ? 'border-primary/30 bg-primary/10 text-foreground'
                : 'border-primary/10 text-foreground/70 hover:bg-secondary/40'
            }`}
            title={tw.hide_lint_hint}
          >
            {tw.hide_lint}
          </button>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              className={`${INPUT_FIELD} pl-8 w-56`}
              placeholder={tw.search_practices}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        <DataGrid
          columns={columns}
          data={rows}
          getRowKey={(r) => r.id}
          // Demo rows have no database row behind them, so there is no detail
          // to open — everything real is clickable.
          onRowClick={onRowClick ? (r) => { if (!r.mock) onRowClick(r); } : undefined}
          sortKey={sortKey}
          sortDirection={sortDir}
          onSort={onSort}
          pageSize={25}
          density="compact"
          emptyIcon={Library}
          emptyTitle={tw.library_empty_title}
          emptyDescription={tw.library_empty_desc}
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
  onSelect,
  onToggle,
}: {
  node: TopicNode;
  depth: number;
  selected: string;
  expanded: Set<string>;
  expandLabel: string;
  collapseLabel: string;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
}) {
  const isOpen = expanded.has(node.path);
  return (
    <>
      <NodeButton
        label={node.segment}
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
        className="flex-1 min-w-0 flex items-center justify-between gap-2 py-1 text-left"
      >
        <span className="typo-body text-foreground truncate">{label}</span>
        <span className="typo-caption text-muted-foreground shrink-0">{count}</span>
      </button>
    </div>
  );
}
