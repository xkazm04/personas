/**
 * useDeckStart — which card the deck opens on, decided once per opening.
 *
 *  - `focusId` in the queue            -> that card, at once.
 *  - no `focusId`, queue has cards     -> the first card, at once.
 *  - otherwise wait for the roster to settle: loading seen and ended, or
 *    never started within a short grace (a warm source with nothing to
 *    fetch). Then the focused card if it arrived, else the first card — a
 *    focused item that never appears was decided elsewhere, and the deck just
 *    opens on what is left, without a word.
 *
 * `null` means "still deciding": the deck shows a ghost card meanwhile (no
 * spinner). An empty string means "the first card, whenever there is one".
 */
import { useEffect, useRef, useState } from 'react';
import type { DecisionItem } from '../model/decisionModel';

const WARM_GRACE_MS = 400;

export function useDeckStart(queue: DecisionItem[], focusId: string | undefined, loading: boolean): string | null {
  const [start, setStart] = useState<string | null>(() => {
    if (focusId && queue.some((q) => q.id === focusId)) return focusId;
    if (!focusId && queue.length > 0) return queue[0]!.id;
    return null;
  });
  const sawLoading = useRef(false);
  const queueRef = useRef(queue);
  useEffect(() => { queueRef.current = queue; }, [queue]);

  useEffect(() => {
    if (start !== null) return;
    if (focusId && queue.some((q) => q.id === focusId)) { setStart(focusId); return; }
    if (!focusId && queue.length > 0) { setStart(queue[0]!.id); return; }
    if (loading) { sawLoading.current = true; return; }
    if (sawLoading.current) { setStart(queue[0]?.id ?? ''); return; }
    const timer = setTimeout(() => setStart(queueRef.current[0]?.id ?? ''), WARM_GRACE_MS);
    return () => clearTimeout(timer);
  }, [start, queue, focusId, loading]);

  return start;
}
