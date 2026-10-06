/**
 * useDeck — the deck's state machine: which queue is open, which card is on
 * top, how the last card left, and the two-step verdicts (arm, then confirm;
 * reject, then a reason).
 *
 * A verdict is felt before it is committed: the card is STAMPED with the
 * verdict first (`stamp`), and only after a short beat does the queue advance
 * and the Lab drop the item, so the card visibly leaves toward the verdict's
 * meaning. Reduced motion commits at once.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import type { TriageReasonPrompt } from '@/features/agents/quick-answer/triage/triageTypes';
import type { DecisionItem, DecisionModalType, HubChip } from '../../../model/decisionModel';
import { chipOf, modalTypeOf } from '../../../model/decisionModel';
import type { PrototypeVerdict } from '../../directionContract';
import type { Leave } from './deckMotion';

export type DeckScope =
  | { kind: 'chip'; chip: HubChip }
  | { kind: 'all' }
  | { kind: 'type'; type: DecisionModalType };

export function queueOf(scope: DeckScope, items: DecisionItem[], ready: DecisionItem[]): DecisionItem[] {
  if (scope.kind === 'all') return items;
  if (scope.kind === 'type') return items.filter((x) => modalTypeOf(x.kind) === scope.type);
  if (scope.chip === 'ready') return ready;
  return items.filter((x) => chipOf(x.kind) === scope.chip);
}

/** Beat between the stamp landing and the card leaving, in ms. */
const STAMP_BEAT = 150;

export interface DeckMotionState { dir: 1 | -1; leave: Leave }

export function useDeck(opts: {
  scope: DeckScope;
  startId: string;
  items: DecisionItem[];
  ready: DecisionItem[];
  onDecide: (v: PrototypeVerdict) => void;
  onEmpty: () => void;
}) {
  const { scope, items, ready, onDecide, onEmpty } = opts;
  const still = useReducedMotion();
  const queue = useMemo(() => queueOf(scope, items, ready), [scope, items, ready]);
  const [currentId, setCurrentId] = useState(opts.startId);
  const [motion, setMotion] = useState<DeckMotionState>({ dir: 1, leave: 'walk' });
  const [stamp, setStamp] = useState<Leave | null>(null);
  const [armed, setArmed] = useState<'accept' | 'reject' | null>(null);
  const [prompt, setPrompt] = useState<TriageReasonPrompt | null>(null);

  const index = Math.max(0, queue.findIndex((x) => x.id === currentId));
  const item: DecisionItem | undefined = queue[index];

  const queueRef = useRef(queue);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // A new card starts disarmed.
  useEffect(() => {
    setArmed(null);
    setPrompt(null);
  }, [item?.id]);

  const walk = useCallback((delta: 1 | -1) => {
    if (stamp) return;
    const next = queue[queue.findIndex((x) => x.id === currentId) + delta];
    if (!next) return;
    setMotion({ dir: delta, leave: 'walk' });
    setCurrentId(next.id);
  }, [queue, currentId, stamp]);

  const commit = useCallback((v: PrototypeVerdict, leave: Leave) => {
    const q = queueRef.current;
    const i = q.findIndex((x) => x.id === v.item.id);
    let next: DecisionItem | undefined;
    if (leave === 'skip') next = q.length > 1 ? q[(i + 1) % q.length] : undefined;
    else next = q[i + 1] ?? q[i - 1];
    setStamp(null);
    setMotion({ dir: 1, leave });
    onDecide(v);
    if (next) setCurrentId(next.id);
    else if (leave !== 'skip') onEmpty();
  }, [onDecide, onEmpty]);

  const decide = useCallback((v: Omit<PrototypeVerdict, 'item'>, leave: Leave) => {
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
