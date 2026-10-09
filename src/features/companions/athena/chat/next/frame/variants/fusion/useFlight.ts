/**
 * Fusion · the answer cards' flight: each card leaves the rail's attention
 * circle (`[data-fusion-anchor]`) small and transparent and lands in its slot
 * under the question, staggered left to right, on the product's ease; reduced
 * motion simply shows them. Measured before paint (`useLayoutEffect`), so a
 * card never flashes in its slot first.
 */

import { animate } from 'framer-motion';
import { useLayoutEffect } from 'react';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { EASE } from './text';

/** The cards' flight: from the attention circle to each card's own slot. */
export function useFlight(listRef: React.RefObject<HTMLOListElement | null>, count: number) {
  const { shouldAnimate } = useMotion();
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !shouldAnimate) return;
    const anchor = document.querySelector('[data-fusion-anchor]')?.getBoundingClientRect();
    const cards = Array.from(list.children) as HTMLElement[];
    // Measure the slots untransformed, then hide them before this frame paints.
    for (const el of cards) el.style.transform = '';
    const rects = cards.map((el) => el.getBoundingClientRect());
    for (const el of cards) el.style.opacity = '0';
    const runs = cards.map((el, i) => {
      const r = rects[i]!;
      const dx = anchor ? anchor.left + anchor.width / 2 - (r.left + r.width / 2) : 220;
      const dy = anchor ? anchor.top + anchor.height / 2 - (r.top + r.height / 2) : -120;
      return animate(
        el,
        { x: [dx, 0], y: [dy, 0], scale: [0.18, 1], opacity: [0, 1] },
        { duration: 0.62, delay: 0.1 + i * 0.09, ease: EASE },
      );
    });
    return () => {
      runs.forEach((r) => r.stop());
      for (const el of cards) {
        el.style.transform = '';
        el.style.opacity = '';
      }
    };
  }, [listRef, count, shouldAnimate]);
}
