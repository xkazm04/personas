import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import { columnsForWidth, FIT_STEPS, partitionColumns, type FitStep } from './questlogModel';

export interface QuestLayout {
  /** The form every zone renders in. One value for the whole desk: a page where
   *  some projects are lists and others are paragraphs reads as two documents. */
  mode: 'lines' | 'runs';
  /** `[start, end)` into the zone array, one per column, in reading order. */
  groups: [number, number][];
  columns: number;
  /** The ladder ran out and some column still overflows. The column scrolls and
   *  must name what is below it — see `QuestBelow`. */
  scrolling: boolean;
}

const INITIAL: QuestLayout = { mode: 'lines', groups: [], columns: 2, scrolling: false };

/** An even split, used only as the first guess. A zone's height does not depend
 *  on which column holds it — every column is the same width — so heights
 *  measured under the guess are the heights the real partition will get. */
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

/**
 * Measure the zones, pick the densest form that fits, and split them into
 * columns without breaking the alphabet.
 *
 * THE LADDER IS THE WHOLE DESIGN. It never shrinks type past 12px and it never
 * shortens a title; it spends line-height first, then the line breaks between
 * goals of one status (the `runs` form), and when both are spent it hands the
 * problem to a scrolling column that says out loud what is below it. Every
 * other answer to "it does not fit" either hides a title or makes it unreadable.
 *
 * Runs in a layout effect because it reads geometry and must commit before
 * paint; the only state it sets is `mode`, and at most once per content change,
 * guarded so it cannot oscillate.
 */
export function useQuestLayout(
  rootRef: React.RefObject<HTMLElement | null>,
  zoneCount: number,
  signature: string,
): QuestLayout {
  const [layout, setLayout] = useState<QuestLayout>(INITIAL);
  // The signature we have already escalated to `runs` for. Without it, a
  // content change that needs the dense form would flip mode, re-measure, and
  // be free to flip back — a loop that renders forever and looks like a hang.
  const escalated = useRef<string | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth(Math.round(w));
    });
    ro.observe(root);
    setWidth(Math.round(root.clientWidth));
    return () => ro.disconnect();
  }, [rootRef]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || zoneCount === 0 || width === 0) return;

    const available = root.clientHeight;
    const columns = columnsForWidth(width);
    const steps = FIT_STEPS.filter((s) => s.mode === layout.mode);

    let chosen: FitStep = steps[steps.length - 1]!;
    let groups = evenGroups(zoneCount, columns);
    let fits = false;

    for (const step of steps) {
      applyStep(root, step);
      const zones = [...root.querySelectorAll<HTMLElement>('[data-zone-id]')];
      if (zones.length === 0) break;
      const gap = parseFloat(step.gap) || 0;
      const heights = zones.map((z) => z.offsetHeight + gap);
      const plan = partitionColumns(heights, columns);
      chosen = step;
      groups = plan.groups;
      if (plan.tallest <= available + gap) { fits = true; break; }
    }

    if (!fits && layout.mode === 'lines' && escalated.current !== signature) {
      // Out of room in the line form: fold each status run into one sentence and
      // let the effect run again. Titles stay whole either way.
      escalated.current = signature;
      setLayout((prev) => ({ ...prev, mode: 'runs' }));
      return;
    }

    applyStep(root, chosen);
    setLayout((prev) => {
      const next: QuestLayout = { mode: prev.mode, groups, columns, scrolling: !fits };
      const same = prev.columns === next.columns
        && prev.scrolling === next.scrolling
        && prev.groups.length === next.groups.length
        && prev.groups.every((g, i) => g[0] === next.groups[i]![0] && g[1] === next.groups[i]![1]);
      return same ? prev : next;
    });
  }, [rootRef, zoneCount, signature, width, layout.mode]);

  // A fresh content set always starts from the roomiest form; otherwise a desk
  // that once needed the dense form would stay dense after the goals that
  // forced it were archived.
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
  rootRef: React.RefObject<HTMLElement | null>,
  caretRef: React.RefObject<HTMLElement | null>,
  currentZoneId: string | null,
): () => void {
  return useCallback(() => {
    const root = rootRef.current;
    const caret = caretRef.current;
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
  }, [rootRef, caretRef, currentZoneId]);
}
