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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

  /**
   * Every answer typed this session, keyed `${sourceId}::${fieldKey}`.
   *
   * Keyed by SOURCE, not by card id, and never cleared on a top-item change.
   * The draft used to be one string wiped by an effect on `topId`, so a poll
   * landing while someone typed — another question answered elsewhere, a new
   * one raised by the CLI — changed the card's identity and took the
   * half-written answer with it. Session ids outlive that churn; card ids
   * deliberately do not (see `questionGroupToTriage`).
   */
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const top = queue.items[0] ?? null;

  const topRef = useRef<TriageItem | null>(top);
  topRef.current = top;
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  const draftKey = (item: TriageItem, field: string) => `${item.sourceId}::${field}`;

  /** What the top card currently holds, by field key. */
  const answers = useMemo(() => {
    if (!top?.input) return {};
    const out: Record<string, string> = {};
    for (const field of top.input.fields) {
      out[field.key] = drafts[`${top.sourceId}::${field.key}`] ?? '';
    }
    return out;
  }, [top, drafts]);

  const setAnswer = useCallback((fieldKey: string, value: string) => {
    const item = topRef.current;
    if (!item) return;
    setDrafts((prev) => ({ ...prev, [`${item.sourceId}::${fieldKey}`]: value }));
  }, []);

  /** The top card's answers, merged with anything submitted inline. */
  const collect = useCallback(
    (item: TriageItem, extra?: Record<string, string>): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const field of item.input?.fields ?? []) {
        const value = extra?.[field.key] ?? draftsRef.current[draftKey(item, field.key)] ?? '';
        if (value.trim()) out[field.key] = value.trim();
      }
      return out;
    },
    [],
  );

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
        // A fully deferred card has no answer this surface can honour — only
        // its branch is real, so accept is a no-op rather than an empty submit.
        if (item.input.deferred) return;
        const filled = collect(item);
        if (Object.keys(filled).length === 0) {
          textareaRef.current?.focus();
          return;
        }
        run({ item, verdict: 'accept', answers: filled }, 'right');
        return;
      }

      run({ item, verdict }, verdict === 'accept' ? 'right' : verdict === 'reject' ? 'left' : 'down');
    },
    [run, collect],
  );

  /**
   * Submit the card's collected answers as ONE batch. `extra` is for controls
   * that carry their own value (a choice option the reviewer just clicked) and
   * would otherwise race the draft state they just set.
   */
  const submitAnswers = useCallback(
    (extra?: Record<string, string>) => {
      if (pendingRef.current) return;
      const item = topRef.current;
      if (!item) return;
      const filled = collect(item, extra);
      if (Object.keys(filled).length === 0) return;
      run({ item, verdict: 'accept', answers: filled }, 'right');
    },
    [run, collect],
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

  /**
   * Follow the card's first link. Not a verdict: the card stays, nothing is
   * written, and there is no throw — the reviewer is going to read the run and
   * come back to a card still waiting for them.
   */
  const followLink = useCallback(() => {
    const item = topRef.current;
    const link = item?.links?.[0];
    if (!item || !link) return;
    queue.openLink(item, link.id);
  }, [queue]);

  const live = useRef({ decideTop, fireBranch, followLink, onClose });
  live.current = { decideTop, fireBranch, followLink, onClose };

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
      } else if (e.key === 'o' || e.key === 'O') {
        e.preventDefault();
        live.current.followLink();
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
  const filledCount = Object.values(answers).filter((v) => v.trim()).length;

  return {
    top,
    /** The top card's drafts, by field key. */
    answers,
    setAnswer,
    cardRef,
    textareaRef,
    commit,
    decideTop,
    submitAnswers,
    fireBranch,
    followLink,
    /** False until a question card has at least one field filled in. A session
     *  card submits what the reviewer HAS answered — waiting for all of them
     *  would block a mixed session on a field this surface cannot collect. */
    canAccept: !!top && (!top.input || (!isDeferred && filledCount > 0)),
  };
}
