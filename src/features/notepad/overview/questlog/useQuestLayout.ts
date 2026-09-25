import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import { columnsForWidth, FIT_STEPS, partitionColumns, type FitStep } from './questlogModel';

export interface QuestLayout {
  /** The form every zone renders in. One value for the whole desk: a page where
   *  some projects are lists and others are paragraphs reads as two documents. */
  mode: 'lines' | 'runs';
  /** `[start, end)` into the zone array, one per column, in reading order.
   *  NEVER empty once a width is known — see `evenGroups`. */
  groups: [number, number][];
  columns: number;
  /** The ladder ran out and some column still overflows. The column scrolls and
   *  must name what is below it — see `QuestBelow`. */
  scrolling: boolean;
}

const INITIAL: QuestLayout = { mode: 'lines', groups: [], columns: 2, scrolling: false };

/**
 * An even split by count. This is not a fallback, it is the FIRST PASS.
 *
 * The ladder measures zones by reading their rendered heights, and a zone has no
 * height until it is in the DOM — but it is only in the DOM once a partition has
 * put it in a column. Committing the even split first breaks that circle: it
 * renders every zone at the final column WIDTH (all columns are equal width, and
 * the count is already decided by `columnsForWidth`), so the heights measured on
 * the next pass are exactly the heights the refined partition will get.
 */
function evenGroups(n: number, k: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < k; i += 1) {
    out.push([Math.round((i * n) / k), Math.round(((i + 1) * n) / k)]);
  }
  return out;
}

function applyStep(root: HTMLElement, step: FitStep): void {
  root.style.setProperty('--ql-fs', step.fontSize);
  root.style.setProperty('--ql-lh', String(step.lineHeight));
  root.style.setProperty('--ql-gap', step.gap);
}

const sameGroups = (a: readonly [number, number][], b: readonly [number, number][]): boolean =>
  a.length === b.length && a.every((g, i) => g[0] === b[i]![0] && g[1] === b[i]![1]);

/**
 * Measure the zones, pick the densest form that fits, and split them into
 * columns without breaking the alphabet.
 *
 * THE LADDER IS THE WHOLE DESIGN. It never shrinks type past 12px and it never
 * shortens a title; it spends line-height first, then the line breaks between
 * goals of one status (the `runs` form), and when both are spent it hands the
 * problem to a scrolling column that says out loud what is below it.
 *
 * Takes the root ELEMENT, not a ref. The desk is rendered conditionally — the
 * pad is `loading` first — so a ref object would be read once, while it still
 * held null, and never looked at again: the observer would never attach, the
 * width would stay 0, and the surface would render nothing at all. An element in
 * state re-runs every effect here the moment it mounts.
 */
export function useQuestLayout(
  root: HTMLElement | null,
  zoneCount: number,
  signature: string,
): QuestLayout {
  const [layout, setLayout] = useState<QuestLayout>(INITIAL);
  // The signature we have already escalated to `runs` for. Without it, a content
  // change that needs the dense form would flip mode, re-measure, and be free to
  // flip back — a loop that renders forever and looks like a hang.
  const escalated = useRef<string | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    if (!root) return;
    setWidth(Math.round(root.clientWidth));
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth((prev) => (Math.abs(prev - w) < 1 ? prev : Math.round(w)));
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, [root]);

  useLayoutEffect(() => {
    if (!root || zoneCount === 0 || width === 0) return;

    const columns = columnsForWidth(width);

    // First pass for this width: put the zones on screen at the right column
    // width so the next pass has something to measure.
    const rendered = root.querySelectorAll<HTMLElement>('[data-zone-id]').length;
    if (rendered !== zoneCount || layout.columns !== columns) {
      const seed = evenGroups(zoneCount, columns);
      setLayout((prev) => (prev.columns === columns && sameGroups(prev.groups, seed)
        ? prev
        : { mode: prev.mode, groups: seed, columns, scrolling: false }));
      return;
    }

    const available = root.clientHeight;
    const steps = FIT_STEPS.filter((s) => s.mode === layout.mode);
    let chosen: FitStep = steps[steps.length - 1]!;
    let groups = layout.groups;
    let fits = false;

    for (const step of steps) {
      applyStep(root, step);
      const gap = parseFloat(step.gap) || 0;
      const heights = [...root.querySelectorAll<HTMLElement>('[data-zone-id]')]
        .map((z) => z.offsetHeight + gap);
      const plan = partitionColumns(heights, columns);
      chosen = step;
      groups = plan.groups;
      if (plan.tallest <= available + gap) { fits = true; break; }
    }

    if (!fits && layout.mode === 'lines' && escalated.current !== signature) {
      // Out of room in the line form: fold each status run into one sentence and
      // let the effect run again. Titles stay whole either way. The refined
      // groups are committed too, so a re-render always makes progress.
      escalated.current = signature;
      setLayout((prev) => ({ ...prev, mode: 'runs', groups, columns, scrolling: true }));
      return;
    }

    applyStep(root, chosen);
    setLayout((prev) => (prev.columns === columns
      && prev.scrolling === !fits
      && sameGroups(prev.groups, groups)
      ? prev
      : { mode: prev.mode, groups, columns, scrolling: !fits }));
  }, [root, zoneCount, signature, width, layout.mode, layout.groups, layout.columns]);

  // A fresh content set always starts from the roomiest form; otherwise a desk
  // that once needed the dense form would stay dense after the goals that forced
  // it were archived.
  useLayoutEffect(() => {
    if (escalated.current !== null && escalated.current !== signature) {
      escalated.current = null;
      setLayout((prev) => (prev.mode === 'lines' ? prev : { ...prev, mode: 'lines' }));
    }
  }, [signature]);

  return layout;
}

/**
 * Park the caret on the current zone's head, and scroll that zone into view when
 * its column is one of the scrolling ones.
 *
 * Returns a callback the caller runs after any change that can move a zone.
 */
export function useQuestCaret(
  root: HTMLElement | null,
  caret: HTMLElement | null,
  currentZoneId: string | null,
): () => void {
  return useCallback(() => {
    if (!root || !caret) return;
    if (!currentZoneId) { caret.style.opacity = '0'; return; }
    const zone = root.querySelector<HTMLElement>(`[data-zone-id="${CSS.escape(currentZoneId)}"]`);
    const head = zone?.querySelector<HTMLElement>('.ql-zone-head');
    if (!zone || !head) { caret.style.opacity = '0'; return; }

    const column = zone.parentElement;
    if (column && column.scrollHeight > column.clientHeight) {
      const top = zone.offsetTop;
      if (top < column.scrollTop || top + 60 > column.scrollTop + column.clientHeight) {
        column.scrollTop = Math.max(0, top - 40);
      }
    }

    const a = head.getBoundingClientRect();
    const b = root.getBoundingClientRect();
    caret.style.opacity = '1';
    caret.style.transform = `translate(${a.left - b.left - 15}px, ${a.top - b.top + a.height / 2 - 6}px)`;
  }, [root, caret, currentZoneId]);
}
