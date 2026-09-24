// Soundings — every position on the chart, derived. Nothing here reads the DOM:
// the view measures the chart once (ResizeObserver) and everything else is a
// function of that size, the level and the data, so nothing drifts.
//
// Ported from the contest prototype's imperative layout (geo / stRect / yFor /
// layoutColumn / spatial), which the owner reviewed at 1192 x 680.
import type { DimKey } from '../lib/dimRegistry';
import type { DimCategory } from '../lib/dimRegistry';
import { BAND_EDGES, BAND_OF, LANES, type Band } from './soundingsModel';
import type { DimStatus } from '../lib/types';

export type Level = 0 | 1 | 2;

export interface ChartGeo {
  W: number;
  H: number;
  /** Width of the band legend on the left. */
  legend: number;
  /** Station area, left and right edge. */
  x0: number;
  x1: number;
  /** Waterline, and the Shallows/Mid-water and Mid-water/Deep edges at L0. */
  wl: number;
  b1: number;
  b2: number;
  /** Seabed line. */
  bed: number;
  /** One station's width at L0. */
  colW0: number;
  /** One sliver's width at L1/L2. */
  sliver: number;
}

/** The narrow layout kicks in below this chart width. */
const NARROW = 1150;

export function chartGeometry(W: number, H: number, stations: number): ChartGeo {
  const legend = W < NARROW ? 82 : 104;
  const x0 = legend;
  const x1 = W - 14;
  return {
    W, H, legend, x0, x1,
    wl: Math.round(H * 0.32),
    b1: Math.round(H * 0.545),
    b2: Math.round(H * 0.765),
    bed: H - 24,
    colW0: (x1 - x0) / Math.max(1, stations),
    sliver: W < NARROW ? 20 : 26,
  };
}

export interface Span { l: number; w: number }

/** Where station `i` sits. At L0 every station has an equal column; above L0 the
 *  open station `cur` widens and the rest shrink to slivers that keep their order. */
export function stationSpan(g: ChartGeo, i: number, level: Level, cur: number, n: number): Span {
  if (level === 0) {
    const l = Math.round(g.x0 + i * g.colW0);
    return { l, w: Math.round(g.x0 + (i + 1) * g.colW0) - l };
  }
  if (i < cur) return { l: g.x0 + i * g.sliver, w: g.sliver };
  if (i > cur) return { l: g.x1 - (n - i) * g.sliver, w: g.sliver };
  return { l: g.x0 + cur * g.sliver, w: g.x1 - g.x0 - (n - 1) * g.sliver };
}

/** Centre of station `i`'s L0 column — the comparison strip reuses these. */
export function stationCentre(g: ChartGeo, i: number): number {
  return g.x0 + (i + 0.5) * g.colW0;
}

/** Buoy depth for an urgency: above the waterline for Surface, then one band each. */
export function buoyDepth(g: ChartGeo, u: number): number {
  const { wl, b1, b2, bed } = g;
  if (u >= BAND_EDGES.surface) {
    const k = Math.min(1, (u - BAND_EDGES.surface) / 10);
    return Math.round(wl - 30 - k * (wl - 30 - 64));
  }
  if (u >= BAND_EDGES.shallows) return Math.round(wl + 44 + ((BAND_EDGES.surface - u) / 4) * (b1 - wl - 56));
  if (u >= BAND_EDGES.midwater) return Math.round(b1 + 40 + (BAND_EDGES.shallows - u) * (b2 - b1 - 52));
  return Math.round(b2 + 40 + Math.max(0, 1 - u) * (bed - b2 - 58));
}

/** A gentle contour: quadratic swells every 40 px. */
export function wavePath(y: number, W: number, amp: number, phase: number): string {
  let d = `M0 ${y}`;
  for (let x = 0; x <= W + 40; x += 40) {
    const up = ((x / 40) + phase) % 2 ? amp : -amp;
    d += ` Q${x + 20} ${(y + up).toFixed(1)} ${x + 40} ${y}`;
  }
  return d;
}

