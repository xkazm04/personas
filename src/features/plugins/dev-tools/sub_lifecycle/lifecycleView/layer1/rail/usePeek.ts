// The rail's peek: ONE anchored tip for the whole rail (not a tooltip per
// card), opened by resting on a card for PEEK_DELAY_MS or by focusing its key,
// closed by leaving, blurring or Esc. Once a peek is showing, moving to the
// next card swaps it at once (a sweep reads the rail without waiting at every
// card); after a pause the delay applies again.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';

import type { HealthStep } from '../healthModel';

export const PEEK_DELAY_MS = 250;
/** How long after a peek closed the next one still opens at once. */
const WARM_MS = 300;

export interface PeekState {
  stepId: string;
  /** The card's box when the peek opened (the tip anchors under it). */
  anchor: DOMRect;
}

export interface PeekControl {
  show: (step: HealthStep, card: HTMLElement) => void;
  hide: () => void;
}

export function usePeek(): { peek: PeekState | null; control: PeekControl } {
  const [peek, setPeek] = useState<PeekState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const open = useRef(false);
  const closedAt = useRef(Number.NEGATIVE_INFINITY);

  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const show = useCallback((step: HealthStep, card: HTMLElement) => {
    stop();
    const warm = open.current || performance.now() - closedAt.current < WARM_MS;
    const reveal = () => {
      open.current = true;
      setPeek({ stepId: step.node.id, anchor: card.getBoundingClientRect() });
    };
    if (warm) reveal();
    else timer.current = setTimeout(reveal, PEEK_DELAY_MS);
  }, []);

  const hide = useCallback(() => {
    stop();
    if (open.current) closedAt.current = performance.now();
    open.current = false;
    setPeek(null);
  }, []);

  // Esc closes an open peek, on the app's keyboard ladder at the default rung.
  useAppKeyboard((e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return false;
    hide();
    return true;
  }, { enabled: peek !== null });

  useEffect(() => stop, []);

  const control = useMemo(() => ({ show, hide }), [show, hide]);
  return { peek, control };
}
