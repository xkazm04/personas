import { memo, type ReactNode } from 'react';

import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { useTranslation } from '@/i18n/useTranslation';
import { AthenaAvatar } from '../../../AthenaAvatar';
import { clockLabel } from '../../model/timeAxis';
import type { SinceLast, StandupView } from '../../model/types';
import { fill, LEDGER_COPY } from './copy';
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

function revLabel(view: StandupView, { t, tx }: T): string {
  const s = t.athena.standup.rev;
  const rev = tx(s.number, { n: view.revision });
  if (view.status === 'draft') return `${rev} · ${s.draft}`;
  if (view.status === 'armed') return `${rev} · ${tx(s.armed, { time: clockLabel(view.past.to) })}`;
  return `${rev} · ${s.ended}`;
}

/** The report of the return life as one quiet line, not a band. */
function SinceLine({ since }: { since: SinceLast }) {
  const { t, tx } = useTranslation();
  const parts = [fill(LEDGER_COPY.since_body, { moved: since.moved, p: since.projects, parked: since.parked })];
  if (since.running > 0) parts.push(fill(LEDGER_COPY.since_running, { n: since.running }));
  if (since.created.length > 0) parts.push(tx(t.athena.standup.since.created, { names: since.created.join(', ') }));
  return (
    <p className="sl-since typo-caption" aria-label={t.athena.standup.since.label}>
      {LEDGER_COPY.since_lead} <AbsoluteTime timestamp={since.sinceMs} variant="time" />: <span className="text-foreground">{parts.join(' · ')}</span>
    </p>
  );
}

/** ONE bar: title + rev + date | Athena's sentence + the plan meter | presses + the DEV fixture switch. */
export const LedgerHeader = memo(function LedgerHeader({ view, proposing, actions }: { view: StandupView; proposing: boolean; actions: ReactNode }) {
  const tr = useTranslation();
  const s = tr.t.athena.standup;
  const busy = proposing || view.counts.running > 0;
  return (
    <header className="sl-head">
      <div className="sl-head__bar">
        <div className="sl-head__title">
          <h2 className="typo-heading-lg text-foreground">{s.title}</h2>
          {view.life !== 'none' && <span className="sl-rev typo-label text-foreground">{revLabel(view, tr)}</span>}
          <span className="typo-caption">
            <AbsoluteTime timestamp={view.nowMs} variant="date" showRelativeTooltip={false} />
            {view.revision > 1 && <span className="sl-wide">{` · ${tr.tx(s.amends, { n: view.revision - 1 })}`}</span>}
          </span>
        </div>
        <div className="sl-head__voice">
          <AthenaAvatar state={busy ? 'thinking' : 'idle'} size={32} />
          <span className="sl-head__say">
            <span className="typo-body k-strong text-foreground">{sentence(view, proposing, tr)}</span>
            {view.life !== 'none' && <PlanMeter counts={view.counts} />}
          </span>
        </div>
        <div className="sl-head__actions">{actions}</div>
      </div>
      {view.sinceLast && <SinceLine since={view.sinceLast} />}
    </header>
  );
});
