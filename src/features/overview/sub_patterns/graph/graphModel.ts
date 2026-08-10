// Topic-graph view model — areas → clusters ONLY. Individual practices are
// deliberately not nodes yet: the design round is about nailing typography /
// node sizing / canvas movement with ~100 nodes before the graph earns the
// right to carry a thousand. Counts on each node are the practices it would
// eventually fan out into.
import { AREA_ORDER } from './graphTheme';
import type { KnowledgeItemView } from '../libraryModel';

export interface FacetNode {
  /** Full `area/cluster/facet` topic path. */
  topic: string;
  area: string;
  cluster: string;
  facet: string;
  count: number;
  pending: number;
  items: KnowledgeItemView[];
}

export interface ClusterNode {
  /** `area/cluster` topic key (facets fold into it for node grain). */
  topic: string;
  area: string;
  cluster: string;
  count: number;
  pending: number;
  adopted: number;
  /** ALL rows under this cluster (any facet), newest first. */
  items: KnowledgeItemView[];
  /** Third-level topics (fabric S1) — present after the rewiring pass gives
   *  patterns 3-segment paths. A cluster with facets drills once more; a
   *  cluster without them opens its pattern stack directly. */
  facets: FacetNode[];
}

export interface AreaNode {
  area: string;
  count: number;
  pending: number;
  adopted: number;
  clusters: ClusterNode[];
}

export interface TopicGraph {
  areas: AreaNode[];
  total: number;
  pending: number;
  maxClusterCount: number;
}

/** Rejected rows stay in the table views for audit, but a rejected practice is
 *  not knowledge the graph should size nodes by. */
const COUNTED = new Set(['observed', 'proposed', 'adopted']);
const PENDING = new Set(['observed', 'proposed']);

export function buildTopicGraph(items: readonly KnowledgeItemView[]): TopicGraph {
  const byArea = new Map<string, Map<string, KnowledgeItemView[]>>();
  for (const item of items) {
    if (!COUNTED.has(item.status)) continue;
    const [area = '', cluster = ''] = item.topic.split('/');
    if (!area) continue;
    const clusters = byArea.get(area) ?? new Map<string, KnowledgeItemView[]>();
    const list = clusters.get(cluster || 'general') ?? [];
    list.push(item);
    clusters.set(cluster || 'general', list);
    byArea.set(area, clusters);
  }

  const facetsOf = (
    area: string,
    cluster: string,
    list: readonly KnowledgeItemView[],
  ): FacetNode[] => {
    const byFacet = new Map<string, KnowledgeItemView[]>();
    for (const item of list) {
      const facet = item.topic.split('/')[2];
      if (!facet) continue;
      const l = byFacet.get(facet) ?? [];
      l.push(item);
      byFacet.set(facet, l);
    }
    return [...byFacet.entries()]
      .map(([facet, l]) => ({
        topic: `${area}/${cluster}/${facet}`,
        area,
        cluster,
        facet,
        count: l.length,
        pending: l.filter((i) => PENDING.has(i.status)).length,
        items: [...l].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      }))
      .sort((a, b) => b.count - a.count || a.facet.localeCompare(b.facet));
  };

  // Canonical order first (stable geography, including empty areas so the sky
  // has a fixed shape), then any off-taxonomy stragglers (`unsorted/…`).
  const areaNames: string[] = [
    ...AREA_ORDER,
    ...[...byArea.keys()].filter((a) => !(AREA_ORDER as readonly string[]).includes(a)).sort(),
  ];

  let total = 0;
  let pending = 0;
  let maxClusterCount = 1;
  const areas: AreaNode[] = areaNames.map((area) => {
    const clusters: ClusterNode[] = [...(byArea.get(area) ?? new Map()).entries()]
      .map(([cluster, list]: [string, KnowledgeItemView[]]) => {
        const sorted = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const node: ClusterNode = {
          topic: `${area}/${cluster}`,
          area,
          cluster,
          count: list.length,
          pending: list.filter((i) => PENDING.has(i.status)).length,
          adopted: list.filter((i) => i.status === 'adopted').length,
          items: sorted,
          facets: facetsOf(area, cluster, list),
        };
        maxClusterCount = Math.max(maxClusterCount, node.count);
        return node;
      })
      .sort((a, b) => b.count - a.count || a.cluster.localeCompare(b.cluster));
    const count = clusters.reduce((n, c) => n + c.count, 0);
    const areaPending = clusters.reduce((n, c) => n + c.pending, 0);
    total += count;
    pending += areaPending;
    return {
      area,
      count,
      pending: areaPending,
      adopted: clusters.reduce((n, c) => n + c.adopted, 0),
      clusters,
    };
  });

  return { areas, total, pending, maxClusterCount };
}

