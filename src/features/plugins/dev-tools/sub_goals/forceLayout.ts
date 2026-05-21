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
}

export function nodeRadius(goal: DevGoal): number {
  return 18 + (goal.progress / 100) * 14;
}

export const STATUS_COLORS: Record<string, { fill: string; stroke: string; glow: string }> = {
  open: { fill: '#3B82F6', stroke: '#60A5FA', glow: 'rgba(59, 130, 246, 0.3)' },
  'in-progress': { fill: '#F59E0B', stroke: '#FBBF24', glow: 'rgba(245, 158, 11, 0.4)' },
  done: { fill: '#10B981', stroke: '#34D399', glow: 'rgba(16, 185, 129, 0.3)' },
  blocked: { fill: '#EF4444', stroke: '#F87171', glow: 'rgba(239, 68, 68, 0.4)' },
};

export function runForceSimulation(
  nodes: NodePos[],
  edges: { source: string; target: string }[],
  width: number,
  height: number,
  iterations: number = 120,
): NodePos[] {
  const cx = width / 2;
  const cy = height / 2;

  nodes.forEach((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2;
    const r = Math.min(width, height) * 0.3;
    n.x = cx + Math.cos(angle) * r;
    n.y = cy + Math.sin(angle) * r;
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
