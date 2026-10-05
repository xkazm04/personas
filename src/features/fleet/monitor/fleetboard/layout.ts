// layout — where every bay and every tile goes, as a pure function of the
// field's measured size and each bay's headcount. No DOM, no React: the
// Board's whole geometry is unit-tested at the Monitor's real body sizes.
//
// BAYS FILL THE FIELD BY HEADCOUNT. A bay weighs its members plus the
// nameplate it always carries, and every candidate packing gives each bay an
// area proportional to that weight, so the bays tile the field edge to edge
// (no leftover band, by construction) and a singleton is compact. The
// candidates are packed ROWS (bays share a row's height, R rows), packed
// COLUMNS (the same, transposed) and a squarified treemap; each is scored by
// the tiles it can draw - the smallest tile on the board first, since the
// smallest one is the one the operator has to read - and the best one wins.
// Equal teams land on a regular grid (rows), one big team beside many
// singletons lands as a treemap (the big bay a column, the singletons
// squares). Bays are packed largest first; ties keep the roster order, so the
// picture holds still while headcounts do.
//
// TILES fill each bay's body: the column count that gives the largest tile
// whose aspect stays readable, stretched to the body. One size per bay.

export interface Rect { x: number; y: number; w: number; h: number }
export type Tier = 'small' | 'medium' | 'large';

export interface BayInput { id: string; count: number }

export interface BayLayout {
  id: string;
  /** The bay's frame, nameplate included. */
  rect: Rect;
  /** One rect per member, in the bay's reading order. */
  tiles: Rect[];
  tier: Tier;
}

/** Field inset, gap between bays, nameplate height, inner padding, tile gap. */
export const GEOMETRY = { edge: 6, gap: 8, head: 30, pad: 5, tileGap: 5 } as const;

/** A bay's weight in tile units: its members plus the nameplate it carries. */
export const HEAD_WEIGHT = 0.55;

/** Tile shape limits: wider than this reads as a bar, taller as a pillar. */
const MAX_ASPECT = 2.4;
const MIN_ASPECT = 0.7;

/** How readable a tile of this shape is per pixel: 1 inside 1.0-1.6 (a card), less as it bars or pillars. */
export function shapeFactor(w: number, h: number): number {
  const a = h > 0 ? w / h : 0;
  if (a > 1.6) return (1.6 / a) ** 0.8;
  return a < 1 ? a ** 0.8 : 1;
}

/** Tier thresholds (px). Small: initials + glyph. Large: + the figures. */
export function tierOf(w: number, h: number): Tier {
  if (w < 88 || h < 58) return 'small';
  return w >= 160 && h >= 146 ? 'large' : 'medium';
}

// --- packings: areas (desc, scaled to `r`) -> one rect each, same order -----

function worst(row: readonly number[], side: number): number {
  let sum = 0, max = 0, min = Infinity;
  for (const a of row) { sum += a; if (a > max) max = a; if (a < min) min = a; }
  const s2 = sum * sum, w2 = side * side;
  return Math.max((w2 * max) / s2, s2 / (w2 * min));
}

/** Lay `row` as a strip along the short side of `r`; returns the strip's rects and the rest. */
function strip(row: readonly number[], r: Rect, vertical: boolean): [Rect[], Rect] {
  const sum = row.reduce((s, a) => s + a, 0);
  const out: Rect[] = [];
  if (vertical) {
    const cw = r.h > 0 ? sum / r.h : 0;
    let y = r.y;
    for (const a of row) { const h = cw > 0 ? a / cw : 0; out.push({ x: r.x, y, w: cw, h }); y += h; }
    return [out, { x: r.x + cw, y: r.y, w: r.w - cw, h: r.h }];
  }
  const rh = r.w > 0 ? sum / r.w : 0;
  let x = r.x;
  for (const a of row) { const w = rh > 0 ? a / rh : 0; out.push({ x, y: r.y, w, h: rh }); x += w; }
  return [out, { x: r.x, y: r.y + rh, w: r.w, h: r.h - rh }];
}

/** Squarified treemap (Bruls, Huizing, van Wijk). */
export function squarify(areas: readonly number[], rect: Rect): Rect[] {
  const out: Rect[] = [];
  let r = { ...rect };
  for (let i = 0; i < areas.length;) {
    const side = Math.min(r.w, r.h);
    const row = [areas[i]!];
    let j = i + 1;
    while (j < areas.length && worst([...row, areas[j]!], side) <= worst(row, side)) row.push(areas[j++]!);
    const [rects, rest] = strip(row, r, r.w >= r.h);
    out.push(...rects);
    r = rest;
    i = j;
  }
  return out;
}

/** `lines` balanced strips (rows, or columns when `vertical`), in order. */
export function packLines(areas: readonly number[], rect: Rect, lines: number, vertical: boolean): Rect[] {
  const total = areas.reduce((s, a) => s + a, 0);
  const out: Rect[] = [];
  let r = { ...rect };
  let i = 0;
  for (let line = 0; line < lines && i < areas.length; line++) {
    const left = lines - line;
    const target = (total - out.reduce((s, x) => s + x.w * x.h, 0)) / left;
    const row = [areas[i++]!];
    let sum = row[0]!;
    // Take the next bay while it brings the line closer to its share, and
    // while enough bays remain to give every later line at least one.
    while (i < areas.length && areas.length - i > left - 1
      && Math.abs(sum + areas[i]! - target) <= Math.abs(sum - target)) { sum += areas[i]!; row.push(areas[i++]!); }
    if (line === lines - 1) while (i < areas.length) row.push(areas[i++]!);
    const [rects, rest] = strip(row, r, vertical);
    out.push(...rects);
    r = rest;
  }
  return out;
}

