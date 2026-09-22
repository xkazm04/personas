/**
 * "Show earlier" — revealing windowed-out history without losing your place.
 *
 * The transcript mounts only the last N rounds (see `athenaChatWindow`). This
 * is the other half: reaching the top of the scroll container grows the window
 * a page at a time, and only once everything loaded is on screen does
 * `useTranscriptPages` take over and fetch genuinely older rows from the
 * backend. Two mechanisms, one gesture — the user just scrolls up.
 *
 * Growing the window inserts content ABOVE the viewport, which would otherwise
 * yank the reading position downward, so every expansion is anchored: capture
 * the scroll metrics, expand, then shift by exactly how much the container
 * grew. Same trick `useTranscriptPages` uses for a fetched page.
 */

import { useCallback, useEffect } from 'react';

/** How close to the top triggers the next expansion. Matches the pager. */
const EXPAND_TRIGGER_PX = 120;

export function useShowEarlierOnScroll(args: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** False once nothing is hidden — hand off to backend pagination. */
  enabled: boolean;
  showEarlier: () => void;
}): { showEarlierAnchored: () => void } {
  const { scrollRef, enabled, showEarlier } = args;

  const showEarlierAnchored = useCallback(() => {
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    const prevTop = el?.scrollTop ?? 0;
    showEarlier();
    requestAnimationFrame(() => {
      const node = scrollRef.current;
      if (!node) return;
      const grew = node.scrollHeight - prevHeight;
      if (grew > 0) node.scrollTop = prevTop + grew;
    });
  }, [scrollRef, showEarlier]);

  useEffect(() => {
    if (!enabled) return;
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (el.scrollTop <= EXPAND_TRIGGER_PX) showEarlierAnchored();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [enabled, scrollRef, showEarlierAnchored]);

  return { showEarlierAnchored };
}
