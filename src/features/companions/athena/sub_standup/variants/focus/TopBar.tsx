import type { ReactNode } from 'react';

import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { useTranslation } from '@/i18n/useTranslation';
import { AthenaAvatar } from '../../../AthenaAvatar';
import { clockLabel } from '../../model/timeAxis';
import type { StandupView } from '../../model/types';
import { FOCUS_COPY as F } from './copy';
import type { Progress } from './model';

type T = ReturnType<typeof useTranslation>;

function revLabel(view: StandupView, { t, tx }: T): string {
  const s = t.athena.standup.rev;
  const rev = tx(s.number, { n: view.revision });
  if (view.status === 'draft') return `${rev} · ${s.draft}`;
  if (view.status === 'armed') return `${rev} · ${tx(s.armed, { time: clockLabel(view.past.to) })}`;
  return `${rev} · ${s.ended}`;
}

/** Athena's one line over the queue, counted from the same progress the bar draws. */
function voice(view: StandupView, proposing: boolean, p: Progress, { t, tx }: T): [string, string] {
  const v = t.athena.standup.voice;
  const w = view.counts.waits;
  if (view.life === 'none') return [v.none, v.none_sub];
  if (proposing) return [v.proposing, v.proposing_sub];
  if (view.life === 'decide' && view.rows.length === 0) return [v.nothing, v.nothing_sub];
  if (view.life === 'decide' && p.open > 0) return [tx(v.decide, { n: p.open, w }), v.decide_sub];
  if (view.life === 'decide') return [v.all_decided, `${v.all_decided_sub} G`];
  if (view.life === 'return' && view.sinceLast) {
    return [tx(v.return, { m: view.sinceLast.moved, p: view.sinceLast.projects }), w > 0 ? tx(v.return_sub, { w }) : F.return_sub_none];
  }
  if (view.life === 'ended') return [v.ended, v.ended_sub];
  return [tx(v.armed, { r: view.counts.running, d: view.counts.decided }), w > 0 ? tx(v.armed_sub, { w }) : F.armed_sub_none];
}

interface Props {
  view: StandupView;
  proposing: boolean;
  progress: Progress;
  /** Propose + the DEV fixture switch. */
  actions: ReactNode;
  /** The progress figure and the go-gate. */
  gate: ReactNode;
}

/**
 * The top bar, two lines: who and when (title, revision, date) with the
 * page's presses, then Athena's sentence with the progress and the go-gate
 * on the same line, because arming is what the progress leads to.
 */
export function TopBar({ view, proposing, progress, actions, gate }: Props) {
  const tr = useTranslation();
  const s = tr.t.athena.standup;
  const [head, sub] = voice(view, proposing, progress, tr);
  return (
    <header className="sf-top">
      <div className="sf-top__row">
        <div className="sf-top__title">
          <h2 className="typo-heading-lg text-foreground">{s.title}</h2>
          {view.life !== 'none' && <span className="sf-chip typo-label text-foreground">{revLabel(view, tr)}</span>}
          <span className="typo-caption">
            <AbsoluteTime timestamp={view.nowMs} variant="date" showRelativeTooltip={false} />
            {view.revision > 1 && <span className="sf-wide">{` · ${tr.tx(s.amends, { n: view.revision - 1 })}`}</span>}
          </span>
        </div>
        <div className="sf-top__actions">{actions}</div>
      </div>
      <div className="sf-top__row sf-top__row--voice">
        <div className="sf-voice">
          <AthenaAvatar state={proposing || view.counts.running > 0 ? 'thinking' : 'idle'} size={36} />
          <div className="min-w-0">
            <p className="typo-body k-strong text-foreground">{head}</p>
            <p className="typo-caption">{sub}</p>
          </div>
        </div>
        {view.life !== 'none' && gate}
      </div>
    </header>
  );
}
