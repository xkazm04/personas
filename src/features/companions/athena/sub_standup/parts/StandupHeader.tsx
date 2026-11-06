import { memo, type ReactNode } from 'react';

import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { useTranslation } from '@/i18n/useTranslation';
import { AthenaAvatar } from '../../AthenaAvatar';
import { clockLabel } from '../model/timeAxis';
import type { SinceLast, StandupView } from '../model/types';
import { Meter } from './Meter';
import { Figs } from './prims';

type T = ReturnType<typeof useTranslation>;

/** Athena's one sentence about the standup, in the header bar. */
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

/** `rev 2 · draft` / `rev 2 · armed 17:20` in the mono face, lower case like a build tag. */
function revLabel(view: StandupView, { t, tx }: T): string {
  const s = t.athena.standup.rev;
  const rev = tx(s.number, { n: view.revision }).toLowerCase();
  if (view.status === 'draft') return `${rev} · ${s.draft}`;
  if (view.status === 'armed') return `${rev} · ${tx(s.armed, { time: clockLabel(view.past.to) })}`;
  return `${rev} · ${s.ended}`;
}

/** The return report as one status line: a mono `since 06:00` stamp, then the figures in prose. */
function SinceLine({ since }: { since: SinceLast }) {
  const { t, tx } = useTranslation();
  const k = t.athena.standup.console;
  const parts = [tx(k.since_body, { moved: since.moved, p: since.projects, parked: since.parked })];
  if (since.running > 0) parts.push(tx(k.since_running, { n: since.running }));
  if (since.created.length > 0) parts.push(tx(t.athena.standup.since.created, { names: since.created.join(', ') }));
  return (
    <p className="sc-since" aria-label={t.athena.standup.since.label}>
      <span className="sc-since__stamp">
        {k.since_lead} {clockLabel(since.sinceMs)}
      </span>
      <span className="sc-since__body"><Figs text={parts.join(' · ')} /></span>
    </p>
  );
}

/** ONE instrument bar: identity | Athena's sentence | the plan meter | presses + the DEV fixture switch. */
export const StandupHeader = memo(function StandupHeader({ view, proposing, actions }: { view: StandupView; proposing: boolean; actions: ReactNode }) {
  const tr = useTranslation();
  const s = tr.t.athena.standup;
  const busy = proposing || view.counts.running > 0;
  return (
    <header className="sc-head">
      <div className="sc-head__bar">
        <div className="sc-id">
          <h2 className="sc-title">{s.title}</h2>
          {view.life !== 'none' && <span className="sc-rev">{revLabel(view, tr)}</span>}
          <span className="sc-meta">
            <AbsoluteTime timestamp={view.nowMs} variant="date" showRelativeTooltip={false} />
            {view.revision > 1 && <span className="sc-wide">{` · ${tr.tx(s.amends, { n: view.revision - 1 })}`}</span>}
          </span>
        </div>
        <div className="sc-voice">
          <AthenaAvatar state={busy ? 'thinking' : 'idle'} size={28} />
          <span className="sc-say"><Figs text={sentence(view, proposing, tr)} /></span>
        </div>
        {view.life !== 'none' && <Meter counts={view.counts} />}
        <div className="sc-head__actions">{actions}</div>
      </div>
      {view.sinceLast && <SinceLine since={view.sinceLast} />}
    </header>
  );
});