/** A current: an arc between two anchors that rises from the seabed. */
export function currentArc(xa: number, xb: number, g: ChartGeo): { d: string; labelX: number; labelY: number } {
  const hh = Math.min(g.H * 0.2, 16 + Math.abs(xb - xa) * 0.11);
  const y = g.bed;
  const d = `M${xa.toFixed(1)} ${y} C${xa.toFixed(1)} ${(y - hh).toFixed(1)} ${xb.toFixed(1)} ${(y - hh).toFixed(1)} ${xb.toFixed(1)} ${y}`;
  return { d, labelX: Math.round((xa + xb) / 2), labelY: Math.round(y - hh * 0.75 - 9) };
}

/** Where a current leaves a station: the open column's near edge, else the centre. */
export function anchorX(g: ChartGeo, i: number, other: number, level: Level, cur: number, n: number): number {
  const r = stationSpan(g, i, level, cur, n);
  if (level > 0 && i === cur) return other < i ? r.l + 10 : r.l + r.w - 10;
  return r.l + r.w / 2;
}

// ── The water column (L1) ────────────────────────────────────────────────────

export interface ColumnReading {
  key: DimKey;
  status: DimStatus;
  category: DimCategory;
  /** The frame carries a second line (the tool, or "could not read"). */
  twoLine: boolean;
}

export interface FrameBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** One-line frame: no second line to show. */
  one: boolean;
  /** Squeezed below the comfortable height: tighter padding. */
  tight: boolean;
}

export interface ColumnLayout {
  /** Frames, relative to the column's left edge and the chart's top. */
  frames: Partial<Record<DimKey, FrameBox>>;
  /** The band edges INSIDE the open station (they differ from L0's). */
  b1: number;
  b2: number;
  /** Lane divider x positions, relative to the column. */
  lanes: number[];
}

/** Bottom of the column's strip (live work, next ship, …), relative to the chart top. */
export const STRIP_BOTTOM = 56;
const COLUMN_PAD = 14;
const MIN_FRAME_W = 150;
const GAP = 4;

/**
 * Pack a station's readings into 4 lanes x 4 bands. Frames shrink (46 -> 38 px,
 * then padding) before anything overflows; the Surface band stacks upward from
 * the waterline, the others centre in their band. Bands share leftover water
 * evenly, so an empty band still reads as a band.
 */
