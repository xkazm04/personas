// THROWAWAY — the /prototype A/B switch for the MID band's island body.
//
// Deleted at consolidation along with the losing variant. Deliberately NOT in
// the durable layout document: this is a prototyping affordance, and a
// half-finished A/B choice must never survive into a user's persisted canvas.
// Session-scoped module state + a subscriber set is the whole thing.
import { useSyncExternalStore } from 'react';

export type MidVariant = 'baseline' | 'facet' | 'tally';

export const MID_VARIANTS: ReadonlyArray<{ id: MidVariant; label: string; hint: string }> = [
  { id: 'baseline', label: 'Categories', hint: 'Current: four rolled-up dimension categories' },
  { id: 'facet', label: 'Facet', hint: 'A — the far hex, its interior split into three cube faces, one count per lane' },
  { id: 'tally', label: 'Tally', hint: 'B — one pip per live process in three tally rows; each Fleet pip wears its session state' },
];

let current: MidVariant = 'facet';
const listeners = new Set<() => void>();

export function setMidVariant(v: MidVariant): void {
  if (v === current) return;
  current = v;
  for (const l of listeners) l();
}

export function getMidVariant(): MidVariant {
  return current;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useMidVariant(): MidVariant {
  return useSyncExternalStore(subscribe, getMidVariant, getMidVariant);
}
