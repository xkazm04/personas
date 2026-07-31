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

import { useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { SHORTCUTS_OPEN_EVENT } from '@/lib/keyboard/shortcutRegistry';

import {
  reasonPromptFor,
  type TriageDecision,
  type TriageItem,
  type TriageReasonPrompt,
  type TriageVerdict,
} from '../triageTypes';
import type { UnifiedTriageQueue } from '../useUnifiedTriage';
import type { FlingDirection, TriageCardHandle } from './TriageCard';
import { useDeckDialog } from './useDeckDialog';

/**
 * One decision waiting on "why?".
 *
 * `thrown` is the load-bearing field. A rejection reached by KEYBOARD or button
 * asks before the card flies, so the reviewer can still see what they are
 * rejecting. A rejection reached by DRAGGING the card left has already happened
 * — the card is mid-flight and the gesture is the whole point of the surface, so
 * asking first would mean catching the card and putting it back. The prompt
 * therefore appears after the throw in that case, and resolving must not throw
 * a card that has already gone.
 */
interface ReasonCapture {
  item: TriageItem;
  prompt: TriageReasonPrompt;
  /** Set when a BRANCH is being qualified rather than a plain rejection. */
  branchId?: string;
  thrown: boolean;
}

/**
 * How long a thrown card has to report its flight before the decision is landed
 * without it. Comfortably longer than the card's own 200ms verdict delay — this
 * is a stuck-detector, not a second animation clock.
 */
const FLIGHT_TIMEOUT_MS = 1200;

/**
 * Where the deck sits on the app's keyboard ladder (see `AppKeyboardProvider`).
 *
 * Above every route-level surface (10) and above the app-shell conveniences —
 * KeyboardNavMode (30), TitleBarDock's hint keys (29), the `?` cheat sheet (20),
 * WorkspaceShortcuts (15) — because while the deck is up it is the only thing
 * the reviewer can see, and a `;` or an `R` firing behind it moves the app out
 * from under a decision in flight. Deliberately BELOW BaseModal (80) and the
 * command palette (90): a modal opened on top of the deck must keep its own
 * Escape and focus trap, and mod+K has to work from anywhere in the app.
 */
const DECK_KEYBOARD_PRIORITY = 70;

export function useDeckControls(queue: UnifiedTriageQueue, onClose: () => void) {
  const cardRef = useRef<TriageCardHandle | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingRef = useRef<TriageDecision | null>(null);
  const watchdogRef = useRef<number | null>(null);

  /** Focus trap, focus restore and the reserved vertical keys. */
  const dialog = useDeckDialog();
  const { scrollBody, cycleTab, recoverFocus } = dialog;

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

  /** The decision currently waiting on "why?", and its half-typed reason. */
  const [capture, setCapture] = useState<ReasonCapture | null>(null);
  const [reasonDraft, setReasonDraft] = useState('');

  const top = queue.items[0] ?? null;

  const topRef = useRef<TriageItem | null>(top);
  topRef.current = top;
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const captureRef = useRef<ReasonCapture | null>(capture);
  captureRef.current = capture;

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

  /**
   * What the last write actually recorded, in the item's own words.
   *
   * Half of the deck's ONE live region (see `TriageDeckVariant`). The card used
   * to carry two permanent `role="status"` stamps, so every deal announced
   * "Reject… Approve" and buried the only thing that mattered — the title of
   * the card now being presented.
   */
  const [lastVerdict, setLastVerdict] = useState<string | null>(null);

  /**
   * The single door out to the queue. Every path that writes goes through it,
   * so what a screen reader hears can never disagree with what was recorded.
   */
  const send = useCallback(
    (decision: TriageDecision) => {
      const { item, branchId } = decision;
      const branch = branchId ? item.branches.find((b) => b.id === branchId) : undefined;
      setLastVerdict(branch?.label ?? item.verdictLabels[decision.verdict]);
      void queue.decide(decision);
    },
    [queue],
  );

  /** Fired by the card once its flight has been seen. */
  const commit = useCallback(
    (dir: FlingDirection) => {
      disarm();
      const queued = pendingRef.current;
      pendingRef.current = null;
      if (queued) {
        send(queued);
        return;
      }
      // No queued decision means the drag itself was the verdict.
      const item = topRef.current;
      if (!item) return;
      const verdict: TriageVerdict = dir === 'right' ? 'accept' : dir === 'left' ? 'reject' : 'skip';
      // A left flick is a rejection, and it has already flown — so the reason is
      // asked AFTER the throw here rather than before it. Catching the card
      // mid-air to interrogate the reviewer would break the one gesture this
      // whole surface is built around.
      if (verdict === 'reject') {
        const prompt = reasonPromptFor(item, 'reject');
        if (prompt) {
          setCapture({ item, prompt, thrown: true });
          setReasonDraft('');
          return;
        }
      }
      send({ item, verdict });
    },
    [send, disarm],
  );

  /** Throw the card, then decide. Decides outright if there is no card to throw. */
  const run = useCallback(
    (decision: TriageDecision, dir: FlingDirection) => {
      if (!cardRef.current) {
        send(decision);
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
        send(decision);
      }, FLIGHT_TIMEOUT_MS);
      cardRef.current.launch(dir);
    },
    [send, disarm],
  );

  /**
   * Ask "why?" instead of deciding, and remember what to do with the answer.
   *
   * Deliberately NOT a modal and never a blocker on the flick: the strip takes
   * over the action bar, the card stays exactly where it is, and every path out
   * of here costs one keystroke.
   */
  const beginCapture = useCallback((next: ReasonCapture) => {
    setCapture(next);
    setReasonDraft('');
  }, []);

  /**
   * Land the captured decision. `reason` undefined = the reviewer skipped, which
   * is a first-class answer: the write happens either way, exactly as it did
   * before this prompt existed.
   */
  const resolveReason = useCallback(
    (reason?: string) => {
      const held = captureRef.current;
      if (!held) return;
      captureRef.current = null;
      setCapture(null);
      setReasonDraft('');

      const decision: TriageDecision = {
        item: held.item,
        // A branch is an affirmative act; `routeDecision` routes on branchId.
        verdict: held.branchId ? 'accept' : 'reject',
        branchId: held.branchId,
        reason: reason?.trim() || undefined,
      };
      // A card already in the air must not be thrown a second time.
      if (held.thrown) send(decision);
      else run(decision, held.branchId ? 'right' : 'left');
    },
    [send, run],
  );

  /** A capture whose card has left the queue has nothing left to write. */
  useEffect(() => {
    if (!capture) return;
    if (queue.items.some((i) => i.id === capture.item.id)) return;
    setCapture(null);
    setReasonDraft('');
  }, [capture, queue.items]);

  const decideTop = useCallback(
    (verdict: TriageVerdict) => {
      if (pendingRef.current || captureRef.current) return;
      const item = topRef.current;
      if (!item) return;

      // A rejection that can teach something asks before it lands.
      if (verdict === 'reject') {
        const prompt = reasonPromptFor(item, 'reject');
        if (prompt) {
          beginCapture({ item, prompt, thrown: false });
          return;
        }
      }

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
    [run, collect, beginCapture],
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
      if (pendingRef.current || captureRef.current) return;
      const item = topRef.current;
      if (!item || !item.branches.some((b) => b.id === branchId)) return;
      // Some branches record something about themselves too — deprecating a
      // practice can name what replaces it.
      const prompt = reasonPromptFor(item, branchId);
      if (prompt) {
        beginCapture({ item, prompt, branchId, thrown: false });
        return;
      }
      // A branch is an affirmative act; `decide` routes on branchId, not verdict.
      run({ item, verdict: 'accept', branchId }, 'right');
    },
    [run, beginCapture],
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

  const live = useRef({
    decideTop,
    fireBranch,
    followLink,
    resolveReason,
    onClose,
    scrollBody,
    cycleTab,
  });
  live.current = {
    decideTop,
    fireBranch,
    followLink,
    resolveReason,
    onClose,
    scrollBody,
    cycleTab,
  };

  /**
   * Every verdict remounts the top card, which takes the focused scroller with
   * it and drops focus on `<body>` — one decision and the trap would be over.
   */
  useEffect(() => {
    recoverFocus();
  }, [top?.id, recoverFocus]);

  /**
   * One stable handler for the session. Arrows decide, numbers branch.
   *
   * Registered through the app keyboard registry rather than on `window`, and
   * EXCLUSIVELY (see `useAppKeyboard`). The deck renders OVER the live route —
   * `TrayOverlays` mounts it and nothing beneath it unmounts — so a bare
   * `window` listener left every route-level decision surface underneath still
   * listening: on Approvals → Backlog → Focus, one `←` rejected the deck's card
   * AND a backlog idea nobody could see. `preventDefault()` cannot stop a
   * sibling `window` listener; only a registry that knows who owns the keyboard
   * can. Exclusivity, not just priority, is the guarantee — a key the deck
   * ignores (`a`, `z`, `Shift+←`) must not reach an invisible surface either.
   */
  const onKey = useCallback((e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    const tag = el?.tagName;
    const inField =
      tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el?.isContentEditable;
    const held = captureRef.current;

    // Before the modifier bail-out, because Shift+Tab is half of the trap.
    if (e.key === 'Tab') return live.current.cycleTab(e);

    if (e.key === 'Escape') {
      e.preventDefault();
      // Esc inside a text box steps out of it first. Closing the whole deck
      // mid-sentence would throw away work the reviewer just typed.
      if (inField) el?.blur();
      // While a reason is being asked for, Esc is the ONE-KEYSTROKE skip: the
      // decision lands with no reason, which is what the app did before this
      // prompt existed. It must never close the deck out from under a verdict
      // the reviewer has already committed to.
      else if (held) live.current.resolveReason();
      else live.current.onClose();
      return true;
    }

    // `?` opens the cheat sheet, and it has to be handled HERE — before the
    // modifier bail-out, because `?` is Shift+/ and because an exclusive
    // surface swallows whatever it declines. The cheat sheet sits at priority
    // 20, far below this deck, so it can never see the key on its own.
    //
    // Dispatching its open-event rather than raising its priority above 70 is
    // deliberate: the alternative would make `?` beat every modal in the app,
    // and `?` typed into a modal's text field is a different intent entirely.
    // The sheet is a BaseModal at 80, so once open it correctly owns Escape
    // and renders above the deck.
    if (e.key === '?' && !e.altKey && !e.ctrlKey && !e.metaKey && !inField) {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent(SHORTCUTS_OPEN_EVENT));
      return true;
    }

    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
    if (inField) return false;

    // Vertical keys are RESERVED for reading and never become a verdict. They
    // are handled before reason mode on purpose: "why did you reject this?" is
    // exactly the moment a reviewer wants to scroll back through the card.
    // Without them a 40-line description was undecidable by keyboard — `←`/`→`
    // are verdicts, so there was no way to see past the first screenful.
    if (live.current.scrollBody(e.key)) {
      e.preventDefault();
      return true;
    }

    // Reason mode owns the keyboard while it is up: digits pick a preset,
    // Enter skips. Nothing else can decide, because there is already a
    // decision waiting to land.
    if (held) {
      if (e.key === 'Enter') {
        e.preventDefault();
        live.current.resolveReason();
        return true;
      }
      if (/^[1-9]$/.test(e.key)) {
        const option = held.prompt.options[Number(e.key) - 1];
        if (!option) return false;
        e.preventDefault();
        live.current.resolveReason(option.value);
        return true;
      }
      return false;
    }

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      live.current.decideTop('reject');
      return true;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      live.current.decideTop('accept');
      return true;
    }
    if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      live.current.decideTop('skip');
      return true;
    }
    if (e.key === 'o' || e.key === 'O') {
      e.preventDefault();
      live.current.followLink();
      return true;
    }
    if (/^[1-9]$/.test(e.key)) {
      const branch = topRef.current?.branches[Number(e.key) - 1];
      if (!branch) return false;
      e.preventDefault();
      live.current.fireBranch(branch.id);
      return true;
    }
    return false;
  }, []);

  useAppKeyboard(onKey, { priority: DECK_KEYBOARD_PRIORITY, exclusive: true });

  const isDeferred = !!top?.input?.deferred;
  const filledCount = Object.values(answers).filter((v) => v.trim()).length;

  return {
    top,
    /** Attach to the deck's root — it is the dialog panel the trap works over. */
    containerRef: dialog.containerRef,
    /** Attach to the TOP card's prose scroller, and nothing deeper. */
    scrollerRef: dialog.scrollerRef,
    /** The verdict last written, in the item's own words, or null. */
    lastVerdict,
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
    /** The decision waiting on "why?", or null. Non-null means the deck is in
     *  reason mode: the strip replaces the action bar and owns the keyboard. */
    capture,
    /** Free-text reason being typed, if the prompt accepts one. */
    reasonDraft,
    setReasonDraft,
    /** Land the captured decision. No argument = the reviewer skipped. */
    resolveReason,
    /** False until a question card has at least one field filled in. A session
     *  card submits what the reviewer HAS answered — waiting for all of them
     *  would block a mixed session on a field this surface cannot collect. */
    canAccept: !!top && (!top.input || (!isDeferred && filledCount > 0)),
  };
}
