import type { Node, Edge } from '@xyflow/react';
import type { LineageGraph, LineageNode } from './deriveLineageGraph';

/**
 * Layered left-to-right layout:
 *   col 0: event hubs + personas that have no incoming chain (roots)
 *   col 1: triggers whose upstream is from col 0
 *   col 2: personas owned by col 1 triggers (consumers)
 *   col 3: further chained triggers, col 4: further personas, ...
 *
 * Falls back to a deterministic stack-by-id placement so the layout is
 * stable across renders.
 */
const COL_GAP = 240;
const ROW_GAP = 90;
const START_X = 60;
const START_Y = 60;

export function computeLineageLayout(graph: LineageGraph): { nodes: Node[]; edges: Edge[] } {
  // Build adjacency from source -> target (using node ids)
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const e of graph.edges) {
    const out = outgoing.get(e.source) ?? [];
    out.push(e.target);
    outgoing.set(e.source, out);
    const inc = incoming.get(e.target) ?? [];
    inc.push(e.source);
    incoming.set(e.target, inc);
  }

  // Rank by BFS from nodes with no incoming edge.
  const rank = new Map<string, number>();
  const queue: string[] = [];
  for (const n of graph.nodes) {
    if ((incoming.get(n.id) ?? []).length === 0) {
      rank.set(n.id, 0);
      queue.push(n.id);
    }
  }

  // If we have cycles, some nodes won't be reached by the BFS — assign them
  // a fallback rank based on max(predecessor rank) + 1 in a few passes.
  while (queue.length > 0) {
    const current = queue.shift()!;
    const r = rank.get(current) ?? 0;
    for (const next of outgoing.get(current) ?? []) {
      const nextRank = rank.get(next);
      if (nextRank === undefined || nextRank < r + 1) {
        rank.set(next, r + 1);
        queue.push(next);
      }
    }
  }

  // Cycle nodes: assign ranks via 5 stabilization passes
  for (let pass = 0; pass < 5; pass += 1) {
    let mutated = false;
    for (const n of graph.nodes) {
      if (rank.has(n.id)) continue;
      const preds = incoming.get(n.id) ?? [];
      let best: number | null = null;
      for (const p of preds) {
        const pr = rank.get(p);
        if (pr !== undefined && (best === null || pr > best)) best = pr;
      }
      if (best !== null) {
        rank.set(n.id, best + 1);
        mutated = true;
      }
    }
    if (!mutated) break;
  }
  // Any remaining unranked node gets rank 0
  for (const n of graph.nodes) if (!rank.has(n.id)) rank.set(n.id, 0);

  // Group nodes by rank, sort within rank by kind then id for stability.
  const kindOrder: Record<LineageNode['kind'], number> = { event: 0, persona: 1, trigger: 2 };
  const byRank = new Map<number, LineageNode[]>();
  for (const n of graph.nodes) {
    const r = rank.get(n.id) ?? 0;
    const list = byRank.get(r) ?? [];
    list.push(n);
    byRank.set(r, list);
  }
  for (const list of byRank.values()) {
    list.sort((a, b) => {
      const ko = kindOrder[a.kind] - kindOrder[b.kind];
      if (ko !== 0) return ko;
      return a.id.localeCompare(b.id);
    });
  }

  const rfNodes: Node[] = [];
  const sortedRanks = Array.from(byRank.keys()).sort((a, b) => a - b);
  for (const r of sortedRanks) {
    const list = byRank.get(r)!;
    list.forEach((n, idx) => {
      rfNodes.push({
        id: n.id,
        type: kindToNodeType(n.kind),
        position: { x: START_X + r * COL_GAP, y: START_Y + idx * ROW_GAP },
        data: {} as Record<string, unknown>,
      });
    });
  }

  const rfEdges: Edge[] = graph.edges.map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'smoothstep',
    animated: e.kind === 'chain' && !e.inCycle,
    data: { kind: e.kind, inCycle: e.inCycle },
  }));

  return { nodes: rfNodes, edges: rfEdges };
}

function kindToNodeType(kind: LineageNode['kind']): string {
  if (kind === 'persona') return 'lineagePersona';
  if (kind === 'trigger') return 'lineageTrigger';
  return 'lineageEvent';
}