/** Node radius from practice count — sqrt keeps a 10× count from being a 10×
 *  circle, which is what lets one canvas hold both a 2-item and a 60-item
 *  cluster without the big one swallowing its neighbours. */
export function nodeRadius(count: number, base: number, gain: number, cap: number): number {
  return Math.min(cap, base + Math.sqrt(Math.max(count, 0)) * gain);
}

/** Canonical cluster key for a topic path — facets (3rd segment) fold into
 *  their cluster, since the graph's node grain is the cluster. */
export function topicClusterKey(topic: string): string | null {
  const [area = '', cluster = ''] = topic.split('/');
  return area ? `${area}/${cluster || 'general'}` : null;
}

/** Every measurement key a practice contributes to.
 *
 *  Coverage used to be keyed at the cluster grain only, which made a facet
 *  node a bare circle — the one level of the fabric with no readout, and the
 *  level a curator is standing on when they ask "is THIS adopted?". Keying at
 *  full depth gives the facet its own number; the cluster still gets the
 *  contribution too, so a cluster ring reads as the AGGREGATE of its facets
 *  plus whatever items sit directly under it (a mixed-depth cluster is normal
 *  and must render both grains correctly).
 *
 *  For a 2-segment topic `full === cluster` — the caller can add twice safely
 *  only if it checks, so the pair is returned explicitly. */
export interface TopicCoverageKeys {
  area: string;
  cluster: string;
  /** 3-segment key when the practice has a facet; the cluster key otherwise. */
  full: string;
}

export function topicCoverageKeys(topic: string): TopicCoverageKeys | null {
  const [area = '', cluster = '', facet = ''] = topic.split('/');
  if (!area) return null;
  const clusterKey = `${area}/${cluster || 'general'}`;
  return { area, cluster: clusterKey, full: facet ? `${clusterKey}/${facet}` : clusterKey };
}

// -- fabric omnibox ----------------------------------------------------------
//
// The sky is navigable by flying, which is the right *exploration* verb and the
// wrong *retrieval* one: a curator who already knows the pattern's name should
// not have to remember which of fifteen branches it grew on. The omnibox is the
// retrieval half — one ranked list over every grain the fabric has (area →
// cluster → facet → pattern), each match carrying the node objects the host
// needs to fly there, so the search surface itself owns no navigation policy.

/** One searchable thing, with the graph nodes needed to navigate to it. */
export type FabricMatch =
  | { kind: 'area'; key: string; label: string; path: string; count: number; score: number; node: AreaNode }
  | { kind: 'cluster'; key: string; label: string; path: string; count: number; score: number; cluster: ClusterNode }
  | {
      kind: 'facet';
      key: string;
      label: string;
      path: string;
      count: number;
      score: number;
      cluster: ClusterNode;
      facet: FacetNode;
    }
  | {
      kind: 'pattern';
      key: string;
      label: string;
      path: string;
      count: number;
      score: number;
      cluster: ClusterNode;
      /** The pattern's third-level topic when it has one — the stack to open. */
      facet: FacetNode | null;
      item: KnowledgeItemView;
    };

interface IndexEntry {
  match: FabricMatch;
  /** Lowercased primary haystack (the label + its topic path). */
  primary: string;
  /** Lowercased secondary haystack (a pattern's statement) — ranked lower, so
   *  a body-text hit never outranks a title hit. */
  secondary: string;
}

