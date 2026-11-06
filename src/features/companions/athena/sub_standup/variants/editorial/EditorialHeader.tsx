import { memo, type ReactNode } from 'react';

import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { useTranslation } from '@/i18n/useTranslation';
import { AthenaAvatar } from '../../../AthenaAvatar';
import { clockLabel } from '../../model/timeAxis';
import type { SinceLast, StandupView } from '../../model/types';
import { ED_COPY, fill } from './copy';
import { PlanMeter } from './PlanMeter';

type T = ReturnType<typeof useTranslation>;

/** Athena's one sentence about the standup (the head of the baseline's two-line voice). */
function sentence(view: StandupView, proposing: boolean, { t, tx }: T): string {
  const v = t.athena.standup.voice;
  const c = view.counts;
  if (view.life === 'none') return v.none;
  if (proposing) return v.proposing;
  if (view.life === 'decide' && c.proposed > 0) return tx(v.decide, { n: c.proposed, w: c.waits });
  if (view.life === 'decide' && view.rows.length === 0) return v.nothing;
  if (view.life === 'decide') return v.all_decided;
  if (view.life === 'return' && view.sinceLast) return tx(v.return, { m: view.sinceLast.moved, p: view.sinceLast.projects });
  if (view.life === 'ended') return v.ended;
  return tx(v.armed, { r: c.running, d: c.decided });
}

/** The revision's status, the second half of the masthead's dateline (the number sits by the title). */
function statusLabel(view: StandupView, { t, tx }: T): string {
  const s = t.athena.standup.rev;
  if (view.status === 'draft') return s.draft;
  if (view.status === 'armed') return tx(s.armed, { time: clockLabel(view.past.to) });
  return s.ended;
}

/** The report of the return life as a standfirst under Athena's sentence. */
function SinceLine({ since }: { since: SinceLast }) {
  const { t, tx } = useTranslation();
  const parts = [fill(ED_COPY.since_body, { moved: since.moved, p: since.projects, parked: since.parked })];
  if (since.running > 0) parts.push(fill(ED_COPY.since_running, { n: since.running }));
  if (since.created.length > 0) parts.push(tx(t.athena.standup.since.created, { names: since.created.join(', ') }));
  return (
    <p className="se-since se-body se-clamp1" aria-label={t.athena.standup.since.label}>
      <span className="se-sc">{ED_COPY.since_lead} <AbsoluteTime timestamp={since.sinceMs} variant="time" /></span>
      {parts.join(' · ')}
    </p>
  );
}

/**
 * The masthead: the title hangs on the project column with the date and revision under it in
 * small caps; Athena's sentence in serif italic (and the since standfirst) runs from the Today
 * column; the presses and the plan fraction close the line on the right.
 */
export const EditorialHeader = memo(function EditorialHeader({ view, proposing, actions }: { view: StandupView; proposing: boolean; actions: ReactNode }) {
  const tr = useTranslation();
  const s = tr.t.athena.standup;
  const busy = proposing || view.counts.running > 0;
  return (
    <header className="se-head">
      <div className="se-head__title">
        <span className="se-title-line">
          <h2 className="se-title se-serif">{s.title}</h2>
          {view.life !== 'none' && <span className="se-sc se-rev">{tr.tx(s.rev.number, { n: view.revision })}</span>}
        </span>
        <span className="se-sc se-clamp1">
          <AbsoluteTime timestamp={view.nowMs} variant="date" showRelativeTooltip={false} />
          {view.life !== 'none' && ` · ${statusLabel(view, tr)}`}
        </span>
      </div>
      <div className="se-head__voice">
        <AthenaAvatar state={busy ? 'thinking' : 'idle'} size={30} />
        <span className="se-head__say">
          <span className="se-lede se-serif">{sentence(view, proposing, tr)}</span>
          {view.sinceLast
            ? <SinceLine since={view.sinceLast} />
            : view.revision > 1 && <span className="se-body se-wide">{tr.tx(s.amends, { n: view.revision - 1 })}</span>}
        </span>
      </div>
      <div className="se-head__actions">{actions}</div>
      {view.life !== 'none' && <PlanMeter counts={view.counts} />}
    </header>
  );
});
