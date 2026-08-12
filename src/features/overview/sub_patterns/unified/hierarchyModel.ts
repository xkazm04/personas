// Hierarchy resolution for the unified practice modal (pattern-fabric v2).
// The modal is anchored on ANY knowledge item and always renders the item's
// PRINCIPLE context: opening a manifestation resolves upward to its governing
// principle; opening a principle resolves downward to its manifestations.
// Legacy items (layer NULL, no governor) get a single-item context so the
// pre-v2 corpus keeps a working detail view during the migration.
import type { KnowledgeItemView } from '../libraryModel';

export interface PracticeHierarchy {
  /** The principle whose context is rendered; null for unclassified orphans. */
  principle: KnowledgeItemView | null;
  /** The principle's manifestations, grouped by topic cluster (the seam
   *  proxy until a dedicated seam column exists), heaviest evidence first. */
  groups: ManifestationGroup[];
  /** The item the user actually clicked — variants focus/scroll to it. */
  anchor: KnowledgeItemView;
  /** Sibling principles sharing the anchor's topic area — the modal can
   *  switch between them without closing (the graph's cluster entry). */
  siblingPrinciples: KnowledgeItemView[];
}

export interface ManifestationGroup {
  /** Topic cluster below the area, e.g. 'cancellation' — '' when none. */
  cluster: string;
  items: KnowledgeItemView[];
}

const areaOf = (topic: string): string => topic.split('/')[0] ?? '';
const clusterOf = (topic: string): string => topic.split('/')[1] ?? '';

/** `refs` travels as a JSON string column; bad JSON degrades to empty. */
export function parseEvidenceRefs(refs: string): string[] {
  try {
    const arr = JSON.parse(refs) as unknown;
    return Array.isArray(arr) ? arr.filter((r): r is string => typeof r === 'string') : [];
  } catch {
    return [];
  }
}

export function resolveHierarchy(
  anchor: KnowledgeItemView,
  items: readonly KnowledgeItemView[],
): PracticeHierarchy {
  const byId = new Map(items.map((i) => [i.id, i]));
  // Walk upward at most twice: manifestation -> principle covers the v2
  // shape; the extra hop tolerates legacy governed-macro chains.
  let principle: KnowledgeItemView | null = null;
  if (anchor.layer === 'principle') principle = anchor;
  else if (anchor.governingId) {
    const parent = byId.get(anchor.governingId) ?? null;
    principle = parent?.layer === 'principle' || (parent && !parent.governingId)
      ? parent
      : parent?.governingId
        ? byId.get(parent.governingId) ?? parent
        : parent;
  }

  const children = principle
    ? items.filter((i) => i.governingId === principle.id)
    : [];

  const byCluster = new Map<string, KnowledgeItemView[]>();
  for (const c of children) {
    const key = clusterOf(c.topic);
    const list = byCluster.get(key) ?? [];
    list.push(c);
    byCluster.set(key, list);
  }
  const groups: ManifestationGroup[] = [...byCluster.entries()]
    .map(([cluster, list]) => ({
      cluster,
      items: list.sort((a, b) => (b.evidenceCount ?? 0) - (a.evidenceCount ?? 0)),
    }))
    .sort((a, b) => b.items.length - a.items.length);

  const area = areaOf((principle ?? anchor).topic);
  const siblingPrinciples = items
    .filter((i) => i.layer === 'principle' && areaOf(i.topic) === area)
    .sort((a, b) => a.title.localeCompare(b.title));

  return { principle, groups, anchor, siblingPrinciples };
}

/** Aggregate stats a principle header renders — derived, never stored.
 *  `evidenceTotal` counts REAL v2 evidence rows from the fetched map (null
 *  while fetches are in flight) — `KnowledgeItemView.evidenceCount` is the
 *  legacy harvest-time prevalence integer and must not masquerade as rows. */
export function hierarchyStats(
  h: PracticeHierarchy,
  evidence: ReadonlyMap<string, readonly unknown[]>,
): {
  manifestations: number;
  clusters: number;
  evidenceTotal: number | null;
} {
  const all = h.groups.flatMap((g) => g.items);
  const ids = [(h.principle ?? h.anchor).id, ...all.map((i) => i.id)];
  const loaded = ids.filter((id) => evidence.has(id));
  const evidenceTotal = loaded.length === 0
    ? null
    : loaded.reduce((a, id) => a + (evidence.get(id)?.length ?? 0), 0);
  return {
    manifestations: all.length,
    clusters: h.groups.filter((g) => g.cluster !== '').length,
    evidenceTotal,
  };
}
