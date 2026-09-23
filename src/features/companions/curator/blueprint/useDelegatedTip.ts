/**
 * ONE tooltip for a lattice of a thousand cells.
 *
 * The ledger paints nine columns across every row it carries, and every mark
 * has something to say about why it is a mark and not a zero. A `<Tooltip>`
 * per cell would be a thousand wrappers and a thousand timers, which is the
 * case the shared `AnchoredTooltip` primitive exists for: one delegated
 * pointer handler reports the hovered element's rect, and the catalogued
 * surface paints itself with the app's own placement, flip and clamp.
 *
 * A target declares its words with `data-cb-tip`. Plain text only - a tip is
 * inert by contract, so there is nothing in it worth marking up.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface TipState {
  anchor: DOMRect | null;
  content: string | null;
}

export function useDelegatedTip(): {
  tip: TipState;
  bind: { onMouseOver: (e: React.MouseEvent) => void; onMouseLeave: () => void };
} {
  const [tip, setTip] = useState<TipState>({ anchor: null, content: null });
  const current = useRef<Element | null>(null);

  const onMouseOver = useCallback((e: React.MouseEvent) => {
    const target = e.target instanceof Element ? e.target.closest('[data-cb-tip]') : null;
    if (target === current.current) return;
    current.current = target;
    if (!target) {
      setTip({ anchor: null, content: null });
      return;
    }
    const content = target.getAttribute('data-cb-tip');
    setTip(content ? { anchor: target.getBoundingClientRect(), content } : { anchor: null, content: null });
  }, []);

  const onMouseLeave = useCallback(() => {
    current.current = null;
    setTip({ anchor: null, content: null });
  }, []);

  // A tip anchored to a rect goes stale the moment the surface under it moves.
  // Scrolling the ledger is the common case, and a tip left floating over a
  // different row is worse than no tip at all.
  useEffect(() => {
    if (!tip.anchor) return;
    const drop = () => {
      current.current = null;
      setTip({ anchor: null, content: null });
    };
    window.addEventListener('scroll', drop, true);
    return () => window.removeEventListener('scroll', drop, true);
  }, [tip.anchor]);

  return { tip, bind: { onMouseOver, onMouseLeave } };
}
