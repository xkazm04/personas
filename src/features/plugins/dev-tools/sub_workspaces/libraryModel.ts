// Knowledge-library view model — the SCALE layer of the Workspace Knowledge
// Center. Self-evolving workspaces will generate dozens-to-hundreds of items
// per month, in taxonomies we cannot hardcode. So the topic hierarchy is
// DERIVED from item metadata at render time (slash-path taxonomy), never
// enumerated in code; the right-pane listing renders through the shared
// DataGrid (pagination + sortable/filterable columns) so 10 or 10,000 items
// cost the same.
//
// Topic paths: free-form slash-delimited taxonomy ('ui/motion/reveals')
// authored by harvest agents, stored in workspace_knowledge.topic. Legacy
// rows written before that column fall back to a coarse path derived from
// applicability.layers so they still participate in the same tree.
import type { WorkspaceKnowledge } from '@/lib/bindings/WorkspaceKnowledge';
import type { KnowledgeKind, KnowledgeStatus } from '@/api/devTools/workspaces';
import { silentCatch } from '@/lib/silentCatch';

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
  /** When a human adjudicated it (adopt/reject/deprecate); null while pending.
   *  The digest windows on this, not `updatedAt` — a re-verification or a
   *  topic renormalization touches `updatedAt` and would otherwise resurface
   *  months-old decisions as "this week". */
  decidedAt: string | null;
  confidence: number | null;
  /** Categorization axes (Arc-2 metadata extension). */
  abstraction: Abstraction | null;
  ftype: string | null;
  durability: Durability | null;
  governingId: string | null;
  evidenceCount: number | null;
  /** True for generated demo rows (never written to the DB). */
  mock?: boolean;
}

export type Abstraction = 'macro' | 'meso' | 'micro';
export type Durability = 'durable' | 'situational' | 'mechanical';

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
    } catch (err) {
      silentCatch('libraryModel:viewFromRow:parseApplicability')(err);
    }
  }
  return {
    id: row.id,
    kind: row.kind as KnowledgeKind,
    status: row.status as KnowledgeStatus,
    title: row.title,
    statement: row.statement,
    topic: row.topic ?? layers[0] ?? '',
    layers,
    frameworks,
    originProjectId: row.origin_project_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    decidedAt: row.decided_at ?? null,
    confidence: row.confidence,
    abstraction: (row.abstraction as Abstraction | null) ?? null,
    ftype: row.ftype ?? null,
    durability: (row.durability as Durability | null) ?? null,
    governingId: row.governing_id ?? null,
    evidenceCount: row.evidence_count ?? null,
  };
}

// -- ordering ----------------------------------------------------------------

/** Lifecycle order for status sorting — proposal queue first, canon, then
 *  the retired tail. */
export const STATUS_RANK: Record<KnowledgeStatus, number> = {
  proposed: 0,
  observed: 1,
  adopted: 2,
  deprecated: 3,
  rejected: 4,
};

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

// -- filtering ---------------------------------------------------------------

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
