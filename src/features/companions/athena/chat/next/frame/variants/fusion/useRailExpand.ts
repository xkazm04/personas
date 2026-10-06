/**
 * Fusion · when the rail reads out loud. The WHOLE rail (count, beads,
 * categories, toolset, and a category panel hanging from it) is one hover and
 * focus zone: the pointer over any of it, or keyboard focus inside it, widens
 * it leftward so every mark gains its words; leaving or blurring folds it.
 *
 *   - Hover opens at once and folds a beat late (MOTION's fast tooltip rung),
 *     so a pointer crossing the gap to a category panel does not flicker it.
 *   - Focus counts only when it is keyboard focus (`:focus-visible`): a click
 *     leaves focus on the control, and that must not pin the rail open.
 *   - Esc with focus inside folds it and keeps it folded until focus moves on
 *     or the pointer leaves; an open category panel takes the first Esc (its
 *     rung sits one above this one).
 *
 * TODO(prototype, 2026-10-07): athena chat fusion - consolidate after the owner picks.
 */

import { useCallback, useEffect, useRef, useState, type FocusEvent } from 'react';
import { FULLSCREEN_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { MOTION } from '@/lib/utils/designTokens';

const FOLD_DELAY = MOTION.delay.tooltip.fast;

function keyboardFocus(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && el.matches(':focus-visible');
}

export function useRailExpand() {
  const seatRef = useRef<HTMLDivElement>(null);
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
  const onFocus = useCallback((e: FocusEvent<HTMLDivElement>) => {
    const kb = keyboardFocus(e.target);
    setFocused(kb);
    if (kb) setDismissed(false);
  }, []);
  const onBlur = useCallback((e: FocusEvent<HTMLDivElement>) => {
    if (seatRef.current?.contains(e.relatedTarget as Node | null)) return;
    setFocused(false);
    setDismissed(false);
  }, []);

  useAppKeyboard(
    (e) => {
      if (e.key !== 'Escape') return false;
      if (!seatRef.current?.contains(document.activeElement)) return false;
      e.preventDefault();
      setDismissed(true);
      return true;
    },
    { enabled: expanded, priority: FULLSCREEN_LAYER_PRIORITY + 2 },
  );

  return { seatRef, expanded, handlers: { onPointerEnter, onPointerLeave, onFocus, onBlur } };
}
