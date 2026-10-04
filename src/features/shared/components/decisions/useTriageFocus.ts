/** @catalog TriageFocus state: cursors, per-option verdicts, the note, and the one guarded verdict write. */
// useTriageFocus — every piece of state the focus flow holds, and the one
// place a verdict is written.
//
// Split out of `TriageFocus.tsx` so the view file stays a view. It owns four
// independent cursors (which ITEM, which decision OPTION inside it, which
// verdict is ARMED, what the note says) plus the write itself.
//
// THE INHERITED BUG THIS FIXES — do not "simplify" it back.
// `RailTriageModal.tsx:90-95` wrapped its `await onDecide(...)` in a
// `try { … } finally { setBusy(false) }` with NO `catch`, and the queue's own
// `decide` swallows the rejection and toasts. The modal therefore closed — and
// the row disappeared from the queue — on a verdict whose write had FAILED.
// Here the rejection is caught, kept in `error`, and NOTHING is cleared: the
// item stays open, the per-option verdicts stay recorded, the note stays typed,
// and the surface renders the failure beside the buttons. A triage surface that
// advances on a failed write silently loses decisions.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { resolveError } from '@/lib/errors/errorRegistry';

import type { TriageDecision, TriageItem, TriageVerdict } from '@/features/shared/triage/triageFocusBridge';

/**
 * A verdict on ONE option of a multi-decision item. `skip` has no meaning here.
 *
 * THIS TYPE RAISES A CENSUS RATCHET ON PURPOSE — `staged-verdict-map-collapsed`
 * (`docs/concepts/golden-paths/selective-per-item-verdicts.md`), which anchors
 * on `useState<Record<string, *Verdict>>`. The ratchet is telling the truth and
 * it was NOT laundered: the honest state of this component is HALF fixed.
 *
 * Fixed: the per-option map is committed AS A MAP, in `TriageDecision.answers`
 * keyed by option id, so the reviewer's partial judgement survives the
 * boundary. The donor flattened it into a `Decisions:\n+ label` prose blob in
 * `reviewer_notes` — measured by that golden path across the operator's own
 * database, 184 sub-decisions rendered and ZERO durable verdicts written.
 *
 * NOT fixed: the PARENT item still collapses to one spine verdict
 * (`anyAccepted ? 'accept' : 'reject'`), inherited from the donor, because the
 * spine has exactly three verdicts and no caller consumes `answers` yet. The
 * rise clears when the dispatcher reads `answers` — WP5's work, not a type
 * rename here. Renaming this away from `…Verdict` is exactly the laundering
 * the rule's own description forbids.
 */
export type OptionVerdict = 'accept' | 'reject';

export type TriageFocusDecide = (decision: TriageDecision) => void | Promise<void>;

