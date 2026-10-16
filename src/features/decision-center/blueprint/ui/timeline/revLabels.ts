// The revisions chart's label placement (PORTED from bp BaseBar.tsx Revisions, the `cand` / `kept` pass): every label
// is a candidate with a priority; they are placed in priority order and a label that would leave the chart or collide
// with one already kept is culled, so a narrow panel shows fewer labels instead of overprinted ones. The handle plate
// is kept first and is never culled. Pure: the chart passes its words and positions in.

export type Anchor = 'start' | 'middle' | 'end';
export interface Lab { k: string; s: string; x: number; y: number; a: Anchor; p: number; /** A measured width when the text carries letter-spacing. */ w?: number }
export interface Box { x0: number; x1: number; y0: number; y1: number }

/** Advance of the 12 px mono label face, for placing chart labels (bp CW). */
export const CW = 7.2;
/** The width of a spaced head (`.lbl` carries 0.12em letter-spacing). */
export const headW = (s: string) => s.length * (CW + 1.44);

export function boxOf(l: Lab): Box {
  const w = l.w ?? l.s.length * CW, x0 = l.a === 'start' ? l.x : l.a === 'end' ? l.x - w : l.x - w / 2;
  return { x0, x1: x0 + w, y0: l.y - 11, y1: l.y + 3 };
}

/** The keys of the labels that fit, placing `cand` by priority against the boxes already `kept` (the handle plate). */
export function placeLabels(cand: readonly Lab[], W: number, kept: Box[]): Set<string> {
  const shown = new Set<string>();
  for (const l of [...cand].sort((a, b) => a.p - b.p)) {
    const b = boxOf(l);
    if (b.x0 < 0 || b.x1 > W || kept.some((o) => b.x0 < o.x1 && o.x0 < b.x1 && b.y0 < o.y1 && o.y0 < b.y1)) continue;
    kept.push(b); shown.add(l.k);
  }
  return shown;
}
