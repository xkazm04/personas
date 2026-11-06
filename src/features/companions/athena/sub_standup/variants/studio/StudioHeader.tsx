import { memo, type ReactNode } from 'react';
import { History } from 'lucide-react';

import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { useTranslation } from '@/i18n/useTranslation';
import { AthenaAvatar } from '../../../AthenaAvatar';
import { clockLabel } from '../../model/timeAxis';
import type { SinceLast, StandupView } from '../../model/types';
import { fill, STUDIO_COPY } from './copy';
import { PlanMeter } from './PlanMeter';

type T = ReturnType<typeof useTranslation>;

/** Athena's one sentence about the standup. */
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

/** rev N as a mono figure + the status as a dot and a word. */
function RevBadge({ view }: { view: StandupView }) {
  const { t, tx } = useTranslation();
  const s = t.athena.standup.rev;
  const status = view.status === 'draft' ? s.draft : view.status === 'armed' ? tx(s.armed, { time: clockLabel(view.past.to) }) : s.ended;
  return (
    <span className={`ss-rev ss-rev--${view.status}`}>
      <span className="ss-rev__n">{tx(s.number, { n: view.revision })}</span>
      <span className="ss-rev__dot" aria-hidden="true" />
      <span>{status}</span>
    </span>
  );
}

/** The return life's report as the second line of Athena's speech. */
function SinceLine({ since }: { since: SinceLast }) {
  const { t, tx } = useTranslation();
  const parts = [fill(STUDIO_COPY.since_body, { moved: since.moved, p: since.projects, parked: since.parked })];
  if (since.running > 0) parts.push(fill(STUDIO_COPY.since_running, { n: since.running }));
  if (since.created.length > 0) parts.push(tx(t.athena.standup.since.created, { names: since.created.join(', ') }));
  return (
    <span className="ss-since" aria-label={t.athena.standup.since.label}>
      <History className="ss-since__icon" aria-hidden="true" />
      <span className="ss-since__at"><AbsoluteTime timestamp={since.sinceMs} variant="time" /></span>
      <span>{parts.join(' · ')}</span>
    </span>
  );
}

/** A floating panel: title + rev + date | Athena in a speech surface | the meter | the presses. */
export const StudioHeader = memo(function StudioHeader({ view, proposing, actions }: { view: StandupView; proposing: boolean; actions: ReactNode }) {
  const tr = useTranslation();
  const s = tr.t.athena.standup;
  const busy = proposing || view.counts.running > 0;
  return (
    <header className="ss-head">
      <div className="ss-head__title">
        <h2 className="ss-title">{s.title}</h2>
        <span className="ss-head__meta">
          {view.life !== 'none' && <RevBadge view={view} />}
          <span className="ss-date">
            <AbsoluteTime timestamp={view.nowMs} variant="date" showRelativeTooltip={false} />
            {view.revision > 1 && <span className="ss-wide">{` · ${tr.tx(s.amends, { n: view.revision - 1 })}`}</span>}
          </span>
        </span>
      </div>
      <div className="ss-voice">
        <AthenaAvatar state={busy ? 'thinking' : 'idle'} size={32} />
        <div className="ss-bubble">
          <span className="ss-bubble__say">{sentence(view, proposing, tr)}</span>
          {view.sinceLast && <SinceLine since={view.sinceLast} />}
        </div>
      </div>
      {view.life !== 'none' && <div className="ss-head__meter"><PlanMeter counts={view.counts} /></div>}
      <div className="ss-head__actions">{actions}</div>
    </header>
  );
});
