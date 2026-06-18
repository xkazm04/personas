import type { GraphNode, GraphEdge, GraphNodeKind } from './credentialGraph';

// ---------------------------------------------------------------------------
// Deterministic layout for the credential relationship graph. Three kind
// clusters (credentials / agents / events) sit on a circle around the centre;
// within each cluster nodes are placed on a phyllotaxis spiral, highest-degree
// first (so hubs land near the cluster core). Node radius encodes degree —
// the more relationships a node has, the larger it draws.
// ---------------------------------------------------------------------------

export interface NodePos { x: number; y: number; r: number; kind: GraphNodeKind }

export const KIND_ORDER: GraphNodeKind[] = ['credential', 'agent', 'event'];

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function clusterCenters(width: number, height: number): Record<GraphNodeKind, { x: number; y: number }> {
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.30;
  const out = {} as Record<GraphNodeKind, { x: number; y: number }>;
  KIND_ORDER.forEach((kind, i) => {
    // Start at the top (-90°) and step evenly clockwise.
    const angle = ((-90 + i * (360 / KIND_ORDER.length)) * Math.PI) / 180;
    out[kind] = { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  });
  return out;
}

export function nodeDegrees(edges: GraphEdge[]): Map<string, number> {
  const degrees = new Map<string, number>();
  for (const e of edges) {
    degrees.set(e.source, (degrees.get(e.source) ?? 0) + 1);
    degrees.set(e.target, (degrees.get(e.target) ?? 0) + 1);
  }
  return degrees;
}

export function nodeRadius(degree: number): number {
  return 7 + Math.min(degree, 9) * 1.5; // 7 (isolated) … 20.5 (hub)
}

export function computeGraphLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number,
): Map<string, NodePos> {
  const positions = new Map<string, NodePos>();
  if (width <= 0 || height <= 0) return positions;

  const degree = nodeDegrees(edges);
  const centers = clusterCenters(width, height);
  const groups = new Map<GraphNodeKind, GraphNode[]>();
  for (const n of nodes) {
    const list = groups.get(n.kind) ?? [];
    list.push(n);
    groups.set(n.kind, list);
  }

  const pad = 28;
  for (const [kind, members] of groups) {
    const center = centers[kind];
    const sorted = [...members].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0));
    const spacing = 9 + Math.sqrt(members.length) * 3.4;
    sorted.forEach((node, i) => {
      const r = nodeRadius(degree.get(node.id) ?? 0);
      const dist = i === 0 ? 0 : spacing * Math.sqrt(i);
      const angle = i * GOLDEN_ANGLE;
      const x = Math.max(pad, Math.min(width - pad, center.x + Math.cos(angle) * dist));
      const y = Math.max(pad, Math.min(height - pad, center.y + Math.sin(angle) * dist));
      positions.set(node.id, { x, y, r, kind });
    });
  }
  return positions;
}
