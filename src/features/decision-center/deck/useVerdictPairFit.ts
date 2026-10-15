/**
 * useVerdictPairFit — whether the dock's verdict pair (yes | no) fits side by
 * side, measured, in the reader's own language.
 *
 * The pair used to choose its layout by counting characters (`accept + reject
 * > 16` stacked it). Characters are not width: "Accept" + "Send back" counted
 * 15 and still wrapped "Send back" onto two lines in a 1280-wide deck, and a
 * German, Russian or Hindi verb is wider again per character. So the pair now
 * measures: each verdict's verb at its natural one-line width plus the
 * button's own chrome (icon, padding, keycap), against half the dock. When
 * either verb would not fit on one line, the pair stacks; it goes back to two
 * columns when the dock is wide enough again (a ResizeObserver re-measures).
 *
 * Read before paint (`useLayoutEffect`), so the wrong layout never shows.
 * A grid with no width yet (not laid out) keeps the default two columns.
 */
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Marks a verdict button in the pair, and the verb inside it, for the measure. */
const VERDICT_ATTR = 'data-verdict';
const VERDICT_TEXT_ATTR = 'data-verdict-text';

function needsStack(grid: HTMLElement): boolean {
  const buttons = Array.from(grid.querySelectorAll<HTMLElement>(`[${VERDICT_ATTR}]`));
  if (buttons.length < 2) return false;
  const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
  const half = (grid.clientWidth - gap) / 2;
  if (half <= 0) return false;
  return buttons.some((button) => {
    const text = button.querySelector<HTMLElement>(`[${VERDICT_TEXT_ATTR}]`);
    const slot = text?.parentElement;
    if (!text || !slot) return false;
    // The button's chrome is everything that is not the verb's slot; it is
    // the same in either layout, so this measure holds when stacked too.
    const chrome = button.offsetWidth - slot.clientWidth;
    return text.offsetWidth + chrome > half;
  });
}

/** `stacked` is true while either verb would wrap beside the other. `labels` re-measures on a change of words. */
export function useVerdictPairFit(labels: readonly string[]): { ref: RefObject<HTMLDivElement | null>; stacked: boolean } {
  const ref = useRef<HTMLDivElement | null>(null);
  const [stacked, setStacked] = useState(false);
  const key = labels.join('\u0000');

  useLayoutEffect(() => {
    const grid = ref.current;
    if (!grid) return;
    const measure = () => setStacked(needsStack(grid));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(grid);
    return () => ro.disconnect();
  }, [key]);

  return { ref, stacked };
}
