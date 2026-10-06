/**
 * Where the instrument sits and where each lane runs, slim and widened. One
 * function for both states so the board is the spine pulled wide, never a
 * second drawing: every lane keeps its order, the axis keeps its bottom edge,
 * and only x positions, the body's width and the axis height change.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import type { Lane } from './timeModel';

export type SpineMode = 'slim' | 'board';

/** Distance of the instrument from the layer's right and bottom edges (the bottom clears the command line). */
export const EDGE = { right: 10, bottom: 78, top: 14 } as const;
/** Slim: room for gate arms on the left, lane pitch, cluster gap, ticks on the right. */
const SLIM = { left: 16, lane: 5, cluster: 8, right: 12, head: 42, foot: 24, maxLanes: 12, min: 54 } as const;
/** Board: the scale column, the lane column's width range, the label header, the key footer. */
const BOARD = { scale: 64, minCol: 108, maxCol: 156, right: 12, head: 132, foot: 40, laneInset: 12 } as const;

export interface Geometry {
  mode: SpineMode;
  width: number;
  height: number;
  head: number;
  axis: number;
  foot: number;
  /** Lane x inside the body, and the column each lane owns on the board. */
  xs: number[];
  col: number;
  shown: Lane[];
  hidden: number;
}

/** Index ranges of each project's lanes (Athena's is its own cluster). */
export function clusters(lanes: Lane[]): { project: string | null; from: number; to: number }[] {
  const out: { project: string | null; from: number; to: number }[] = [];
  lanes.forEach((l, i) => {
    const last = out[out.length - 1];
    if (last && last.project === l.project && l.project !== null) last.to = i;
    else out.push({ project: l.project, from: i, to: i });
  });
  return out;
}

export function geometry(mode: SpineMode, lanes: Lane[], layer: { width: number; height: number }): Geometry {
  if (mode === 'slim') {
    const shown = lanes.slice(0, SLIM.maxLanes);
    const xs: number[] = [];
    let x = SLIM.left;
    shown.forEach((l, i) => {
      if (i > 0) x += l.project !== shown[i - 1]!.project ? SLIM.cluster : SLIM.lane;
      xs.push(x);
    });
    // The last hour at a readable pitch, never more than about half the window.
    const axis = Math.round(Math.min(420, Math.max(220, layer.height * 0.38)));
    return {
      mode,
      width: Math.max(SLIM.min, x + SLIM.right),
      height: SLIM.head + axis + SLIM.foot,
      head: SLIM.head,
      axis,
      foot: SLIM.foot,
      xs,
      col: 0,
      shown,
      hidden: lanes.length - shown.length,
    };
  }
  // Board: as wide as the lanes want, never over the left third of a small window.
  const avail = Math.max(480, layer.width - Math.max(260, layer.width * 0.2) - EDGE.right);
  const fit = Math.floor((avail - BOARD.scale - BOARD.right) / BOARD.minCol);
  const shown = lanes.slice(0, Math.max(1, fit));
  const col = Math.min(BOARD.maxCol, Math.floor((avail - BOARD.scale - BOARD.right) / shown.length));
  const xs = shown.map((_, i) => BOARD.scale + i * col + BOARD.laneInset);
  const height = layer.height - EDGE.bottom - EDGE.top;
  return {
    mode,
    width: BOARD.scale + shown.length * col + BOARD.right,
    height,
    head: BOARD.head,
    axis: height - BOARD.head - BOARD.foot,
    foot: BOARD.foot,
    xs,
    col,
    shown,
    hidden: lanes.length - shown.length,
  };
}

/**
 * Keep marks `gap` px apart (sorted top to bottom) without leaving the axis:
 * overlaps push down, and a pile at the floor (older than the hour) pushes back up.
 */
export function spread<T extends { y: number }>(items: T[], gap: number, max: number): T[] {
  const out = [...items].sort((a, b) => a.y - b.y);
  for (let i = 1; i < out.length; i++) {
    const min = out[i - 1]!.y + gap;
    if (out[i]!.y < min) out[i] = { ...out[i]!, y: min };
  }
  for (let i = out.length - 1; i >= 0; i--) {
    const cap = i === out.length - 1 ? max : out[i + 1]!.y - gap;
    if (out[i]!.y > cap) out[i] = { ...out[i]!, y: Math.max(0, cap) };
  }
  return out;
}
