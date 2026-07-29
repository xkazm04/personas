// useDeckControls — everything between "the reviewer expressed an intent" and
// "the queue recorded a verdict". Extracted from `TriageDeckVariant` so the
// component file stays a layout, and so this logic can be reasoned about
// without scrolling past JSX.
//
// (A hook in a `.tsx` file: the prototype brief scopes this variant to
// `triage/deck/*.tsx`, so the extension is the constraint, not a preference.)
//
// Three rules encoded here:
//  1. Every verdict goes through `queue.decide`. Nothing in the deck touches an
//     API — the queue owns which backend each kind writes to.
//  2. A decision is queued BEFORE the card is thrown, and only lands when the
//     card reports its flight is over. `pendingRef` doubles as the in-flight
//     lock so a keystroke arriving during those 200ms can't decide the outgoing
//     card twice or the incoming one early.
//  3. The keydown listener registers ONCE. The latest top item and the latest
//     callbacks are read through refs, because an effect that tears down and
//     re-registers on every verdict will eventually swallow the second half of
//     a rapid double-tap.
//  4. `pendingRef` being both the queue and the lock is efficient and sharp: if
//     a card is thrown and never reports back, the lock never opens and the
//     WHOLE surface goes dead — keyboard, flanks and action bar. So every throw
//     also arms a watchdog. The card fixing its own reset is the real fix; this
//     is the guarantee that no future regression there can wedge the deck.
import { useCallback, useEffect, useRef, useState } from 'react';

import type { TriageDecision, TriageItem, TriageVerdict } from '../triageTypes';
import type { UnifiedTriageQueue } from '../useUnifiedTriage';
import type { FlingDirection, TriageCardHandle } from './TriageCard';

/**
 * How long a thrown card has to report its flight before the decision is landed
 * without it. Comfortably longer than the card's own 200ms verdict delay — this
 * is a stuck-detector, not a second animation clock.
 */
const FLIGHT_TIMEOUT_MS = 1200;

export function useDeckControls(queue: UnifiedTriageQueue, onClose: () => void) {
  const cardRef = useRef<TriageCardHandle | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingRef = useRef<TriageDecision | null>(null);
  const watchdogRef = useRef<number | null>(null);

  const [answer, setAnswer] = useState('');

  const top = queue.items[0] ?? null;
  const topId = top?.id ?? null;

  const topRef = useRef<TriageItem | null>(top);
  topRef.current = top;
  const answerRef = useRef(answer);
  answerRef.current = answer;

  useEffect(() => {
    setAnswer('');
  }, [topId]);

  const disarm = useCallback(() => {
    if (watchdogRef.current !== null) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  useEffect(() => disarm, [disarm]);

  /** Fired by the card once its flight has been seen. */
  const commit = useCallback(
    (dir: FlingDirection) => {
      disarm();
      const queued = pendingRef.current;
      pendingRef.current = null;
      if (queued) {
        void queue.decide(queued);
        return;
      }
      // No queued decision means the drag itself was the verdict.
      const item = topRef.current;
      if (!item) return;
      const verdict: TriageVerdict = dir === 'right' ? 'accept' : dir === 'left' ? 'reject' : 'skip';
      void queue.decide({ item, verdict });
    },
    [queue, disarm],
  );

  /** Throw the card, then decide. Decides outright if there is no card to throw. */
  const run = useCallback(
    (decision: TriageDecision, dir: FlingDirection) => {
      if (!cardRef.current) {
        void queue.decide(decision);
        return;
      }
      pendingRef.current = decision;
      // Land it anyway if the flight is never reported — a card that unmounts
      // mid-throw, or is re-dealt without resetting, must not take the deck's
      // input with it.
      disarm();
      watchdogRef.current = window.setTimeout(() => {
        watchdogRef.current = null;
        if (pendingRef.current !== decision) return;
        pendingRef.current = null;
        void queue.decide(decision);
      }, FLIGHT_TIMEOUT_MS);
      cardRef.current.launch(dir);
    },
    [queue, disarm],
  );

  const decideTop = useCallback(
    (verdict: TriageVerdict) => {
      if (pendingRef.current) return;
      const item = topRef.current;
      if (!item) return;

      if (verdict === 'accept' && item.input) {
        // A deferred question has no answer this surface can honour — only its
        // branch is real, so accept is a no-op rather than an empty submit.
        if (item.input.deferred) return;
        const value = answerRef.current.trim();
        if (!value) {
          textareaRef.current?.focus();
          return;
        }
        run({ item, verdict: 'accept', answer: value }, 'right');
        return;
      }

      run({ item, verdict }, verdict === 'accept' ? 'right' : verdict === 'reject' ? 'left' : 'down');
    },
    [run],
  );

  const submitAnswer = useCallback(
    (value: string) => {
      if (pendingRef.current) return;
      const item = topRef.current;
      const trimmed = value.trim();
      if (!item || !trimmed) return;
      run({ item, verdict: 'accept', answer: trimmed }, 'right');
    },
    [run],
  );

  const fireBranch = useCallback(
    (branchId: string) => {
      if (pendingRef.current) return;
      const item = topRef.current;
      if (!item || !item.branches.some((b) => b.id === branchId)) return;
      // A branch is an affirmative act; `decide` routes on branchId, not verdict.
      run({ item, verdict: 'accept', branchId }, 'right');
    },
    [run],
  );

  const live = useRef({ decideTop, fireBranch, onClose });
  live.current = { decideTop, fireBranch, onClose };

  // One stable listener for the session. Arrows decide, numbers branch.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      const inField =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el?.isContentEditable;

      if (e.key === 'Escape') {
        e.preventDefault();
        // Esc inside the answer box steps out of it first. Closing the whole
        // deck mid-sentence would throw away work the reviewer just typed.
        if (inField) el?.blur();
        else live.current.onClose();
        return;
      }

      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (inField) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        live.current.decideTop('reject');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        live.current.decideTop('accept');
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        live.current.decideTop('skip');
      } else if (/^[1-9]$/.test(e.key)) {
        const branch = topRef.current?.branches[Number(e.key) - 1];
        if (!branch) return;
        e.preventDefault();
        live.current.fireBranch(branch.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const isDeferred = !!top?.input?.deferred;

  return {
    top,
    answer,
    setAnswer,
    cardRef,
    textareaRef,
    commit,
    decideTop,
    submitAnswer,
    fireBranch,
    /** False until a question card has something submittable in it. */
    canAccept: !!top && (!top.input || (!isDeferred && answer.trim().length > 0)),
  };
}