export function useTriageFocus(
  items: readonly TriageItem[],
  onDecide: TriageFocusDecide,
  controlledIndex?: number,
  onIndexChange?: (index: number) => void,
) {
  const [localIndex, setLocalIndex] = useState(0);
  const [dir, setDir] = useState(0);
  const [optionIndex, setOptionIndex] = useState(0);
  const [optionDir, setOptionDir] = useState(0);
  const [optionVerdicts, setOptionVerdicts] = useState<Record<string, OptionVerdict>>({});
  const [armed, setArmed] = useState<TriageVerdict | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rawIndex = controlledIndex ?? localIndex;
  const index = items.length === 0 ? 0 : Math.min(rawIndex, items.length - 1);
  const item = items[index] ?? null;
  const options = useMemo(() => item?.decisions ?? [], [item]);

  // Clamp an uncontrolled cursor that the queue shrank out from under.
  useEffect(() => {
    if (controlledIndex == null && localIndex > 0 && localIndex >= items.length) {
      setLocalIndex(Math.max(0, items.length - 1));
    }
  }, [controlledIndex, localIndex, items.length]);

  // Reset per-item state when the ITEM changes — keyed on the id, not the
  // index, because a resolved row shifts every index below it and an
  // index-keyed reset would wipe a note the reviewer is still typing.
  const itemId = item?.id ?? null;
  const lastItemId = useRef<string | null>(itemId);
  useEffect(() => {
    if (lastItemId.current === itemId) return;
    lastItemId.current = itemId;
    setOptionVerdicts({});
    setOptionIndex(0);
    setOptionDir(0);
    setArmed(null);
    setNote('');
    setError(null);
  }, [itemId]);

  const goTo = useCallback((next: number) => {
    if (next < 0 || next >= items.length) return;
    setDir(next > index ? 1 : -1);
    if (controlledIndex == null) setLocalIndex(next);
    onIndexChange?.(next);
  }, [items.length, index, controlledIndex, onIndexChange]);

  const goNext = useCallback(() => goTo(index + 1), [goTo, index]);
  const goPrev = useCallback(() => goTo(index - 1), [goTo, index]);

  const selectOption = useCallback((next: number) => {
    setOptionDir(next > optionIndex ? 1 : -1);
    setOptionIndex(next);
  }, [optionIndex]);

  const nextOption = useCallback(() => {
    if (optionIndex < options.length - 1) selectOption(optionIndex + 1);
  }, [optionIndex, options.length, selectOption]);

  const prevOption = useCallback(() => {
    if (optionIndex > 0) selectOption(optionIndex - 1);
  }, [optionIndex, selectOption]);

  const setAllOptions = useCallback((verdict: OptionVerdict) => {
    const next: Record<string, OptionVerdict> = {};
    for (const option of options) next[option.id] = verdict;
    setOptionVerdicts(next);
  }, [options]);

  const clearOptions = useCallback(() => setOptionVerdicts({}), []);

  /**
   * Write one verdict.
   *
   * `answers` carries the per-option verdicts STRUCTURED, keyed by option id —
   * the donor folded them into a free-text `notes` blob ("Decisions:\n+ label")
   * that no consumer could read back without parsing prose. The note stays a
   * note: `reason` is whatever the reviewer typed and nothing else.
   */
  const commit = useCallback(async (
    verdict: TriageVerdict,
    opts?: { branchId?: string; answers?: Record<string, OptionVerdict> },
  ) => {
    if (!item || busy) return;
    const answers = opts?.answers ?? optionVerdicts;
    setBusy(true);
    setError(null);
    try {
      await onDecide({
        item,
        verdict,
        ...(opts?.branchId ? { branchId: opts.branchId } : {}),
        ...(Object.keys(answers).length > 0 ? { answers } : {}),
        ...(note.trim() ? { reason: note.trim() } : {}),
      });
      setArmed(null);
      setNote('');
      setOptionVerdicts({});
    } catch (e) {
      // See the module header: the item stays open and everything typed stays
      // typed. The caller's queue decides whether the row is still there.
      //
      // Through the error registry, never the raw `message`. A verdict write
      // fails for reasons the reviewer can act on (the row was decided
      // elsewhere, the door refused it, the backend is unreachable), and the
      // registry is where this repo keeps the sentence that says which. A bare
      // `e.message` here would put a backend string in front of the one person
      // whose next action depends on understanding it.
      setError(resolveError(e instanceof Error ? e.message : String(e)).message);
    } finally {
      setBusy(false);
    }
  }, [item, busy, optionVerdicts, note, onDecide]);

  /**
   * Record a verdict on ONE option and move on: to the next undecided option,
   * or — when that was the last one — straight to the item's own verdict.
   * Any accepted option approves the item; all rejected rejects it.
   */
  const decideOption = useCallback((optionId: string, verdict: OptionVerdict) => {
    if (!item || busy) return;
    const next = { ...optionVerdicts, [optionId]: verdict };
    setOptionVerdicts(next);

    if (options.every((o) => next[o.id] != null)) {
      const anyAccepted = options.some((o) => next[o.id] === 'accept');
      void commit(anyAccepted ? 'accept' : 'reject', { answers: next });
      return;
    }
    for (let step = 1; step <= options.length; step++) {
      const candidate = (optionIndex + step) % options.length;
      if (next[options[candidate]!.id] == null) {
        selectOption(candidate);
        return;
      }
    }
  }, [item, busy, optionVerdicts, options, optionIndex, commit, selectOption]);

  const accepted = Object.values(optionVerdicts).filter((v) => v === 'accept').length;
  const rejected = Object.values(optionVerdicts).filter((v) => v === 'reject').length;

  return {
    index, item, options,
    optionIndex, optionDir, dir,
    option: options[optionIndex] ?? null,
    optionVerdicts, accepted, rejected, undecided: options.length - accepted - rejected,
    armed, setArmed, note, setNote, busy, error, dismissError: () => setError(null),
    goTo, goNext, goPrev,
    selectOption, nextOption, prevOption,
    setAllOptions, clearOptions, decideOption, commit,
  };
}

export type TriageFocusController = ReturnType<typeof useTriageFocus>;
