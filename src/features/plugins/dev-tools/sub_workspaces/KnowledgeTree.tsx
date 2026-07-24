// Library variant B2 — "Atlas of topics": the emergent taxonomy as a
// navigable tree. The left rail renders whatever slash-path hierarchy the
// harvest agents actually produced (arbitrary depth, counts bubbled up,
// nothing hardcoded); the right pane is a virtualized listing of the selected
// branch. The mental model: a library with self-organizing shelves.
import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';

import { GroupedVirtualList } from '@/features/shared/components/display/GroupedVirtualList';
import type { DevProject } from '@/lib/bindings/DevProject';

import { ITEM_ROW_SIZE, ItemRow } from './LibraryBits';
import {
  buildTopicTree,
  facetOf,
  itemsUnderTopic,
  sortForFacet,
  type KnowledgeItemView,
  type TopicNode,
} from './libraryModel';

export default function KnowledgeTree({
  items,
  projectById,
  workspaceId,
}: {
  items: KnowledgeItemView[];
  projectById: Map<string, DevProject>;
  workspaceId: string;
}) {
  const [selected, setSelected] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']));

  const tree = useMemo(() => buildTopicTree(items), [items]);
  const ctx = useMemo(() => ({ projectById }), [projectById]);
  const branch = useMemo(
    () => sortForFacet(itemsUnderTopic(items, selected), 'status', ctx),
    [items, selected, ctx],
  );

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
          label="All topics"
          count={tree.total}
          depth={0}
          active={selected === ''}
          hasChildren={false}
          expanded
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
            onSelect={setSelected}
            onToggle={toggle}
          />
        ))}
      </aside>

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="typo-caption text-muted-foreground pb-2">
          {selected || 'all topics'} · {branch.length} items
        </div>
        <GroupedVirtualList
          items={branch}
          groupOf={(item) => facetOf(item, 'status', ctx)}
          getItemKey={(item) => item.id}
          renderItem={(item) => <ItemRow item={item} projectById={projectById} />}
          estimateItemSize={ITEM_ROW_SIZE}
          className="flex-1 min-h-0 rounded-card border border-primary/10"
          scrollRestoreKey={`ws-tree-${workspaceId}-${selected}`}
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
  onSelect,
  onToggle,
}: {
  node: TopicNode;
  depth: number;
  selected: string;
  expanded: Set<string>;
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
  onSelect,
  onToggle,
}: {
  label: string;
  count: number;
  depth: number;
  active: boolean;
  hasChildren: boolean;
  expanded: boolean;
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
          aria-label={expanded ? 'Collapse' : 'Expand'}
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
