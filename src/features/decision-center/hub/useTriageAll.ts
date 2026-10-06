/**
 * useTriageAll — the interim "Triage all": load every chip, wait for the read
 * to land, open the FIRST item of the ordered roster through the router.
 *
 * Interim by design (decision-center spark, A3): the consolidation package's
 * shared modal walks the whole roster in place. Until then the first item
 * opens in its own surface — the focus surface walks the rest of the roster's
 * focus kinds behind it.
 *
 * It waits for the read to SETTLE rather than for the first item to appear:
 * sources land one by one, and the first to land is not the most urgent.
 */
import { useCallback, useEffect } from 'react';

import type { DecisionItem } from '../model/decisionModel';
import { useLoadSettled } from './useLoadSettled';

export type TriageAllPhase = 'idle' | 'finding' | 'open';

export function useTriageAll(
  phase: TriageAllPhase,
  setPhase: (p: TriageAllPhase) => void,
  roster: { items: readonly DecisionItem[]; loading: boolean },
  opener: { open: (item: DecisionItem, queue?: readonly DecisionItem[]) => void; isOpen: boolean },
) {
  const settled = useLoadSettled(phase === 'finding' ? 'all' : null, roster.loading);
  const { items } = roster;
  const { open, isOpen } = opener;

  useEffect(() => {
    if (phase !== 'finding' || !settled) return;
    const first = items[0];
    if (!first) {
      setPhase('idle');
      return;
    }
    open(first, items);
    // A council opens by navigating away: nothing stays open to wait for.
    setPhase(first.kind === 'council' ? 'idle' : 'open');
  }, [phase, settled, items, open, setPhase]);

  // The surface closed: stop loading every chip.
  useEffect(() => {
    if (phase === 'open' && !isOpen) setPhase('idle');
  }, [phase, isOpen, setPhase]);

  const start = useCallback(() => setPhase('finding'), [setPhase]);
  return { start, busy: phase === 'finding' };
}
