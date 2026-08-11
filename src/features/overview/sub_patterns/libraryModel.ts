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
import {
  buildGroupTree,
  itemsUnderGroup,
  searchItems,
  type GroupNode,
} from '@/features/shared/components/display/facetedTableModel';
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
}

export type Abstraction = 'macro' | 'meso' | 'micro';
export type Durability = 'durable' | 'situational' | 'mechanical';

/**
 * A DIRECTION — the doctrine tier of the inverted library (2026-08-11
 * distillation): a macro item that states how things should be done, with its
 * governed techniques as evidence underneath. Every surface that lists
 * knowledge puts directions FIRST; techniques are what you drill into, not
 * what you meet.
 */
export const isDirection = (i: Pick<KnowledgeItemView, 'abstraction'>): boolean =>
  i.abstraction === 'macro';

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
    // ts-rs maps Rust `i64` to `bigint`; Tauri delivers it over IPC as a plain
    // JSON number, so narrow it here rather than letting `bigint` leak into the
    // view model (counts here are single/double digits — no precision at risk).
    evidenceCount: row.evidence_count != null ? Number(row.evidence_count) : null,
  };
}

// -- review ordering ---------------------------------------------------------

/**
 * How much a pending item is worth reviewing first.
 *
 * A twelve-territory harvest lands a few hundred `observed` items at once, so
 * the order the reviewer meets them in decides what actually gets adjudicated
 * before attention runs out. `updatedAt` — the old default — is ingest order,
 * which is arbitrary. Prevalence x the author's own confidence puts the
 * best-evidenced practices at the top of the queue.
 *
 * Missing metadata is treated as neutral (one site, even odds) rather than
 * zero, so an item that simply didn't report its evidence isn't buried.
 */
export function reviewValue(item: KnowledgeItemView): number {
  const evidence = item.evidenceCount ?? 1;
  const confidence = item.confidence ?? 0.5;
  return evidence * confidence;
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

// -- review queue ------------------------------------------------------------

/**
 * Step a review queue by ±1, skipping ids whose row has since disappeared
 * (deleted from another surface) instead of landing on an empty modal.
 *
 * Returns `null` when the step falls off either end — the caller closes rather
 * than clamping, because a reviewer who adjudicates the last item wants the
 * queue to end, not to sit on a row they just decided.
 */
export function nextQueueIndex(
  queue: readonly string[],
  index: number,
  delta: -1 | 1,
  exists: (id: string) => boolean,
): number | null {
  let next = index + delta;
  while (next >= 0 && next < queue.length && !exists(queue[next]!)) next += delta;
  return next >= 0 && next < queue.length ? next : null;
}

// -- topic tree (derived, arbitrary depth) -----------------------------------
//
// The mechanics now live in the shared, row-type-generic
// `display/facetedTableModel` (the same tree/search engine backs the Backlog
// table). These are the Workspaces-typed bindings — the topic accessor and the
// search haystack — kept as named exports so existing callers/tests are
// unaffected.

/** A node of the derived topic taxonomy. Alias of the generic `GroupNode`. */
export type TopicNode = GroupNode;

const topicOf = (i: KnowledgeItemView): string => i.topic;

/** Build the taxonomy tree that actually exists in the data — arbitrary depth,
 *  no hardcoded levels. Children sorted by descending total then name. */
export function buildTopicTree(items: readonly KnowledgeItemView[]): TopicNode {
  return buildGroupTree(items, topicOf);
}

/** All items under a topic path (the node and its descendants). */
export function itemsUnderTopic(
  items: readonly KnowledgeItemView[],
  path: string,
): KnowledgeItemView[] {
  return itemsUnderGroup(items, topicOf, path);
}

// -- filtering ---------------------------------------------------------------

/** Case-insensitive match against title, statement or topic. */
export function searchFilter(
  items: readonly KnowledgeItemView[],
  query: string,
): KnowledgeItemView[] {
  return searchItems(items, query, (i) => [i.title, i.statement, i.topic]);
}
