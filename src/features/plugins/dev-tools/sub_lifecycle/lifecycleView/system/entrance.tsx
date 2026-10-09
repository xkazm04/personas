// Entrance motion, once per project per session. The rail ripples in the first
// time a project's practice lands on screen; it does NOT replay when the data
// was already shown before this mount (a warm remount painting the cached
// snapshot, or coming back from a step's screen). Under reduced motion it never
// plays. Every one-shot entrance in the module (the collars, the arcs, the
// beads) reads the same answer from this context, so a remount is still as a
// whole rather than half-animated.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';

/** Projects whose rail has entered this session. Bounded: cleared past the cap (worst case one replay). */
const entered = new Set<string>();
const ENTERED_CAP = 64;

const EntranceContext = createContext(false);

/** True when this mount should play the entrance: first sight of `key` this session, motion allowed. */
export function useFirstEntrance(key: string | null): boolean {
  const reduced = useReducedMotion();
  const [first] = useState(() => key !== null && !entered.has(key));
  useEffect(() => {
    if (key === null) return;
    if (entered.size >= ENTERED_CAP) entered.clear();
    entered.add(key);
  }, [key]);
  return first && !reduced;
}

export function EntranceProvider({ play, children }: { play: boolean; children: ReactNode }) {
  return <EntranceContext.Provider value={play}>{children}</EntranceContext.Provider>;
}

/** Whether the surrounding surface is entering (false outside a provider: no motion by default). */
export function useEntrance(): boolean {
  return useContext(EntranceContext);
}

/** Test-only: forget which projects have entered. */
export function __resetEntranceForTests(): void {
  entered.clear();
}
