// Cartogram geometry + aggregation.
//
// The rail's whole claim is that AREA IS COUNT: a 66-item territory must render
// ~6.6x the surface of a 10-item one, and an 11-item cluster must not be able to
// borrow visual weight from a 1-item neighbour. So the layout is a squarified
// treemap in unit space (0..1 on both axes) — resolution independent, the
// consumer just multiplies by 100 and emits percentages.
import { areaOf } from './knowledgeTableShared';
import type { KnowledgeItemView } from './libraryModel';

export interface Territory {
  /** Full topic path ('frontend' for an area, 'frontend/state' for a cluster). */
  path: string;
  /** Last path segment — what the block is labelled with. */
  label: string;
  total: number;
  adopted: number;
  /** Undecided (`observed` / `proposed`) — the backlog the rail must expose. */
  pending: number;
  children: Territory[];
}

export interface Cell {
  path: string;
  /** Unit-space rect, 0..1 on both axes. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Areas (sorted by mass, descending) with their clusters nested underneath. */
export function buildTerritories(items: readonly KnowledgeItemView[]): Territory[] {
  const areas = new Map<string, Map<string, KnowledgeItemView[]>>();
  for (const item of items) {
    const area = areaOf(item);
    const cluster = item.topic || area;
    let clusters = areas.get(area);
    if (!clusters) areas.set(area, (clusters = new Map()));
    const bucket = clusters.get(cluster);
    if (bucket) bucket.push(item);
    else clusters.set(cluster, [item]);
  }

  const roll = (path: string, rows: KnowledgeItemView[], children: Territory[]): Territory => ({
    path,
    label: path.split('/').pop() ?? path,
    total: rows.length,
    adopted: rows.filter((i) => i.status === 'adopted').length,
    pending: rows.filter((i) => i.status === 'observed' || i.status === 'proposed').length,
    children,
  });

  return [...areas.entries()]
    .map(([area, clusters]) => {
      const rows = [...clusters.values()].flat();
      const children = [...clusters.entries()]
        .map(([path, bucket]) => roll(path, bucket, []))
        .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
      return roll(area, rows, children);
    })
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

/** Aspect ratio of the worst cell in a candidate row — the squarify objective. */
function worstRatio(row: readonly Territory[], sum: number, side: number, scale: number): number {
  const thickness = (sum * scale) / side;
  if (thickness <= 0) return Infinity;
  let worst = 1;
  for (const cell of row) {
    const len = (cell.total * scale) / thickness;
    if (len <= 0) return Infinity;
    worst = Math.max(worst, thickness / len, len / thickness);
  }
  return worst;
}

/**
 * Squarified treemap (Bruls/Huizing/van Wijk) over a unit rect. Cell area is
 * exactly proportional to `total`; the algorithm only chooses how to fold rows
 * so the cells stay near-square and therefore stay labellable.
 */
export function squarify(
  territories: readonly Territory[],
  rect: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: 1, h: 1 },
): Cell[] {
  const sorted = territories.filter((t) => t.total > 0).sort((a, b) => b.total - a.total);
  let remaining = sorted.reduce((s, t) => s + t.total, 0);
  if (remaining <= 0) return [];

  const out: Cell[] = [];
  let { x, y, w, h } = rect;
  let i = 0;

  while (i < sorted.length && w > 0 && h > 0) {
    const side = Math.min(w, h);
    const scale = (w * h) / remaining;
    let row: Territory[] = [];
    let sum = 0;
    let best = Infinity;
    let j = i;

    while (j < sorted.length) {
      const next = sorted[j]!;
      const candidate = worstRatio([...row, next], sum + next.total, side, scale);
      if (row.length > 0 && candidate > best) break;
      row = [...row, next];
      sum += next.total;
      best = candidate;
      j++;
    }

    const thickness = Math.min((sum * scale) / side, w <= h ? h : w);
    let offset = 0;
    for (const cell of row) {
      const len = thickness > 0 ? (cell.total * scale) / thickness : 0;
      out.push(
        w <= h
          ? { path: cell.path, x: x + offset, y, w: len, h: thickness }
          : { path: cell.path, x, y: y + offset, w: thickness, h: len },
      );
      offset += len;
    }

    if (w <= h) {
      y += thickness;
      h -= thickness;
    } else {
      x += thickness;
      w -= thickness;
    }
    remaining -= sum;
    i = j;
  }

  return out;
}
