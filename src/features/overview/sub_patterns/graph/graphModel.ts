// Topic-graph view model — areas → clusters ONLY. Individual practices are
// deliberately not nodes yet: the design round is about nailing typography /
// node sizing / canvas movement with ~100 nodes before the graph earns the
// right to carry a thousand. Counts on each node are the practices it would
// eventually fan out into.
import { AREA_ORDER } from './graphTheme';
import type { KnowledgeItemView } from '../libraryModel';

export interface ClusterNode {
  /** Full `area/cluster` topic path (the library's filter key). */
  topic: string;
  area: string;
  cluster: string;
  count: number;
  pending: number;
  adopted: number;
  /** The rows behind the node, newest first — the hover card's concrete data. */
  items: KnowledgeItemView[];
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