export type FabricIndex = readonly IndexEntry[];

/** Grain weights. Bigger grains win ties because "ui" should offer the AREA
 *  first — flying to a branch is cheaper to undo than opening the wrong stack. */
const KIND_WEIGHT: Record<FabricMatch['kind'], number> = {
  area: 3,
  cluster: 2.6,
  facet: 2.2,
  pattern: 2,
};

/** Build the omnibox index from a built topic graph. Pure — no I/O, no state. */
export function buildFabricIndex(graph: TopicGraph): FabricIndex {
  const out: IndexEntry[] = [];
  const push = (match: FabricMatch, primary: string, secondary = '') =>
    out.push({ match, primary: primary.toLowerCase(), secondary: secondary.toLowerCase() });

  for (const area of graph.areas) {
    if (area.count > 0) {
      push(
        { kind: 'area', key: `a:${area.area}`, label: area.area, path: area.area, count: area.count, score: 0, node: area },
        area.area,
      );
    }
    for (const cluster of area.clusters) {
      push(
        {
          kind: 'cluster',
          key: `c:${cluster.topic}`,
          label: cluster.cluster,
          path: cluster.topic,
          count: cluster.count,
          score: 0,
          cluster,
        },
        `${cluster.cluster} ${cluster.topic}`,
      );
      const facetByName = new Map(cluster.facets.map((f) => [f.facet, f]));
      for (const facet of cluster.facets) {
        push(
          {
            kind: 'facet',
            key: `f:${facet.topic}`,
            label: facet.facet,
            path: facet.topic,
            count: facet.count,
            score: 0,
            cluster,
            facet,
          },
          `${facet.facet} ${facet.topic}`,
        );
      }
      for (const item of cluster.items) {
        push(
          {
            kind: 'pattern',
            key: `p:${item.id}`,
            label: item.title,
            path: item.topic || cluster.topic,
            count: 1,
            score: 0,
            cluster,
            facet: facetByName.get(item.topic.split('/')[2] ?? '') ?? null,
            item,
          },
          item.title,
          item.statement,
        );
      }
    }
  }
  return out;
}

/** Positional score of `q` inside `hay`: prefix beats word-start beats infix,
 *  and no hit at all is 0. */
function hitScore(hay: string, q: string): number {
  const i = hay.indexOf(q);
  if (i < 0) return 0;
  if (i === 0) return 3;
  return /[\s/\-_.]/.test(hay[i - 1] ?? '') ? 2 : 1;
}

export const FABRIC_SEARCH_MIN = 2;

/** Rank the index against a query. Returns at most `limit` matches, best first;
 *  under `FABRIC_SEARCH_MIN` characters it returns nothing (a one-letter query
 *  matches half the fabric and teaches the user nothing). */
export function searchFabric(index: FabricIndex, query: string, limit = 12): FabricMatch[] {
  const q = query.trim().toLowerCase();
  if (q.length < FABRIC_SEARCH_MIN) return [];
  const scored: FabricMatch[] = [];
  for (const entry of index) {
    const primary = hitScore(entry.primary, q);
    // A statement-only hit is real but weak — it is discounted hard so it can
    // never displace a title/topic hit of the same grain.
    const score = primary > 0 ? primary : hitScore(entry.secondary, q) * 0.25;
    if (score <= 0) continue;
    scored.push({ ...entry.match, score: score * KIND_WEIGHT[entry.match.kind] });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.count - a.count ||
      a.label.localeCompare(b.label) ||
      a.key.localeCompare(b.key),
  );
  return scored.slice(0, limit);
}

/** A practice's contribution to a coverage ratio (adopted/applicable, or
 *  resolved-cells/total-cells — the fold does not care which). */
export interface CoverageParts {
  num: number;
  den: number;
}

/**
 * Fold per-practice coverage into ring values at every grain the canvas draws.
 *
 * Keys are FULL topic paths, so a facet node gets its own ratio; each practice
 * also contributes to its cluster and its area, which makes the cluster ring
 * the honest aggregate of its facets plus any items sitting directly under it.
 * Practices whose `partsOf` returns null (or a zero denominator) contribute
 * nothing anywhere — an unmeasurable practice must not dilute its neighbours.
 */
