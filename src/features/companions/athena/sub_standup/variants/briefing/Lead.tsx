import type { ReactNode } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import { clockLabel } from '../../model/timeAxis';
import type { StandupView } from '../../model/types';
import { BRIEFING } from './copy';
import { joinList, rich } from './rich';

const L = BRIEFING.lead;

/** "Since 06:00, 10 commits moved on 2 of your projects and 5 asks parked for you." */
function sinceSentence(view: StandupView): ReactNode {
  const s = view.sinceLast;
  if (!s) return null;
  const parts: ReactNode[] = [s.moved > 0 ? rich(L.moved, { m: s.moved, p: s.projects }) : L.moved_none];
  if (s.parked > 0) parts.push(rich(L.parked, { a: s.parked }));
  if (s.created.length > 0) parts.push(rich(L.created, { names: s.created.join(', ') }));
  return <>{rich(L.since_open, { time: clockLabel(s.sinceMs) })} {joinList(parts)}.</>;
}

/** What is open now, and what arming does. */
function decideSentences(view: StandupView): ReactNode {
  const c = view.counts;
  // The since sentence already counted the parked asks; say them again only when it did not.
  const waits = view.sinceLast?.parked ? 0 : c.waits;
  const open = c.proposed > 0
    ? rich(waits > 0 ? L.open : L.open_no_waits, { n: c.proposed, w: waits })
    : rich(waits > 0 ? L.all_decided : L.all_decided_no_waits, { w: waits });
  return <>{open} {rich(L.arm, { d: view.plannedDirections, r: view.plannedRuns })}</>;
}

function armedSentence(view: StandupView): ReactNode {
  const c = view.counts;
  return rich(c.waits > 0 ? L.armed : L.armed_no_waits, { time: clockLabel(view.past.to), r: c.running, d: c.decided, w: c.waits });
}

/**
 * Athena's opening paragraph, written from the view: what moved since the last
 * standup, what is open now, and what happens when the plan is armed. In the
 * return life it becomes the since-last report. Real sentences, never chips.
 */
export function Lead({ view, proposing }: { view: StandupView; proposing: boolean }) {
  const { t } = useTranslation();
  const v = t.athena.standup.voice;
  let body: ReactNode;
  if (view.life === 'none') body = <>{v.none} {v.none_sub}</>;
  else if (view.life === 'ended') body = <>{v.ended} {v.ended_sub}</>;
  else if (proposing) body = <>{sinceSentence(view)} {L.proposing}</>;
  else if (view.life === 'decide') body = <>{sinceSentence(view)} {decideSentences(view)}</>;
  else if (view.life === 'return') body = <>{L.return_open} {sinceSentence(view)} {rich(L.return_status, { r: view.counts.running, d: view.counts.decided })} {L.return_next}</>;
  else body = <>{armedSentence(view)} {L.armed_next}</>;
  return <p className="sb-lead typo-body text-foreground" data-testid="briefing-lead">{body}</p>;
}
