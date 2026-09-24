// Focus → layer. `contest/focus.ts` is written from outside this shell (the
// live "ready for review" notice, the setup form, a refine verdict, another
// shell). Every NEW focus (a `focusSeq` this shell has not handled) puts the
// contest on the track and, when it is ready for review, opens the photo
// finish on it. The shell's own roster picks are marked handled at once, so a
// pick only moves the track.
import { useCallback, useEffect, useState } from 'react';

import type { ContestSummary } from '@/lib/bindings/ContestSummary';

import { focusContest, sameContest, useContestFocus, type ContestKey } from '../../focus';
import { relevantLayer } from './arenaModel';

/** Sentinel review key: "open the photo finish on its first variant". */
export const OPEN_FIRST_VARIANT = '*';

/** The last focusSeq the Arena turned into a layer. Module-scoped so a
 *  remount does not replay a focus it already handled, while a notice that
 *  fired before the shell mounted is still honoured. */
let handledSeq = 0;

export function __resetArenaFocusForTests(): void {
  handledSeq = 0;
}

interface LayerState {
  seq: number;
  reviewKey: string | null;
}

export function useArenaFocus(contests: readonly ContestSummary[]) {
  const focused = useContestFocus((s) => s.focused);
  const focusSeq = useContestFocus((s) => s.focusSeq);
  const [layer, setLayer] = useState<LayerState>(() => ({ seq: handledSeq, reviewKey: null }));

  // Adjust-state-on-prop-change: a new focus whose summary is known picks
  // its layer. An unknown summary waits for the list (no guessing).
  let current = layer;
  if (focusSeq !== layer.seq && focused) {
    const summary = contests.find((c) => sameContest(focused, { projectId: c.projectId, contestId: c.contestId }));
    if (summary) {
      current = {
        seq: focusSeq,
        reviewKey: relevantLayer(summary.phase) === 'review' ? OPEN_FIRST_VARIANT : null,
      };
      setLayer(current);
    }
  }

  useEffect(() => {
    handledSeq = Math.max(handledSeq, layer.seq);
  }, [layer.seq]);

  const pick = useCallback((key: ContestKey) => {
    focusContest(key);
    setLayer({ seq: useContestFocus.getState().focusSeq, reviewKey: null });
  }, []);

  const setReviewKey = useCallback((reviewKey: string | null) => {
    setLayer((l) => ({ ...l, reviewKey }));
  }, []);

  return { focused, reviewKey: current.reviewKey, setReviewKey, pick };
}