export function foldTopicCoverage(
  items: readonly KnowledgeItemView[],
  partsOf: (item: KnowledgeItemView) => CoverageParts | null,
): { topic: Map<string, number>; area: Map<string, number> } {
  const topicAcc = new Map<string, CoverageParts>();
  const areaAcc = new Map<string, CoverageParts>();
  const add = (m: Map<string, CoverageParts>, key: string, p: CoverageParts) => {
    const cur = m.get(key) ?? { num: 0, den: 0 };
    cur.num += p.num;
    cur.den += p.den;
    m.set(key, cur);
  };
  for (const item of items) {
    const keys = topicCoverageKeys(item.topic);
    if (!keys) continue;
    const parts = partsOf(item);
    if (!parts || parts.den <= 0) continue;
    add(topicAcc, keys.cluster, parts);
    if (keys.full !== keys.cluster) add(topicAcc, keys.full, parts);
    add(areaAcc, keys.area, parts);
  }
  const ratio = (m: Map<string, CoverageParts>) =>
    new Map([...m.entries()].map(([k, v]) => [k, v.den > 0 ? v.num / v.den : 0]));
  return { topic: ratio(topicAcc), area: ratio(areaAcc) };
}

export interface PatternEdgeLike {
  fromId: string;
  toId: string;
  rel: string;
  note: string | null;
}

/** One pattern's connections, resolved for the modal. */
export interface RelatedPattern {
  rel: string;
  /** True when the pattern is the edge's SOURCE ("this governs that"). */
  outgoing: boolean;
  otherId: string;
  otherTitle: string;
  /** Cluster key of the other endpoint, for cross-navigation. */
  otherTopicKey: string | null;
}

/** Aggregated cluster↔cluster link — what the canvas actually draws. Only
 *  CROSS-cluster edges aggregate (intra-cluster structure belongs to the
 *  modal, not the sky), and the pair key is direction-free: the canvas shows
 *  that two families are connected, the modal says how. */
export interface ClusterLink {
  a: string;
  b: string;
  count: number;
}

export function buildEdgeViews(
  edges: readonly PatternEdgeLike[],
  items: readonly KnowledgeItemView[],
): { byPractice: Map<string, RelatedPattern[]>; clusterLinks: ClusterLink[] } {
  const itemById = new Map(items.map((i) => [i.id, i]));
  const byPractice = new Map<string, RelatedPattern[]>();
  const pairs = new Map<string, ClusterLink>();

  for (const e of edges) {
    const from = itemById.get(e.fromId);
    const to = itemById.get(e.toId);
    // An edge whose endpoint left the library (or another workspace's row)
    // renders nowhere — but a half-resolvable edge still serves the modal.
    if (from) {
      const list = byPractice.get(e.fromId) ?? [];
      list.push({
        rel: e.rel,
        outgoing: true,
        otherId: e.toId,
        otherTitle: to?.title ?? e.toId,
        otherTopicKey: to ? topicClusterKey(to.topic) : null,
      });
      byPractice.set(e.fromId, list);
    }
    if (to) {
      const list = byPractice.get(e.toId) ?? [];
      list.push({
        rel: e.rel,
        outgoing: false,
        otherId: e.fromId,
        otherTitle: from?.title ?? e.fromId,
        otherTopicKey: from ? topicClusterKey(from.topic) : null,
      });
      byPractice.set(e.toId, list);
    }
    if (!from || !to) continue;
    const ka = topicClusterKey(from.topic);
    const kb = topicClusterKey(to.topic);
    if (!ka || !kb || ka === kb) continue;
    const key = ka < kb ? `${ka} ${kb}` : `${kb} ${ka}`;
    const link = pairs.get(key) ?? { a: ka < kb ? ka : kb, b: ka < kb ? kb : ka, count: 0 };
    link.count += 1;
    pairs.set(key, link);
  }
  return { byPractice, clusterLinks: [...pairs.values()] };
}
