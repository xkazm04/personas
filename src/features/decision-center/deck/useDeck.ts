/**
 * useDeck — the deck's state machine: which card is on top, how the last card
 * left, and the two-step verdicts (arm, then confirm; reject, then a reason).
 *
 * A verdict is felt before it is committed: the card is STAMPED with the
 * verdict first (`stamp`), and only after a short beat does the queue advance
 * and the write go out, so the card visibly leaves toward the verdict's
 * meaning. Reduced motion commits at once.
 *
 * The write is the host's (`onDecide`, which rejects when it did not land).
 * The queue is the roster's, which drops a decided item optimistically and
 * puts it back when the write fails — so on a rejection the deck walks back
 * to the restored card. The LAST card is different: the deck only closes once
 * its write has landed, so a failed last write leaves the card in hand.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import type { TriageReasonPrompt } from '@/features/agents/quick-answer/triage/triageTypes';
import type { DecisionItem } from '../model/decisionModel';
import { chipOf } from '../model/decisionModel';
import type { DeckRequestScope } from './deckStore';
import type { DeckVerdict } from './deckTypes';
import type { Leave } from './deckMotion';

/** The cards a scope deals, in roster order. `items` is the roster's loaded list. */
export function queueOf(scope: DeckRequestScope, items: DecisionItem[]): DecisionItem[] {
  if (scope.kind === 'single') return [scope.item];
  if (scope.kind === 'all') return items;
  return items.filter((x) => chipOf(x.kind) === scope.chip);
}

/** Beat between the stamp landing and the card leaving, in ms. */
const STAMP_BEAT = 150;

export interface DeckMotionState { dir: 1 | -1; leave: Leave }

export function useDeck(opts: {
  queue: DecisionItem[];
  startId: string;
  /** The write. Resolves when it landed; rejects when it did not (the host has toasted). */
  onDecide: (v: DeckVerdict) => Promise<void> | void;
  onEmpty: () => void;
}) {
  const { queue, onDecide, onEmpty } = opts;
  const still = useReducedMotion();
  const [currentId, setCurrentId] = useState(opts.startId);
  const [motion, setMotion] = useState<DeckMotionState>({ dir: 1, leave: 'walk' });
  const [stamp, setStamp] = useState<Leave | null>(null);
  const [armed, setArmed] = useState<'accept' | 'reject' | null>(null);
  const [prompt, setPrompt] = useState<TriageReasonPrompt | null>(null);

  const index = useMemo(() => Math.max(0, queue.findIndex((x) => x.id === currentId)), [queue, currentId]);
  const item: DecisionItem | undefined = queue[index];

  const queueRef = useRef(queue);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  useEffect(() => () => {
    alive.current = false;
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // A new card starts disarmed.
  useEffect(() => {
    setArmed(null);
    setPrompt(null);
  }, [item?.id]);

  const walk = useCallback((delta: 1 | -1) => {
    if (stamp) return;
    const next = queue[index + delta];
    if (!next) return;
    setMotion({ dir: delta, leave: 'walk' });
    setCurrentId(next.id);
  }, [queue, index, stamp]);

  const commit = useCallback((v: DeckVerdict, leave: Leave) => {
    const q = queueRef.current;
    const i = q.findIndex((x) => x.id === v.item.id);
    if (leave === 'skip') {
      setStamp(null);
      setMotion({ dir: 1, leave });
      const next = q.length > 1 ? q[(i + 1) % q.length] : undefined;
      if (next) setCurrentId(next.id);
      return;
    }
    const next = q[i + 1] ?? q[i - 1];
    setStamp(null);
    setMotion({ dir: 1, leave });
    if (next) setCurrentId(next.id);
    void Promise.resolve()
      .then(() => onDecide(v))
      .then(
        () => { if (!next && alive.current) onEmpty(); },
        // The roster restored the item; walk back to it.
        () => { if (alive.current) setCurrentId(v.item.id); },
      );
  }, [onDecide, onEmpty]);

  const decide = useCallback((v: Omit<DeckVerdict, 'item'>, leave: Leave) => {
    if (!item || stamp) return;
    const full = { ...v, item };
    if (still) { commit(full, leave); return; }
    setStamp(leave);
    timer.current = setTimeout(() => commit(full, leave), STAMP_BEAT);
  }, [item, stamp, still, commit]);

  /** R: arm reject; a second press (or Enter) confirms, a reason may follow. */
  const reject = useCallback(() => {
    if (!item) return;
    if (armed !== 'reject') { setArmed('reject'); return; }
    const p = item.reasonPrompts?.find((r) => r.on === 'reject');
    if (p) { setPrompt(p); setArmed(null); return; }
    decide({ verdict: 'reject' }, 'reject');
  }, [item, armed, decide]);

  return {
    queue, index, item, motion, stamp, armed, prompt,
    setArmed, setPrompt, walk, decide, reject,
  };
}

export type DeckController = ReturnType<typeof useDeck>;
