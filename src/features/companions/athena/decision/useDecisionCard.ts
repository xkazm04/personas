import { useCallback, useMemo } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { useAthenaStore } from '../athenaStore';
import { deferDecision, skipDecision } from './decisionDeferral';
import { explainDecision, runDecisionOption } from './resolveDecision';
import type { DecisionOption, PendingDecision } from './types';

/**
 * useDecisionCard - the logic behind a chat-side decision surface, without the
 * look. `ChatDecisionCard` renders it as the product's own card; card-native
 * surfaces (the Spread prototype's bodies) render the same verbs their own way,
 * so every surface resolves through `runDecisionOption` / `explainDecision` and
 * the deferral ledger and none of them re-implements a verb.
 */
export interface DecisionCardModel {
  decision: PendingDecision | null;
  /** The orb bubble is carrying this decision (minimized chat or Fleet grid open). */
  bubbleShowing: boolean;
  /** The operator asked for the recommendation (`0` / explain). */
  explained: boolean;
  /** The explain turn is composing a cockpit explanation. */
  composing: boolean;
  composeError: string | null;
  /** The picked option's action failed; the decision stays pending. */
  runError: string | null;
  /** Decisions the last queue build found, this one included. */
  queueDepth: number;
  /** Decisions queued behind this one. */
  waitingBehind: number;
  /**
   * The option Athena's recommendation names, by index, or -1. Derived from the
   * recommendation text (a `PendingDecision` carries no recommended index).
   */
  recommendedIndex: number;
  pick: (index: number) => Promise<void>;
  pickOption: (option: DecisionOption) => Promise<void>;
  explain: () => void;
  /** Hold the decision back for the snooze window; the queue surfaces the next. */
  later: () => void;
  /** Hold it back for the rest of the session. */
  skip: () => void;
}

/**
 * The option a free-text recommendation names: the longest option label (its
 * parenthetical stripped) that the recommendation mentions. -1 when none does.
 */
export function recommendedOptionIndex(decision: PendingDecision | null): number {
  const rec = decision?.recommendation?.toLowerCase();
  if (!decision || !rec) return -1;
  let best = -1;
  let bestLen = 0;
  decision.options.forEach((o, i) => {
    const core = o.label.replace(/\(.*?\)/g, '').trim().toLowerCase();
    if (core.length > bestLen && rec.includes(core)) {
      best = i;
      bestLen = core.length;
    }
  });
  return best;
}

export function useDecisionCard(): DecisionCardModel {
  const decision = useAthenaStore((s) => s.pendingDecision);
  const athenaState = useAthenaStore((s) => s.state);
  const explained = useAthenaStore((s) => s.decisionExplained);
  const composing = useAthenaStore((s) => s.explainComposing);
  const composeError = useAthenaStore((s) => s.explainComposeError);
  const runError = useAthenaStore((s) => s.decisionError);
  const queueDepth = useAthenaStore((s) => s.decisionQueueDepth);
  const clearPendingDecision = useAthenaStore((s) => s.clearPendingDecision);
  const fleetGridOpen = useSystemStore((s) => s.fleetGridOpen);

  // Exact complement of `OrbDecisionBubble`'s visibility predicate.
  const bubbleShowing = athenaState === 'minimized' || fleetGridOpen;
  const decisionId = decision?.id ?? null;

  const pickOption = useCallback((option: DecisionOption) => runDecisionOption(option), []);
  const pick = useCallback(
    async (index: number) => {
      const option = decision?.options[index];
      if (option) await runDecisionOption(option);
    },
    [decision],
  );
  const later = useCallback(() => {
    if (!decisionId) return;
    deferDecision(decisionId);
    clearPendingDecision();
  }, [decisionId, clearPendingDecision]);
  const skip = useCallback(() => {
    if (!decisionId) return;
    skipDecision(decisionId);
    clearPendingDecision();
  }, [decisionId, clearPendingDecision]);
  const recommendedIndex = useMemo(() => recommendedOptionIndex(decision), [decision]);

  return {
    decision,
    bubbleShowing,
    explained,
    composing,
    composeError: composeError ?? null,
    runError: runError ?? null,
    queueDepth,
    waitingBehind: decision ? Math.max(0, queueDepth - 1) : 0,
    recommendedIndex,
    pick,
    pickOption,
    explain: explainDecision,
    later,
    skip,
  };
}
