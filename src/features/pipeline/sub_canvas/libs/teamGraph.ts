import type { PersonaTeamConnection } from '@/lib/bindings/PersonaTeamConnection';

/**
 * Derived graph topology from team members and connections.
 *
 * Computes Kahn's topological sort, layer assignments, cycle detection,
 * and adjacency data in a single pass. Consumed by auto-layout, dry-run
 * ordering, and optimizer analysis.
 */
export interface TeamGraph {
  /** Node IDs in topological order. Cycle nodes are appended at the end. */
  sorted: string[];
  /** Layer index per node ID (for Sugiyama-style layered layout). */
  layers: Map<string, number>;
  /** Node IDs that are part of a cycle (unsorted by Kahn's algorithm). */
  cycleNodes: Set<string>;
  /** Forward adjacency list: source → target[]. */
  adj: Map<string, string[]>;
}

/**
 * Build a TeamGraph from node IDs and connections.
 *
 * @param nodeIds - All member IDs to include in the graph
 * @param connections - Team connections (edges)
 * @param skipTypes - Connection types to exclude (e.g. 'feedback' to break cycles)
 */
export function buildTeamGraph(
  nodeIds: string[],
  connections: PersonaTeamConnection[],
  skipTypes?: Set<string>,
): TeamGraph {
  const idSet = new Set(nodeIds);
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }

  for (const c of connections) {
    if (!idSet.has(c.source_member_id) || !idSet.has(c.target_member_id)) continue;
    if (skipTypes?.has(c.connection_type ?? '')) continue;
    adj.get(c.source_member_id)!.push(c.target_member_id);
    inDegree.set(c.target_member_id, (inDegree.get(c.target_member_id) ?? 0) + 1);
  }

  // Kahn's algorithm: topological sort + layer assignment
  const queue: string[] = [];
  const layers = new Map<string, number>();

  for (const [id, deg] of inDegree) {
    layers.set(id, 0);
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  const inDegCopy = new Map(inDegree);

  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);
    for (const neighbor of adj.get(node) ?? []) {
      const parentLayer = layers.get(node) ?? 0;
      layers.set(neighbor, Math.max(layers.get(neighbor) ?? 0, parentLayer + 1));
      const newDeg = (inDegCopy.get(neighbor) ?? 1) - 1;
      inDegCopy.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  // Nodes not reached by Kahn's are in cycles
  const cycleNodes = new Set<string>();
  const maxLayer = sorted.length > 0
    ? Math.max(...Array.from(layers.values()))
    : 0;

  for (const id of nodeIds) {
    if (!sorted.includes(id)) {
      cycleNodes.add(id);
      sorted.push(id);
      layers.set(id, maxLayer + 1);
    }
  }

  return { sorted, layers, cycleNodes, adj };
}
