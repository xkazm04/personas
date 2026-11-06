import { memo, type ReactNode } from 'react';

import { UnitStrip } from '@/features/shared/components/kit';
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { useTranslation } from '@/i18n/useTranslation';
import { AthenaAvatar } from '../../AthenaAvatar';
import { clockLabel } from '../model/timeAxis';
import type { Counts, StandupView } from '../model/types';
import { Kbd } from './Kbd';

/** Five tallies, each a count drawn as units (B/1's pips): waits / proposed / decided / running / refused. */
function Tallies({ counts, life }: { counts: Counts; life: StandupView['life'] }) {
  const { t } = useTranslation();
  const s = t.athena.standup.tally;
  const one = (n: number, label: string, tone: 'error' | 'warning' | 'primary' | 'success' | 'neutral', glyph: 'solid' | 'hollow', note?: string) => (
    <div className="su-tally__one">
      <span className="typo-caption"><span className="typo-data text-foreground">{n}</span> {label}</span>
      {n > 0 || !note
        ? <UnitStrip segments={[{ n, tone, glyph }]} size="m" label={`${n} ${label}`} />
        : <span className="typo-caption">{note}</span>}
    </div>
  );
  return (
    <div className="su-tally">
      {one(counts.waits, s.waits, 'error', 'solid')}
      {one(counts.proposed, s.proposed, 'warning', 'hollow')}
      {one(counts.decided, s.decided, 'primary', 'solid')}
      {one(counts.running, s.running, 'success', 'solid', life === 'decide' ? s.running_none_draft : s.running_none_armed)}
      {one(counts.refused, s.refused, 'neutral', 'hollow')}
    </div>
  );
}

/** Athena's one line about the standup, beside her orb (the page's half of her two surfaces). */
function Voice({ view, proposing }: { view: StandupView; proposing: boolean }) {
  const { t, tx } = useTranslation();
  const v = t.athena.standup.voice;
  const c = view.counts;
  let head: ReactNode;
  let sub: ReactNode;
  if (view.life === 'none') { head = v.none; sub = v.none_sub; }
  else if (proposing) { head = v.proposing; sub = v.proposing_sub; }
  else if (view.life === 'decide' && c.proposed > 0) { head = tx(v.decide, { n: c.proposed, w: c.waits }); sub = v.decide_sub; }
  else if (view.life === 'decide' && view.rows.length === 0) { head = v.nothing; sub = v.nothing_sub; }
  else if (view.life === 'decide') { head = v.all_decided; sub = <>{v.all_decided_sub} <Kbd>G</Kbd></>; }
  else if (view.life === 'return' && view.sinceLast) { head = tx(v.return, { m: view.sinceLast.moved, p: view.sinceLast.projects }); sub = tx(v.return_sub, { w: c.waits }); }
  else if (view.life === 'ended') { head = v.ended; sub = v.ended_sub; }
  else { head = tx(v.armed, { r: c.running, d: c.decided }); sub = tx(v.armed_sub, { w: c.waits }); }
  const busy = proposing || c.running > 0;
  return (
    <div className="su-orb">
      <AthenaAvatar state={busy ? 'thinking' : 'idle'} size={44} />
      <div className="min-w-0">
        <p className="typo-body k-strong text-foreground">{head}</p>
        <p className="typo-caption">{sub}</p>
      </div>
    </div>
  );
}

function revLabel(view: StandupView, t: ReturnType<typeof useTranslation>['t'], tx: ReturnType<typeof useTranslation>['tx']): string {
  const s = t.athena.standup.rev;
  const rev = tx(s.number, { n: view.revision });
  if (view.status === 'draft') return `${rev} · ${s.draft}`;
  if (view.status === 'armed') return `${rev} · ${tx(s.armed, { time: clockLabel(view.past.to) })}`;
  return `${rev} · ${s.ended}`;
}

/** The B/1 header strip: title + revision (+ the presses under it), then the five tallies over Athena's line. */
export const StandupHeader = memo(function StandupHeader({ view, proposing, actions }: { view: StandupView; proposing: boolean; actions?: ReactNode }) {
  const { t, tx } = useTranslation();
  const s = t.athena.standup;
  return (
    <header className="su-head">
      <div className="su-title">
        <div className="su-title__row">
          <h2 className="typo-heading-lg text-foreground">{s.title}</h2>
          {view.life !== 'none' && <span className="su-chip typo-label text-foreground">{revLabel(view, t, tx)}</span>}
        </div>
        <p className="typo-caption">
          <AbsoluteTime timestamp={view.nowMs} variant="date" showRelativeTooltip={false} />
          {view.revision > 1 && ` · ${tx(s.amends, { n: view.revision - 1 })}`}
        </p>
        {actions && <div className="flex flex-wrap items-center gap-2 mt-1">{actions}</div>}
      </div>
      <div className="su-head__main">
        {view.life !== 'none' && <Tallies counts={view.counts} life={view.life} />}
        <Voice view={view} proposing={proposing} />
      </div>
    </header>
  );
});
