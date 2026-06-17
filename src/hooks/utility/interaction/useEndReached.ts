import { useEffect, useRef, type RefObject } from 'react';

/**
 * Fire `onEndReached` when a scroll container comes within `threshold` px of
 * its bottom — the primitive behind infinite-scroll / load-more lists.
 *
 * Why a scroll listener rather than an IntersectionObserver sentinel: lists
 * built on a virtualized table scroll *inside* the table's own
 * `overflow-y-auto` element, so a sentinel placed as a sibling below the table
 * never moves when the user scrolls and the observer never fires. Watching the
 * actual scroll element's offset is reliable regardless of where the table
 * sits in the layout.
 *
 * The callback is read through a ref, so the listener is attached once and
 * always invokes the freshest closure — callers typically pass a handler whose
 * identity changes as the data set grows. Pass an `undefined` callback (or
 * `enabled: false`) to detach: do this while a page is already loading or when
 * there's nothing more to fetch, which also prevents duplicate loads.
 *
 * Also checks once on (re)attach, so a container too short to scroll still
 * fills itself by loading successive pages until it overflows or the callback
 * goes `undefined`.
 *
 * @param scrollRef    Ref to the scrolling element (e.g. a virtualizer's
 *                     `parentRef`). Safe to wire unconditionally — the hook is
 *                     inert until the node mounts.
 * @param onEndReached Called when the bottom is approached. `undefined` detaches.
 */
export function useEndReached(
  scrollRef: RefObject<HTMLElement | null>,
  onEndReached: (() => void) | undefined,
  { threshold = 240, enabled = true }: { threshold?: number; enabled?: boolean } = {},
): void {
  const cbRef = useRef(onEndReached);
  cbRef.current = onEndReached;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !enabled || !onEndReached) return;

    let frame = 0;
    const atEnd = (node: HTMLElement) =>
      node.scrollHeight - node.scrollTop - node.clientHeight <= threshold;
    const check = () => {
      frame = 0;
      const node = scrollRef.current;
      if (node && atEnd(node)) cbRef.current?.();
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(check);
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    // A short, non-scrollable container should still load the next page rather
    // than wait for a scroll that can never happen.
    check();

    return () => {
      el.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [scrollRef, onEndReached, enabled, threshold]);
}
