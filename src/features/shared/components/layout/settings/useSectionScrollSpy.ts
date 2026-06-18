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

/** px below the scroll-viewport top at which a section becomes "active". */
const ACTIVATION_OFFSET = 28;
/** breathing room left above a section after a click-to-jump. */
const SCROLL_GAP = 12;

/**
 * Scroll-spy for a vertical stack of sections inside the nearest scroll
 * container (works whether the scroll lives on an internal `overflow-y-auto`
 * box — the common `ContentBody` case — or the window). Returns the active
 * section id (tracked on scroll), a stable per-id ref setter to tag each
 * section element, and a smooth-scroll jump.
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
      const parentTop = parent ? parent.getBoundingClientRect().top : 0;
      let current = ids[0] ?? '';
      for (const id of ids) {
        const el = els.current[id];
        if (!el) continue;
        if (el.getBoundingClientRect().top - parentTop <= ACTIVATION_OFFSET) current = id;
        else break;
      }
      setActiveId(current);
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
      parent.scrollTo({ top: parent.scrollTop + delta - SCROLL_GAP, behavior: 'smooth' });
    } else {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setActiveId(id);
  }, []);

  return { activeId, register, jumpTo };
}
