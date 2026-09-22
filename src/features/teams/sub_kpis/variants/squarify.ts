// Squarified treemap layout (Bruls / Huizing / van Wijk, 2000) — pure, no
// React, no DOM. The portfolio treemap encodes SIZE as area, so the layout has
// to keep every rectangle's area proportional to its value; the squarified
// variant additionally keeps aspect ratios near 1 so a big project does not
// become an unreadable 400×3 sliver (registry: encoding-vocabulary).
//
// Zero-valued items are DROPPED rather than drawn at zero width: a project
// with no active KPIs has nothing to show, and a 0px rectangle would be a
// claim about a thing that is not there. Padding between cells is the
// caller's business — this returns the exact tiling of `rect`.

export interface TreemapItem {
  key: string;
  value: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TreemapCell extends Rect {
  key: string;
}

interface Scaled {
  key: string;
  a: number;
}

/** Worst aspect ratio of a row of areas laid along `side`. */
function worst(areas: number[], sum: number, side: number): number {
  if (sum <= 0 || side <= 0) return Infinity;
  let max = -Infinity;
  let min = Infinity;
  for (const a of areas) {
    if (a > max) max = a;
    if (a < min) min = a;
  }
  if (min <= 0) return Infinity;
  const s2 = sum * sum;
  const side2 = side * side;
  return Math.max((side2 * max) / s2, s2 / (side2 * min));
}

/**
 * Place one accepted row against the free rectangle's shorter side and return
 * what is left. The row's last cell is snapped to the far edge so float drift
 * can never leave a hairline gap or spill outside the container.
 */
function placeRow(row: Scaled[], rowSum: number, free: Rect, out: TreemapCell[]): Rect {
  if (free.h <= free.w) {
    const w = Math.min(free.w, rowSum / free.h);
    let y = free.y;
    for (let k = 0; k < row.length; k++) {
      const last = k === row.length - 1;
      const h = last ? free.y + free.h - y : Math.min(free.y + free.h - y, row[k]!.a / w);
      out.push({ key: row[k]!.key, x: free.x, y, w, h: Math.max(0, h) });
      y += h;
    }
    return { x: free.x + w, y: free.y, w: free.w - w, h: free.h };
  }
  const h = Math.min(free.h, rowSum / free.w);
  let x = free.x;
  for (let k = 0; k < row.length; k++) {
    const last = k === row.length - 1;
    const w = last ? free.x + free.w - x : Math.min(free.x + free.w - x, row[k]!.a / h);
    out.push({ key: row[k]!.key, x, y: free.y, w: Math.max(0, w), h });
    x += w;
  }
  return { x: free.x, y: free.y + h, w: free.w, h: free.h - h };
}

/**
 * Tile `rect` with one cell per positive-valued item, area ∝ value, sorted
 * value-descending. Returns `[]` for an empty item list or a degenerate rect.
 */
export function squarify(items: TreemapItem[], rect: Rect): TreemapCell[] {
  if (rect.w <= 0 || rect.h <= 0) return [];
  const positive = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
  if (positive.length === 0) return [];
  const total = positive.reduce((s, i) => s + i.value, 0);
  const area = rect.w * rect.h;
  const scaled: Scaled[] = positive.map((i) => ({ key: i.key, a: (i.value / total) * area }));

  const out: TreemapCell[] = [];
  let free: Rect = { ...rect };
  let i = 0;
  while (i < scaled.length) {
    if (free.w <= 0 || free.h <= 0) break;
    const side = Math.min(free.w, free.h);
    const row: Scaled[] = [scaled[i]!];
    let rowSum = scaled[i]!.a;
    let j = i + 1;
    while (j < scaled.length) {
      const areas = row.map((r) => r.a);
      const nextSum = rowSum + scaled[j]!.a;
      if (worst([...areas, scaled[j]!.a], nextSum, side) > worst(areas, rowSum, side)) break;
      row.push(scaled[j]!);
      rowSum = nextSum;
      j += 1;
    }
    free = placeRow(row, rowSum, free, out);
    i = j;
  }
  return out;
}