export function layoutColumn(g: ChartGeo, columnWidth: number, readings: readonly ColumnReading[]): ColumnLayout {
  const cw = columnWidth - 2 * COLUMN_PAD;
  const laneW = cw / 4;
  const cellW = laneW - 12;
  const cols = Math.max(1, Math.min(3, Math.floor((cellW + 6) / (MIN_FRAME_W + 6))));
  const fw = Math.floor((cellW - (cols - 1) * 6) / cols);
  const one = (r: ColumnReading) => !r.twoLine;

  const cells = new Map<string, ColumnReading[]>();
  LANES.forEach((lane, li) => {
    for (let bi = 0; bi < 4; bi++) {
      const items = readings.filter((r) => r.category === lane && BAND_OF[r.status] === bi);
      // Alerts lead the Surface band.
      if (bi === 0) items.sort((a, b) => Number(b.status === 'alert') - Number(a.status === 'alert'));
      cells.set(`${li}:${bi}`, items);
    }
  });

  const rowHeights = (items: readonly ColumnReading[], h2: number, h1: number) => {
    const out: number[] = [];
    for (let k = 0; k < items.length; k += cols) {
      let m = 0;
      for (let j = k; j < Math.min(items.length, k + cols); j++) m = Math.max(m, one(items[j]!) ? h1 : h2);
      out.push(m);
    }
    return out;
  };
  const stackHeight = (items: readonly ColumnReading[], h2: number, h1: number) => {
    const rs = rowHeights(items, h2, h1);
    return rs.reduce((a, b) => a + b, 0) + Math.max(0, rs.length - 1) * GAP;
  };
  const bandNeed = (bi: Band, h2: number, h1: number, pad: number) => {
    let m = 0;
    for (let li = 0; li < 4; li++) {
      const it = cells.get(`${li}:${bi}`)!;
      if (it.length) m = Math.max(m, stackHeight(it, h2, h1));
    }
    return m ? m + 2 * pad : 28;
  };

  const water = g.bed - g.wl - 6;
  let h2 = 46;
  let h1 = 32;
  let pad = 8;
  const total = () => bandNeed(1, h2, h1, pad) + bandNeed(2, h2, h1, pad) + bandNeed(3, h2, h1, pad);
  while (total() > water && h2 > 38) { h2--; if (h1 > 26) h1--; }
  while (total() > water && pad > 3) pad--;
  const hs = ([1, 2, 3] as const).map((b) => bandNeed(b, h2, h1, pad));
  const extra = Math.max(0, water - hs[0]! - hs[1]! - hs[2]!);
  const b1 = Math.round(g.wl + 6 + hs[0]! + extra / 3);
  const b2 = Math.round(b1 + hs[1]! + extra / 3);

  const bands: Array<[number, number]> = [[STRIP_BOTTOM + 8, g.wl - 7], [g.wl + 6, b1], [b1, b2], [b2, g.bed]];
  const frames: Partial<Record<DimKey, FrameBox>> = {};
  LANES.forEach((_, li) => {
    for (let bi = 0; bi < 4; bi++) {
      const items = cells.get(`${li}:${bi}`)!;
      if (!items.length) continue;
      const [top, bot] = bands[bi]!;
      let a2 = h2;
      let a1 = h1;
      if (bi === 0) while (stackHeight(items, a2, a1) > bot - top && a2 > 38) { a2--; if (a1 > 26) a1--; }
      const rs = rowHeights(items, a2, a1);
      const blockH = stackHeight(items, a2, a1);
      let yy = bi === 0 ? bot - blockH : Math.round(top + (bot - top - blockH) / 2);
      rs.forEach((rh, ro) => {
        for (let co = 0; co < cols; co++) {
          const r = items[ro * cols + co];
          if (!r) break;
          const isOne = one(r);
          frames[r.key] = {
            x: Math.round(COLUMN_PAD + li * laneW + 6 + co * (fw + 6)),
            y: Math.round(yy),
            w: fw,
            h: isOne ? Math.min(rh, a1) : rh,
            one: isOne,
            tight: a2 < 42,
          };
        }
        yy += rh + GAP;
      });
    }
  });

  return { frames, b1, b2, lanes: [1, 2, 3].map((k) => Math.round(COLUMN_PAD + k * laneW)) };
}

export type ArrowKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

/** The frame an arrow key moves to: the nearest one in that direction, with
 *  sideways drift weighted 2.4x so "right" means the frame beside you. */
export function spatialMove(frames: Partial<Record<DimKey, FrameBox>>, from: DimKey, dir: ArrowKey): DimKey | null {
  const a = frames[from];
  if (!a) return null;
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  let best: DimKey | null = null;
  let bestScore = Infinity;
  for (const [k, b] of Object.entries(frames) as Array<[DimKey, FrameBox]>) {
    if (k === from) continue;
    const dx = b.x + b.w / 2 - ax;
    const dy = b.y + b.h / 2 - ay;
    const [main, cross] = dir === 'ArrowRight' ? [dx, dy] : dir === 'ArrowLeft' ? [-dx, dy] : dir === 'ArrowDown' ? [dy, dx] : [-dy, dx];
    if (main <= 3) continue;
    const s = main + Math.abs(cross) * 2.4;
    if (s < bestScore) { bestScore = s; best = k; }
  }
  return best;
}

// ── The lifted sample (L2) ───────────────────────────────────────────────────

export interface Box { x: number; y: number; w: number; h: number }

/** The card a reading rises into: the station area's width, 60% of the chart.
 *  The project file is a document (live work, release plan, readiness,
 *  relations), so it takes the whole water depth instead of clipping. */
export function cardBox(g: ChartGeo, tall = false): Box {
  const h = tall ? g.H - 16 : Math.min(g.H - 36, Math.max(300, g.H * 0.6));
  return { x: g.x0 + 6, y: 8, w: g.x1 - g.x0 - 12, h: Math.round(h) };
}

/** The comparison strip's marker top for a band (the strip under the card). */
export const compareY = (band: Band): number => 22 + band * 15;
