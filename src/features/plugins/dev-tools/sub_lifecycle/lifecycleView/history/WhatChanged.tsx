/**
 * "What changed", in one sentence built from data: the move between the
 * picked Measure (the newest one for now) and the one before it - verdicts
 * that changed, then coverage, pass rates and times that moved - each part in
 * the ink of whether it was good or bad (and in words, so it reads without
 * colour). The moves come from the rail's own delta helper through
 * `historyModel.whatChanged`, and the words from `changeText` (shared with the
 * Measure panel's summary), so this line, the summary and the cards agree.
 *
 * The parts are joined by the locale's own list format. One line; it clips
 * rather than wraps, so the figure under it never moves.
 */
import type { ReactNode } from 'react';
import { GitCompareArrows } from 'lucide-react';

import { useLifecycleViewModel } from '../context';
import { LT } from '../system/lcType';
import { GLYPH } from '../system/scales';
import { ChangeParts } from './changeText';
import type { ChangeFragment } from './historyModel';

/** `fragments` null: there is no earlier Measure to compare with. */
export function WhatChanged({ fragments, viewing }: { fragments: ChangeFragment[] | null; viewing: boolean }) {
  const { dl } = useLifecycleViewModel();
  let body: ReactNode;
  if (fragments === null) body = dl.lcx3_changed_oldest;
  else if (fragments.length === 0) body = viewing ? dl.lcx3_changed_none_viewed : dl.lcx3_changed_none;
  else body = <>{viewing ? dl.lcx3_changed_lead_viewed : dl.lcx3_changed_lead}{' '}<ChangeParts fragments={fragments} /></>;
  return (
    <p className={`flex h-7 min-w-0 items-center gap-2 ${LT.row}`} data-testid="lc-history-changed" aria-live="polite">
      <GitCompareArrows className={`${GLYPH.sm} shrink-0 text-primary`} aria-hidden />
      <span className="min-w-0 truncate">{body}</span>
    </p>
  );
}