// --- tiles inside one bay ----------------------------------------------------

export interface TileGrid { cols: number; rows: number; tw: number; th: number }

/** The grid of `n` equal tiles that fills `w`x`h` with the largest readable tile. */
export function fitTiles(n: number, w: number, h: number, gap: number): TileGrid {
  let best: TileGrid & { score: number } = { cols: 1, rows: 1, tw: 0, th: 0, score: -1 };
  for (let cols = 1; cols <= Math.max(1, n); cols++) {
    const rows = Math.ceil(n / cols);
    const cw = (w - (cols - 1) * gap) / cols;
    const ch = (h - (rows - 1) * gap) / rows;
    if (cw <= 0 || ch <= 0) continue;
    const tw = Math.min(cw, ch * MAX_ASPECT);
    const th = Math.min(ch, cw / MIN_ASPECT);
    const score = tw * th * shapeFactor(tw, th) * (1 - 0.04 * (rows * cols - n));
    if (score > best.score) best = { cols, rows, tw, th, score };
  }
  return { cols: best.cols, rows: best.rows, tw: best.tw, th: best.th };
}

/** A tile never grows past this (a zoomed team of two must not draw two posters). */
export interface TileCap { w: number; h: number }

function bayIn(id: string, cell: Rect, n: number, cap?: TileCap): BayLayout {
  const { gap, head, pad, tileGap } = GEOMETRY;
  const rect = { x: cell.x + gap / 2, y: cell.y + gap / 2, w: Math.max(0, cell.w - gap), h: Math.max(0, cell.h - gap) };
  const iw = rect.w - 2 * pad, ih = rect.h - head - pad;
  const fit = fitTiles(n, Math.max(0, iw), Math.max(0, ih), tileGap);
  const g = cap ? { ...fit, tw: Math.min(fit.tw, cap.w), th: Math.min(fit.th, cap.h) } : fit;
  // Centre whatever the aspect cap left over (zero for a well-shaped bay).
  const ox = rect.x + pad + (iw - (g.cols * g.tw + (g.cols - 1) * tileGap)) / 2;
  const oy = rect.y + head + (ih - (g.rows * g.th + (g.rows - 1) * tileGap)) / 2;
  const tiles = Array.from({ length: n }, (_, k) => ({
    x: ox + (k % g.cols) * (g.tw + tileGap), y: oy + Math.floor(k / g.cols) * (g.th + tileGap), w: g.tw, h: g.th,
  }));
  return { id, rect, tiles, tier: tierOf(g.tw, g.th) };
}

// --- the field ----------------------------------------------------------------

/**
 * Lay out the whole field. Bays with no members are not drawn (an empty bay is
 * an empty band). Returned bays keep the INPUT order, so a caller can zip them
 * with its own bay list; only their rects follow the packing order.
 */
export function layoutField(bays: readonly BayInput[], width: number, height: number, cap?: TileCap): BayLayout[] {
  const { edge, gap } = GEOMETRY;
  const live = bays.map((b, i) => ({ ...b, i })).filter((b) => b.count > 0);
  if (live.length === 0 || width <= 0 || height <= 0) return [];
  const packed = [...live].sort((a, b) => b.count - a.count || a.i - b.i);
  // Packed on the field grown by half a gap per side; each bay is then inset by
  // half a gap, so neighbours sit one gap apart and outer bays `edge` from the border.
  const outer: Rect = { x: edge - gap / 2, y: edge - gap / 2, w: width - 2 * edge + gap, h: height - 2 * edge + gap };
  const weights = packed.map((b) => b.count + HEAD_WEIGHT);
  const scale = (outer.w * outer.h) / weights.reduce((s, w) => s + w, 0);
  const areas = weights.map((w) => w * scale);

  const candidates: Rect[][] = [squarify(areas, outer)];
  const maxLines = Math.min(packed.length, Math.ceil(Math.sqrt(packed.length)) + 2);
  for (let lines = 1; lines <= maxLines; lines++) {
    candidates.push(packLines(areas, outer, lines, false), packLines(areas, outer, lines, true));
  }

  let best: BayLayout[] = [];
  let bestScore = -1;
  for (const cells of candidates) {
    const laid = packed.map((b, k) => bayIn(b.id, cells[k]!, b.count, cap));
    const tileAreas = laid.map(({ tiles: [t] }) => t!.w * t!.h * shapeFactor(t!.w, t!.h));
    const min = Math.min(...tileAreas);
    const mean = tileAreas.reduce((s, a) => s + a, 0) / tileAreas.length;
    const score = min * 0.75 + mean * 0.25;
    if (score > bestScore) { bestScore = score; best = laid; }
  }
  const byId = new Map(best.map((b) => [b.id, b]));
  return live.map((b) => byId.get(b.id)!);
}
