/**
 * useDecisionCounts — the roster's COUNTS half, on its own.
 *
 * `useDecisionRoster` with nothing in `load` still mounts the triage deck's
 * machinery (`useUnifiedTriage` → `usePendingInteractions` → `useMonitorData`),
 * and that chain runs a 100-row pending-review list poll every 30 s whatever
 * `enabled` says — its `enabled` gates only the deck's four owned fetches. A
 * reader that wants the numbers and nothing else (the title-bar badge, which
 * is mounted in every window for the whole session) would pay that poll and
 * drag the deck's modules into the main bundle for a figure it already has.
 *
 * So the counts are their own hook, and the roster builds on it rather than
 * beside it: `useDecisionCountsCore` is the ONE place the chip numbers are
 * assembled (`buildChipCounts` over the store's `pendingCounts`, the build
 * questions, the chat derivation and the undispatched-ideas list), and both
 * `useDecisionRoster` and `useDecisionCounts` call it. The two cannot disagree
 * because there is nothing for them to disagree with.
 *
 * Refresh discipline is the roster's: one `dev_tools_pending_counts` read in
 * flight app-wide (`pendingCountsSource`), and — new here — one undispatched-
 * ideas read in flight app-wide, so N mounted readers on the same coordinator
 * tick cost one IPC each, not N.
 */
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';

import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';

import type { ChipCount, HubChip } from '../model/decisionModel';
import { buildChipCounts, decisionTotal } from './chipCounts';
import {
  getPendingCountsStatus,
  refreshDecisionCounts,
  subscribePendingCountsStatus,
} from './pendingCountsSource';
import { useChatThreads } from './useChatThreads';
import { useDecisionCopy } from './useDecisionCopy';
import { useRosterRefresh } from './useRosterRefresh';

export interface DecisionCountsState {
  counts: Record<HubChip, ChipCount>;
  /** Sum of the seven decision chips (excludes `ready`). */
  total: number;
  /** No counts read has settled yet and the store holds none. */
  loading: boolean;
  /** Re-read the counts and the ready list now. Never rejects. */
  refreshCounts: () => void;
}

/** The chat term, derived by the caller (the roster derives it once for items too). */
export interface ChatCountInput {
  n: number;
  failed: boolean;
}

let readyInFlight: Promise<void> | null = null;

/** One undispatched-ideas read in flight app-wide. The slice never rejects. */
function refreshReady(read: () => Promise<void>): Promise<void> {
  if (readyInFlight) return readyInFlight;
  readyInFlight = read().finally(() => {
    readyInFlight = null;
  });
  return readyInFlight;
}

/** Test hatch — module state must not leak between tests. */
export function resetDecisionCountsSource(): void {
  readyInFlight = null;
}

/**
 * The counts, assembled. Building block for the roster and for
 * {@link useDecisionCounts}; it schedules nothing by itself.
 */
export function useDecisionCountsCore(chat: ChatCountInput, enabled: boolean): DecisionCountsState {
  const pending = useSystemStore((s) => s.pendingCounts);
  const countsStatus = useSyncExternalStore(subscribePendingCountsStatus, getPendingCountsStatus);
  const undispatched = useSystemStore((s) => s.undispatchedIdeas);
  const refreshUndispatched = useSystemStore((s) => s.refreshUndispatchedIdeas);
  const [readySettled, setReadySettled] = useState(false);
  // The title-bar tray's own definition: a halted CLI's questions live in
  // `buildSessions` state and have no row anywhere to count.
  const questionCount = useAgentStore((s) => {
    let n = 0;
    for (const sess of Object.values(s.buildSessions)) {
      if (sess.phase === 'awaiting_input') n += sess.pendingQuestions.length;
    }
    return n;
  });

  const counts = useMemo(
    () =>
      buildChipCounts({
        pending,
        pendingFailed: countsStatus.failed,
        questions: questionCount,
        chat: { n: chat.n, failed: chat.failed },
        // The slice keeps `null` until a read lands and swallows failures, so
        // "settled and still null" is the only failure it lets anyone see.
        ready: { n: undispatched?.length ?? null, failed: readySettled && undispatched === null },
      }),
    [pending, countsStatus.failed, questionCount, chat.n, chat.failed, undispatched, readySettled],
  );

  const refreshCounts = useCallback(() => {
    void refreshDecisionCounts();
    void refreshReady(refreshUndispatched).finally(() => setReadySettled(true));
  }, [refreshUndispatched]);

  const loading = enabled && !countsStatus.settled && pending === null;

  return useMemo(
    () => ({ counts, total: decisionTotal(counts), loading, refreshCounts }),
    [counts, loading, refreshCounts],
  );
}

const NO_ITEMS = (): void => undefined;

/**
 * Counts only — no item source is mounted, no triage machinery, no review
 * list. Polls on the roster's own 30 s coordinator ticker and re-reads on the
 * roster's push events, so a mounted counts reader keeps the numbers fresh
 * for every other reader of `pendingCounts` too.
 */
export function useDecisionCounts(options: { enabled?: boolean } = {}): DecisionCountsState {
  const enabled = options.enabled ?? true;
  const copy = useDecisionCopy();
  // `false`: count what the channel slices already hold, subscribe nothing.
  const chat = useChatThreads(false, copy);
  const state = useDecisionCountsCore({ n: chat.count, failed: chat.failed }, enabled);
  useRosterRefresh({
    enabled,
    itemsActive: false,
    onCounts: state.refreshCounts,
    onItems: NO_ITEMS,
  });
  return state;
}
