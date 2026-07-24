// Library variant B1 — "Ledger": the governed record at scale. One dense
// virtualized stream, dynamically re-groupable along any facet dimension
// (topic / status / kind / origin / month / framework — all derived from item
// metadata, never hardcoded), sticky group headers, search, status chips.
// The mental model: an auditable register you slice on demand.
import { useMemo, useState } from 'react';

import { GroupedVirtualList } from '@/features/shared/components/display/GroupedVirtualList';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import type { KnowledgeStatus } from '@/api/devTools/workspaces';
import type { DevProject } from '@/lib/bindings/DevProject';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

import { ITEM_ROW_SIZE, ItemRow, StatusFilterChips } from './LibraryBits';
import {
  FACET_DIMS,
  facetOf,
  searchFilter,
  sortForFacet,
  type FacetDim,
  type KnowledgeItemView,
} from './libraryModel';

export default function KnowledgeLedger({
  items,
  projectById,
  workspaceId,
}: {
  items: KnowledgeItemView[];
  projectById: Map<string, DevProject>;
  workspaceId: string;
}) {
  const [dim, setDim] = useState<FacetDim>('topic');
  const [query, setQuery] = useState('');
  const [statuses, setStatuses] = useState<Set<KnowledgeStatus>>(
    () => new Set<KnowledgeStatus>(['proposed', 'observed', 'adopted']),
  );

  const ctx = useMemo(() => ({ projectById }), [projectById]);

  const statusCounts = useMemo(() => {
    const out: Partial<Record<KnowledgeStatus, number>> = {};
    for (const i of items) out[i.status] = (out[i.status] ?? 0) + 1;
    return out;
  }, [items]);

  const visible = useMemo(() => {
    const filtered = searchFilter(items, query).filter((i) => statuses.has(i.status));
    return sortForFacet(filtered, dim, ctx);
  }, [items, query, statuses, dim, ctx]);

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex items-center gap-3 pb-3 flex-wrap">
        <input
          className={`${INPUT_FIELD} max-w-56`}
          placeholder="Search the library…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ThemedSelect
          filterable
          hideSearch
          wrapperClassName="w-44"
          options={FACET_DIMS.map((d) => ({ value: d.id, label: `Group: ${d.label}` }))}
          value={dim}
          onValueChange={(v) => setDim(v as FacetDim)}
        />
        <StatusFilterChips
          counts={statusCounts}
          active={statuses}
          onToggle={(s) =>
            setStatuses((prev) => {
              const next = new Set(prev);
              if (next.has(s)) next.delete(s);
              else next.add(s);
              return next;
            })
          }
        />
        <span className="typo-caption text-muted-foreground ml-auto">
          {visible.length} of {items.length}
        </span>
      </div>

      <GroupedVirtualList
        items={visible}
        groupOf={(item) => facetOf(item, dim, ctx)}
        getItemKey={(item) => item.id}
        renderItem={(item) => <ItemRow item={item} projectById={projectById} />}
        estimateItemSize={ITEM_ROW_SIZE}
        className="flex-1 min-h-0 rounded-card border border-primary/10"
        scrollRestoreKey={`ws-ledger-${workspaceId}`}
      />
    </div>
  );
}
