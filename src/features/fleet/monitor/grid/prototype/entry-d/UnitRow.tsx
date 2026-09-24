// A live session is a unit mounted in the rack. Its plate carries the SEAT it
// holds (the same two digits the console gauge and the runway print), or its
// queue rank while it waits, or a dash when it holds no seat at all (stale,
// finished, hibernated: on the board, out of the rack). Hovering the row
// lights its bay in the console. The row opens the terminal; the plate opens
// the recap, so neither needs a button floating over the title.

import { memo, type KeyboardEvent } from 'react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useSessionFacts } from '../shared';
import type { QueueItem } from '../../board/queue/useQueueModel';
import { ageFrac, ageLabel, seat, sessionLamp, useRoom } from './rackModel';

export const UNIT_H = 52;

export function SeatPlate({ session, stateLabel }: { session: FleetSession; stateLabel: string }) {
  const { t, tx } = useTranslation();
  const { slotOf, rankOf, cap, recapSession } = useRoom();
  const slot = slotOf.get(session.id);
  const rank = rankOf.get(session.id);
  const over = slot !== undefined && cap > 0 && slot > cap;
  const text = slot !== undefined ? seat(slot) : rank !== undefined ? `Q${rank}` : '–';
  const where = over ? t.monitor.queue_over_admitted
    : rank !== undefined ? tx(t.monitor.queue_rank_aria, { rank })
      : slot !== undefined ? `${seat(slot)} / ${cap}` : stateLabel;
  const tip = `${where} · ${t.monitor.grid_session_recap_open}`;
  return (
    <Tooltip content={tip} delay={250}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); recapSession(session); }}
        aria-label={tip}
        className="ed-plate focus-ring rounded-input typo-data transition-colors hover:brightness-125"
        data-lamp={sessionLamp(session.state)}
        data-over={over || undefined}
        data-kind={rank !== undefined ? 'queue' : 'slot'}
        data-testid="fleet-grid-session-recap"
      >
        {text}
      </button>
    </Tooltip>
  );
}

export const UnitRow = memo(function UnitRow({
  session, item = null, now, height = UNIT_H,
}: {
  session: FleetSession;
  item?: QueueItem | null;
  now: number;
  height?: number;
}) {
  const facts = useSessionFacts()(session, item);
  const { hot, setHot, openSession, focusKey } = useRoom();
  const lamp = sessionLamp(session.state);
  const gone = session.state === 'exited';
  const open = () => { if (!gone) openSession(session); };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  };
  const Origin = facts.OriginIcon;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={onKey}
      onMouseEnter={() => setHot(session.id)}
      onMouseLeave={() => setHot(null)}
      aria-label={[facts.label, facts.stateLabel, facts.project, facts.originLabel].filter(Boolean).join(', ')}
      data-testid="fleet-grid-session"
      data-state={session.state}
      data-lamp={lamp}
      data-hot={hot === session.id || undefined}
      className={`ed-row ed-spill focus-ring flex w-full cursor-pointer items-center gap-2.5 px-3 ${
        focusKey === `s:${session.id}` ? 'ed-flash' : ''
      }`}
      style={{ height }}
    >
      <SeatPlate session={session} stateLabel={facts.stateLabel} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex-shrink-0 truncate typo-body text-foreground">{facts.label}</span>
        <span className="flex min-w-0 flex-shrink-0 items-center gap-1.5 typo-caption">
          <Origin className="h-3 w-3 flex-shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{facts.stateLabel} · {facts.originLabel}</span>
          <span className="ed-wait w-6 flex-shrink-0 rounded-full" aria-hidden>
            <span className="rounded-full" style={{ width: `${Math.round(ageFrac(facts.startedAt, now) * 100)}%` }} />
          </span>
          <span className="flex-shrink-0 tabular-nums">{ageLabel(facts.startedAt, now)}</span>
        </span>
      </div>
    </div>
  );
});
