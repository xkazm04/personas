import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

interface UseChapterScrollArgs {
  /** The open chapter's leaf. Its edges decide when a scroll can turn the page. */
  pageRef: RefObject<HTMLElement | null>;
  /** Off while a row is being written in: scrolling a long row must not leave the chapter. */
  enabled: boolean;
  hasNext: boolean;
  hasPrev: boolean;
  onNext: () => void;
  onPrev: () => void;
  /** Wheel travel past the edge, in px, that turns the page. */
  threshold?: number;
}

export type ChapterTurn = { direction: 'next' | 'prev'; progress: number } | null;

const IDLE_RESET_MS = 650;
const COOLDOWN_MS = 800;
const EDGE_SLACK = 12;

/** The nearest ancestor that actually scrolls, or the document. */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

/**
 * Scroll past the end of a chapter to open the next one; past the top to open
 * the previous — an alternative to clicking the tabs, the rail or a closed leaf.
 *
 * DELIBERATE, NOT ACCIDENTAL. Nothing turns while the chapter itself still has
 * text to scroll through: the gesture only arms once the leaf's bottom (or top)
 * edge is inside the viewport, then it has to travel `threshold` px further,
 * and it resets if the reader pauses. The returned `progress` drives a visible
 * fill, so the page never turns without the reader having watched it coming.
 * A cooldown after each turn stops one long fling from skipping two chapters.
 *
 * Works whichever ancestor scrolls — the window in a harness, an editor panel
 * in the app — because it reads the leaf's position against its scroll parent.
 */
export function useChapterScroll({
  pageRef,
  enabled,
  hasNext,
  hasPrev,
  onNext,
  onPrev,
  threshold = 420,
}: UseChapterScrollArgs): ChapterTurn {
  const [turn, setTurn] = useState<ChapterTurn>(null);
  const travel = useRef(0);
  const idle = useRef<number | undefined>(undefined);
  const coolUntil = useRef(0);

  const reset = useCallback(() => {
    travel.current = 0;
    setTurn(null);
  }, []);

  useEffect(() => {
    if (!enabled) {
      reset();
      return;
    }
    const onWheel = (e: WheelEvent) => {
      const page = pageRef.current;
      if (!page || Date.now() < coolUntil.current) return;
      const scroller = scrollParent(page);
      const view = scroller
        ? scroller.getBoundingClientRect()
        : { top: 0, bottom: window.innerHeight };
      const r = page.getBoundingClientRect();
      const atEnd = r.bottom <= view.bottom + EDGE_SLACK;
      const atTop = r.top >= view.top - EDGE_SLACK;

      const down = e.deltaY > 0;
      const armed = down ? atEnd && hasNext : atTop && hasPrev;
      if (!armed) {
        if (travel.current) reset();
        return;
      }
      // a reversal restarts the count rather than cancelling out
      if ((travel.current > 0) !== down && travel.current !== 0) travel.current = 0;
      travel.current += e.deltaY;
      const progress = Math.min(1, Math.abs(travel.current) / threshold);
      setTurn({ direction: down ? 'next' : 'prev', progress });

      window.clearTimeout(idle.current);
      idle.current = window.setTimeout(reset, IDLE_RESET_MS);

      if (progress >= 1) {
        coolUntil.current = Date.now() + COOLDOWN_MS;
        reset();
        if (down) onNext();
        else onPrev();
      }
    };
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.clearTimeout(idle.current);
    };
  }, [enabled, hasNext, hasPrev, onNext, onPrev, pageRef, reset, threshold]);

  return turn;
}
