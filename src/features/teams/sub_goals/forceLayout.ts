/**
 * Pure-JS force-directed layout for the goal constellation.
 * No D3 dependency — runs a fixed number of iterations to convergence.
 */

import type { DevGoal } from '@/lib/bindings/DevGoal';

export interface NodePos {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  /** Cluster key (e.g. canonical status) — nodes gravitate toward their
   *  group's anchor so the zoomed-out constellation has shape, not scatter. */
  group?: string;
}

export function nodeRadius(goal: DevGoal): number {
  return 18 + (goal.progress / 100) * 14;
}

export function runForceSimulation(
  nodes: NodePos[],
  edges: { source: string; target: string }[],
  width: number,
  height: number,
  iterations: number = 120,
  /** Per-group gravity anchors (see NodePos.group). Nodes without a group
   *  (or without an anchor) fall back to plain center gravity. */
  groupAnchors?: Map<string, { x: number; y: number }>,
): NodePos[] {
  const cx = width / 2;
  const cy = height / 2;

  nodes.forEach((n, i) => {
    // Seed near the group anchor when one exists (jittered ring so the
    // repulsion pass has something to push apart); otherwise the classic
    // center ring.
    const anchor = (n.group && groupAnchors?.get(n.group)) || undefined;
    const angle = (i / nodes.length) * Math.PI * 2;
    const r = anchor ? Math.min(width, height) * 0.08 : Math.min(width, height) * 0.3;
    n.x = (anchor?.x ?? cx) + Math.cos(angle) * r;
    n.y = (anchor?.y ?? cy) + Math.sin(angle) * r;
    n.vx = 0;
    n.vy = 0;
  });

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  for (let iter = 0; iter < iterations; iter++) {
    const alpha = 1 - iter / iterations;
    const decay = 0.3 * alpha;

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = (300 * decay) / (dist * dist);
        dx = (dx / dist) * force;
        dy = (dy / dist) * force;
        a.vx -= dx; a.vy -= dy;
        b.vx += dx; b.vy += dy;
      }
    }

    for (const edge of edges) {
      const a = nodeMap.get(edge.source);
      const b = nodeMap.get(edge.target);
      if (!a || !b) continue;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const force = (dist - 120) * 0.01 * decay;
      dx = (dx / dist) * force;
      dy = (dy / dist) * force;
      a.vx += dx; a.vy += dy;
      b.vx -= dx; b.vy -= dy;
    }

    for (const n of nodes) {
      // Group gravity (stronger) keeps clusters coherent; center gravity
      // (weaker) keeps the whole layout from drifting off-canvas.
      const anchor = (n.group && groupAnchors?.get(n.group)) || undefined;
      if (anchor) {
        n.vx += (anchor.x - n.x) * 0.03 * decay;
        n.vy += (anchor.y - n.y) * 0.03 * decay;
      }
      n.vx += (cx - n.x) * 0.005 * decay;
      n.vy += (cy - n.y) * 0.005 * decay;
      n.vx *= 0.6;
      n.vy *= 0.6;
      n.x += n.vx;
      n.y += n.vy;
      n.x = Math.max(n.radius + 10, Math.min(width - n.radius - 10, n.x));
      n.y = Math.max(n.radius + 10, Math.min(height - n.radius - 10, n.y));
    }
  }

  return nodes;
}
