// One tab stop for the whole rail, arrows walking the journey. Selection moves
// WITH focus, which is the behaviour that makes the inline state region worth
// having: holding an arrow key reads the whole practice without a modal opening
// and closing eleven times.
import { useMemo, useRef, type KeyboardEvent } from 'react';

import type { JourneyNode } from '../../journey/journeyModel';

export interface StepRoving {
  /** Index of the step that owns the tab stop (the selected one). */
  activeIndex: number;
  /** Register each node's control so the roving focus can reach it. */
  bind: (index: number) => (el: HTMLButtonElement | null) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}

export function useStepRoving(
  order: JourneyNode[],
  selectedId: string | null,
  select: (stepId: string) => void,
): StepRoving {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = Math.max(0, order.findIndex((n) => n.id === selectedId));

  // One object per (cursor, journey): a memoised rail card skips its render while neither moves.
  return useMemo<StepRoving>(() => ({
    activeIndex,
    bind: (index) => (el) => { refs.current[index] = el; },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      const keys: Record<string, number> = {
        ArrowRight: activeIndex + 1, ArrowDown: activeIndex + 1,
        ArrowLeft: activeIndex - 1, ArrowUp: activeIndex - 1,
        Home: 0, End: order.length - 1,
      };
      const next = keys[e.key];
      if (next === undefined || order.length === 0) return;
      e.preventDefault();
      const clamped = Math.max(0, Math.min(order.length - 1, next));
      const node = order[clamped];
      if (!node) return;
      select(node.id);
      refs.current[clamped]?.focus();
    },
  }), [activeIndex, order, select]);
}
