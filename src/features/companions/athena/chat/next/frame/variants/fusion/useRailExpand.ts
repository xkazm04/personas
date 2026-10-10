/**
 * Fusion · when a part of the rail reads out loud. The rail is TWO independent
 * hover and focus zones, each driven by one instance of this hook:
 *
 *   - `up`    the pending count, the attention beads, the category circles and
 *             an open category panel hanging from them: widens leftward so every
 *             mark gains its words;
 *   - `tools` the toolset, on its own: its buttons grow into a glass panel of
 *             their own, with no words.
 *
 * Hovering one never touches the other. Marks carry `data-fu-zone` so the
 * hook can tell which zone a node (or the focused element) belongs to; the
 * category panel hangs outside the upper column in the DOM and carries the
 * `up` mark too.
 *
 *   - Hover opens at once and folds a beat late (MOTION's fast tooltip rung),
 *     so a pointer crossing the gap to a category panel does not flicker it.
 *   - Focus counts only when it is keyboard focus (`:focus-visible`): a click
 *     leaves focus on the control, and that must not pin a zone open.
 *   - Esc with focus inside the zone folds it and keeps it folded until focus
 *     moves on or the pointer leaves; an open category panel takes the first
 *     Esc (its rung sits one above this one).
 *
 * `useRailRoom` is the rail's height budget: how many attention beads fit
 * under the seat, so the rail never pushes a mark past its glass.
 *
 * TODO(prototype, 2026-10-07): athena chat fusion - consolidate after the owner picks.
 */

import { useCallback, useEffect, useRef, useState, type FocusEvent, type RefObject } from 'react';
import { FULLSCREEN_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { MOTION } from '@/lib/utils/designTokens';

const FOLD_DELAY = MOTION.delay.tooltip.fast;

export type RailZone = 'up' | 'tools';

function keyboardFocus(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && el.matches(':focus-visible');
}

function inZone(node: EventTarget | null, zone: RailZone): boolean {
  return node instanceof Element && node.closest(`[data-fu-zone="${zone}"]`) !== null;
}

export function useRailExpand(zone: RailZone) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const expanded = !dismissed && (hovered || focused);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);

  const onPointerEnter = useCallback(() => {
    clear();
    setHovered(true);
  }, []);
  const onPointerLeave = useCallback(() => {
    clear();
    timer.current = setTimeout(() => {
      setHovered(false);
      setDismissed(false);
    }, FOLD_DELAY);
  }, []);
  const onFocus = useCallback((e: FocusEvent<HTMLElement>) => {
    const kb = keyboardFocus(e.target);
    setFocused(kb);
    if (kb) setDismissed(false);
  }, []);
  const onBlur = useCallback(
    (e: FocusEvent<HTMLElement>) => {
      if (inZone(e.relatedTarget, zone)) return;
      setFocused(false);
      setDismissed(false);
    },
    [zone],
  );

  useAppKeyboard(
    (e) => {
      if (e.key !== 'Escape') return false;
      if (!inZone(document.activeElement, zone)) return false;
      e.preventDefault();
      setDismissed(true);
      return true;
    },
    { enabled: expanded, priority: FULLSCREEN_LAYER_PRIORITY + 2 },
  );

  return { expanded, handlers: { onPointerEnter, onPointerLeave, onFocus, onBlur }, zoneProps: { 'data-fu-zone': zone } as const };
}

/**
 * How many beads may stand under the attention circle. Watches the seat and
 * the rail: while the rail (plus what the toolset adds when it grows) is
 * taller than the seat, one bead fewer; while one more bead still fits with
 * that margin, one more. The "+N" count carries the rest, so nothing is lost.
 */
export function useRailRoom(
  seat: RefObject<HTMLElement | null>,
  rail: RefObject<HTMLElement | null>,
  max: number,
  /** What the toolset adds in height when it grows, px. */
  reserve: number,
) {
  const [cap, setCap] = useState(max);
  useEffect(() => {
    const seatEl = seat.current;
    const railEl = rail.current;
    if (!seatEl || !railEl || typeof ResizeObserver === 'undefined') return;
    const fit = () => {
      // A grown toolset is taller by design: judge the rail at rest, never while it is grown.
      if (railEl.querySelector('.is-grown')) return;
      const need = railEl.offsetHeight + reserve;
      const room = seatEl.clientHeight;
      const bead = railEl.querySelector<HTMLElement>('.fu-bead');
      const pitch = (bead?.offsetHeight ?? 18) + 5;
      setCap((c) => {
        if (need > room && c > 0) return c - 1;
        if (c < max && need + pitch <= room) return c + 1;
        return c;
      });
    };
    const ro = new ResizeObserver(fit);
    ro.observe(seatEl);
    ro.observe(railEl);
    fit();
    return () => ro.disconnect();
  }, [seat, rail, max, reserve]);
  return Math.min(cap, max);
}
