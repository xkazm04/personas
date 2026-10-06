/** useLeaders - where the detail drawing's leader lines run: from the figure's
 *  right edge to the label tab of each zone, measured relative to `root` (the
 *  scrolling drawing, so the lines scroll with it) and re-measured whenever
 *  the drawing, the figure or a zone changes size (a quick setup expanding). */
import { useLayoutEffect, useState } from "react";

export interface Pt { x: number; y: number }
export interface Leader { index: number; from: Pt; to: Pt; letter: string }

const LETTERS = "ABCDEFGH";

/** `zones` must be state (a new array only when an element changes), and
 *  `count` the number of zones drawn in the figure's edge, so the letters on
 *  the figure keep their spacing while a zone mounts. */
export function useLeaders(root: HTMLElement | null, figure: HTMLElement | null, zones: readonly (HTMLElement | null)[], count: number): Leader[] {
  const [leaders, setLeaders] = useState<Leader[]>([]);

  useLayoutEffect(() => {
    const els = zones.slice(0, count);
    if (!root || !figure) { setLeaders((prev) => (prev.length ? [] : prev)); return; }
    const measure = () => {
      const o = root.getBoundingClientRect();
      const f = figure.getBoundingClientRect();
      const out: Leader[] = [];
      els.forEach((el, i) => {
        if (!el) return;
        const z = el.getBoundingClientRect();
        // Stacked (narrow) layout: the zone is not beside the figure, so no leader.
        if (z.left < f.right + 24) return;
        out.push({
          index: i,
          letter: LETTERS[i] ?? "",
          from: { x: f.right - o.left, y: f.top - o.top + ((i + 1) * f.height) / (count + 1) },
          to: { x: z.left - o.left, y: z.top - o.top },
        });
      });
      setLeaders(out);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    ro.observe(figure);
    els.forEach((el) => el && ro.observe(el));
    return () => ro.disconnect();
  }, [root, figure, zones, count]);

  return leaders;
}

/** An elbowed leader: out of the figure, across the gutter, along to the zone. */
export function leaderPath(l: Leader): string {
  const mid = l.from.x + Math.max(14, (l.to.x - l.from.x) * 0.45);
  return `M${l.from.x} ${l.from.y} H${mid} V${l.to.y} H${l.to.x - 2}`;
}

export const zoneLetter = (i: number) => LETTERS[i] ?? "";
