import type { ReactNode } from 'react';

import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { useTranslation } from '@/i18n/useTranslation';
import { AthenaAvatar } from '../../../AthenaAvatar';
import { clockLabel } from '../../model/timeAxis';
import type { StandupView } from '../../model/types';
import { BRIEFING } from './copy';
import { Lead } from './Lead';

/** "rev 2 · draft" / "rev 2 · armed 17:20" / "rev 2 · ended". */
function useRevLabel(view: StandupView): string {
  const { t, tx } = useTranslation();
  const s = t.athena.standup.rev;
  const rev = tx(s.number, { n: view.revision });
  if (view.status === 'draft') return `${rev} · ${s.draft}`;
  if (view.status === 'armed') return `${rev} · ${tx(s.armed, { time: clockLabel(view.past.to) })}`;
  return `${rev} · ${s.ended}`;
}

/**
 * The memo's head: one title line (title, revision, date and time), the
 * presses at the right, then Athena's opening paragraph beside her orb.
 */
export function Masthead({ view, proposing, actions }: { view: StandupView; proposing: boolean; actions: ReactNode }) {
  const { t, tx } = useTranslation();
  const rev = useRevLabel(view);
  const busy = proposing || view.counts.running > 0;
  return (
    <header className="sb-mast">
      <div className="sb-mast__row">
        <h2 className="typo-heading-lg text-foreground">{t.athena.standup.title}</h2>
        {view.life !== 'none' && <span className={`sb-rev typo-label sb-rev--${view.status}`}>{rev}</span>}
        <span className="typo-caption sb-mast__date">
          <AbsoluteTime timestamp={view.nowMs} variant="date" showRelativeTooltip={false} />
          {' '}{tx(BRIEFING.masthead.clock, { time: clockLabel(view.nowMs) })}
        </span>
        <div className="sb-mast__actions">{actions}</div>
      </div>
      <div className="sb-voice">
        <AthenaAvatar state={busy ? 'thinking' : 'idle'} size={36} />
        <Lead view={view} proposing={proposing} />
      </div>
    </header>
  );
}
