// Knowledge-library view model — the SCALE layer of the Workspace Knowledge
// Center. Self-evolving workspaces will generate dozens-to-hundreds of items
// per month, in taxonomies we cannot hardcode. So: every hierarchy here is
// DERIVED from item metadata at render time (topic slash-paths, facet
// dimensions), never enumerated in code, and every list renders through the
// shared GroupedVirtualList so 10 or 10,000 items cost the same.
//
// Topic paths: free-form slash-delimited taxonomy ('ui/motion/reveals')
// authored by harvest agents. Real DB rows don't carry a `topic` column yet
// (consolidation adds it); until then a coarse path is derived from
// applicability.layers so real items participate in the same tree.
import type { GroupSpec } from '@/features/shared/components/display/grouping';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { WorkspaceKnowledge } from '@/lib/bindings/WorkspaceKnowledge';
import type { KnowledgeKind, KnowledgeStatus } from '@/api/devTools/workspaces';

export interface KnowledgeItemView {
  id: string;
  kind: KnowledgeKind;
  status: KnowledgeStatus;
  title: string;
  statement: string;
  /** Slash-path taxonomy node; '' = uncategorized. */
  topic: string;
  layers: string[];
  frameworks: string[];
  originProjectId: string | null;
  createdAt: string;
  updatedAt: string;
  confidence: number | null;
  /** True for generated demo rows (never written to the DB). */
  mock?: boolean;
}

export function viewFromRow(row: WorkspaceKnowledge): KnowledgeItemView {
  let layers: string[] = [];
  let frameworks: string[] = [];
  if (row.applicability) {
    try {
      const parsed = JSON.parse(row.applicability) as {
        layers?: string[];
        frameworks?: string[];
      };
      layers = parsed.layers ?? [];
      frameworks = parsed.frameworks ?? [];
    } catch {
      // malformed applicability never breaks the library
    }
  }
  return {
    id: row.id,
    kind: row.kind as KnowledgeKind,
    status: row.status as KnowledgeStatus,
    title: row.title,
    statement: row.statement,
    topic: layers[0] ?? '',
    layers,
    frameworks,
    originProjectId: row.origin_project_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    confidence: row.confidence,
  };
}

// -- facet dimensions --------------------------------------------------------

export type FacetDim = 'topic' | 'status' | 'kind' | 'origin' | 'month' | 'framework';

export interface FacetContext {
  projectById: Map<string, DevProject>;
}

export const FACET_DIMS: { id: FacetDim; label: string }[] = [
  { id: 'topic', label: 'Topic' },
  { id: 'status', label: 'Status' },
  { id: 'kind', label: 'Kind' },
  { id: 'origin', label: 'Origin project' },
  { id: 'month', label: 'Month' },
  { id: 'framework', label: 'Framework' },
];

export function monthKey(iso: string): string {
  return iso.slice(0, 7); // YYYY-MM
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

/** Map an item to its group under a facet dimension. Pure; pairs with
 *  buildGroupRows after sortForFacet. */
export function facetOf(
  item: KnowledgeItemView,
  dim: FacetDim,
  ctx: FacetContext,
): GroupSpec {
  switch (dim) {
    case 'topic': {
      const seg = item.topic.split('/')[0] || '';
      return seg ? { key: seg, label: seg } : { key: '~none', label: 'Uncategorized' };
    }
    case 'status':
      return { key: item.status, label: item.status };
    case 'kind':
      return { key: item.kind, label: item.kind };
    case 'origin': {
      if (!item.originProjectId) return { key: '~none', label: 'Workspace-level' };
      const name = ctx.projectById.get(item.originProjectId)?.name ?? '(project removed)';
      return { key: item.originProjectId, label: name };
    }
    case 'month': {
      const key = monthKey(item.createdAt);
      return { key, label: monthLabel(key) };
    }
    case 'framework': {
      const fw = item.frameworks[0];
      return fw ? { key: fw, label: fw } : { key: '~none', label: 'Stack-agnostic' };
    }
  }
}

/** Order items so buildGroupRows' consecutive-run bucketing equals a global
 *  group-by: primary = group key (months newest-first, '~none' last),
 *  secondary = recency. */
export function sortForFacet(
  items: KnowledgeItemView[],
  dim: FacetDim,
  ctx: FacetContext,
): KnowledgeItemView[] {
  const keyed = items.map((item) => ({ item, spec: facetOf(item, dim, ctx) }));
  keyed.sort((a, b) => {
    if (a.spec.key !== b.spec.key) {
      const aNone = a.spec.key.startsWith('~');
      const bNone = b.spec.key.startsWith('~');
      if (aNone !== bNone) return aNone ? 1 : -1;
      if (dim === 'month') return b.spec.key.localeCompare(a.spec.key);
      return a.spec.label.localeCompare(b.spec.label, undefined, { sensitivity: 'base' });
    }
    return b.item.updatedAt.localeCompare(a.item.updatedAt);
  });
  return keyed.map((k) => k.item);
}

// -- topic tree (derived, arbitrary depth) -----------------------------------

export interface TopicNode {
  /** Full slash path ('' = root). */
  path: string;
  segment: string;
  /** Items exactly at this node. */
  own: number;
  /** Items at this node or any descendant. */
  total: number;
  children: TopicNode[];
}

/** Build the taxonomy tree that actually exists in the data — arbitrary depth,
 *  no hardcoded levels. Children sorted by descending total then name. */
export function buildTopicTree(items: readonly KnowledgeItemView[]): TopicNode {
  const root: TopicNode = { path: '', segment: '', own: 0, total: 0, children: [] };
  const byPath = new Map<string, TopicNode>([['', root]]);

  const ensure = (path: string): TopicNode => {
    const existing = byPath.get(path);
    if (existing) return existing;
    const idx = path.lastIndexOf('/');
    const parent = ensure(idx === -1 ? '' : path.slice(0, idx));
    const node: TopicNode = {
      path,
      segment: idx === -1 ? path : path.slice(idx + 1),
      own: 0,
      total: 0,
      children: [],
    };
    parent.children.push(node);
    byPath.set(path, node);
    return node;
  };

  for (const item of items) {
    const node = ensure(item.topic || '');
    node.own += 1;
    // bubble totals to the root
    for (let p = node.path; ; ) {
      const n = byPath.get(p)!;
      n.total += 1;
      if (p === '') break;
      const idx = p.lastIndexOf('/');
      p = idx === -1 ? '' : p.slice(0, idx);
    }
  }

  const sortRec = (node: TopicNode) => {
    node.children.sort((a, b) => b.total - a.total || a.segment.localeCompare(b.segment));
    node.children.forEach(sortRec);
  };
  sortRec(root);
  return root;
}

/** All items under a topic path (the node and its descendants). */
export function itemsUnderTopic(
  items: readonly KnowledgeItemView[],
  path: string,
): KnowledgeItemView[] {
  if (!path) return [...items];
  return items.filter((i) => i.topic === path || i.topic.startsWith(`${path}/`));
}

// -- misc --------------------------------------------------------------------

export function searchFilter(
  items: readonly KnowledgeItemView[],
  query: string,
): KnowledgeItemView[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter(
    (i) =>
      i.title.toLowerCase().includes(q) ||
      i.statement.toLowerCase().includes(q) ||
      i.topic.toLowerCase().includes(q),
  );
}

/** Per-month item counts, newest first, capped at `months`. */
export function monthlyInflux(
  items: readonly KnowledgeItemView[],
  months = 6,
): { key: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const i of items) {
    const k = monthKey(i.createdAt);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, months)
    .map(([key, count]) => ({ key, label: monthLabel(key), count }));
}
