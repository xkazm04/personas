import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Nearest ancestor that establishes a vertical scroll box (overflow-y
 * auto/scroll/overlay), else null. We deliberately do NOT gate on a current
 * `scrollHeight > clientHeight`: settings sections often grow after mount
 * (async-loaded panels), and binding the scroll listener to the real
 * container up-front — even while it momentarily fits — keeps spy tracking
 * correct once the content overflows.
 */
function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const oy = getComputedStyle(node).overflowY;
    if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * The reading band: the strip of the scroll viewport a heading has to be
 * inside for its section to count as the one being read.
 *
 * This replaces a single 28px activation LINE. A line has two failure modes
 * that a band does not: a one-pixel nudge across it flips the rail's pill, and
 * a section longer than the viewport loses the highlight the moment its
 * heading scrolls off the top, because nothing is "at" the line any more.
 *
 * `BAND_TOP_INSET` is ALSO the jump clearance, deliberately. The previous
 * implementation had two unrelated numbers — a 28px activation offset and a
 * 12px scroll gap — so a click-to-jump could land a heading at a position the
 * spy did not call current. One offset budget, one answer.
 */
const BAND_TOP_INSET = 12;
/** The band covers roughly the top third of the viewport... */
const BAND_FRACTION = 0.33;
/** ...but never less than this, so a short viewport still has a band. */
const MIN_BAND_HEIGHT = 96;

export interface ReadingBand {
  top: number;
  bottom: number;
}

function bandFor(parent: HTMLElement | null): ReadingBand {
  const parentTop = parent ? parent.getBoundingClientRect().top : 0;
  const viewport = parent ? parent.clientHeight : window.innerHeight;
  const top = parentTop + BAND_TOP_INSET;
  return { top, bottom: top + Math.max(MIN_BAND_HEIGHT, viewport * BAND_FRACTION) };
}

/**
 * The whole spy rule, as a pure function of the measured heading positions.
 *
 * @param ids section ids in document order.
 * @param tops each mounted heading's viewport-relative top.
 * @param band the reading band.
 * @param previous the answer currently on screen.
 */
export function resolveActiveSection(
  ids: string[],
  tops: Map<string, number>,
  band: ReadingBand,
  previous: string,
): string {
  // Rule 1: the topmost heading inside the band wins. `ids` is document order,
  // so the first hit IS the topmost.
  for (const id of ids) {
    const top = tops.get(id);
    if (top === undefined) continue;
    if (top >= band.top && top < band.bottom) return id;
  }

  // Rule 2: an empty band keeps the previous answer, as long as the layout
  // still agrees with it — its own heading at or above the band, and the next
  // one not yet carried past it.
  const previousIndex = ids.indexOf(previous);
  if (previousIndex !== -1) {
    const previousTop = tops.get(previous);
    let nextTop: number | undefined;
    for (let i = previousIndex + 1; i < ids.length; i += 1) {
      const candidate = tops.get(ids[i] ?? '');
      if (candidate !== undefined) {
        nextTop = candidate;
        break;
      }
    }
    const stillOurs = previousTop === undefined || previousTop < band.bottom;
    const nextNotYetPassed = nextTop === undefined || nextTop >= band.bottom;
    if (stillOurs && nextNotYetPassed) return previous;
  }

  // Rule 3: contradicted (a jump or a fast fling carried a heading clean
  // through the band between two scroll events) — fall back to the last
  // heading above the band.
  let fallback = ids[0] ?? '';
  for (const id of ids) {
    const top = tops.get(id);
    if (top === undefined) continue;
    if (top < band.bottom) fallback = id;
    else break;
  }
  return fallback;
}

/**
 * Scroll-spy for a vertical stack of sections inside the nearest scroll
 * container (works whether the scroll lives on an internal `overflow-y-auto`
 * box — the common `ContentBody` case — or the window). Returns the active
 * section id (tracked on scroll), a stable per-id ref setter to tag each
 * section element, and a smooth-scroll jump.
 *
 * The active section is the TOPMOST heading intersecting the reading band.
 * When no heading is in the band the previous answer stands — that is the
 * whole point: reading down a long section must not un-highlight it. The one
 * exception is an answer the layout has since contradicted (a jump or a fast
 * fling carried a heading clean through the band between two scroll events),
 * which falls back to the last heading above the band.
 */
export function useSectionScrollSpy(ids: string[]) {
  const [activeId, setActiveId] = useState(ids[0] ?? '');
  const els = useRef<Record<string, HTMLElement | null>>({});
  const setters = useRef<Record<string, (el: HTMLElement | null) => void>>({});
  const scrollParent = useRef<HTMLElement | null>(null);

  // Stable callback ref per id so tagging a section never churns the ref.
  const register = useCallback((id: string) => {
    if (!setters.current[id]) {
      setters.current[id] = (el: HTMLElement | null) => { els.current[id] = el; };
    }
    return setters.current[id];
  }, []);

  const key = ids.join('|');
  useEffect(() => {
    const first = els.current[ids[0] ?? ''] ?? null;
    const parent = findScrollParent(first);
    scrollParent.current = parent;
    const target: HTMLElement | Window = parent ?? window;

    const compute = () => {
      const band = bandFor(parent);
      const tops = new Map<string, number>();
      for (const id of ids) {
        const el = els.current[id];
        if (el) tops.set(id, el.getBoundingClientRect().top);
      }
      if (tops.size === 0) return;
      // Reading the previous answer through the updater keeps a listener
      // installed once from ever closing over a stale one.
      setActiveId((previous) => resolveActiveSection(ids, tops, band, previous));
    };

    compute();
    target.addEventListener('scroll', compute, { passive: true });
    window.addEventListener('resize', compute);
    return () => {
      target.removeEventListener('scroll', compute);
      window.removeEventListener('resize', compute);
    };
    // `key` captures the section-id set; re-subscribe only when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const jumpTo = useCallback((id: string) => {
    const el = els.current[id];
    if (!el) return;
    const parent = scrollParent.current;
    if (parent) {
      const delta = el.getBoundingClientRect().top - parent.getBoundingClientRect().top;
      // Land the heading at the band's top inset, i.e. inside the band — so the
      // spy calls it current on its own, with no special case for a jump.
      parent.scrollTo({ top: parent.scrollTop + delta - BAND_TOP_INSET, behavior: 'smooth' });
    } else {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setActiveId(id);
  }, []);

  return { activeId, register, jumpTo };
}

/** Exported for tests: the band geometry the spy and `jumpTo` share. */
export const READING_BAND = {
  topInset: BAND_TOP_INSET,
  fraction: BAND_FRACTION,
  minHeight: MIN_BAND_HEIGHT,
} as const;
