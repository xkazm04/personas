// A live Claude session is a window of the same glass as a persona, with two
// differences that say "process, not agent": its lamp is the lifecycle state,
// and its foot carries an AGE LADDER - six rungs on a log scale - so the
// session forgotten for a week is visibly the long bar in the column.
//
// The body opens the terminal; the recap is a second, cheaper door beside it.

import { memo } from 'react';
import { ScanEye } from 'lucide-react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Button } from '@/features/shared/components/buttons';
import type { QueueItem } from '../../board/queue/useQueueModel';
import { useSessionFacts } from '../shared';
import { AGE_RUNG_COUNT, ageRungs, compactAge, sessionLamp, toneClass } from './tone';
import { Lamp, Segments } from './parts';

const STANDING_MS = 6 * 60 * 60 * 1000;

export const SessionWindow = memo(function SessionWindow({
  session, item = null, onOpen, onRecap, flash = false, over = false, now,
}: {
  session: FleetSession;
  item?: QueueItem | null;
  /** Absent for an exited session: its terminal is gone. */
  onOpen?: (s: FleetSession) => void;
  onRecap: (s: FleetSession) => void;
  flash?: boolean;
  /** A live session past the cap after Start now. */
  over?: boolean;
  now: number;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const f = useSessionFacts()(session, item);
  const lamp = sessionLamp(session.state);
  /** A fresh alarm glows; one standing for hours keeps only its lamp. */
  const fresh = now - f.lastActivity < STANDING_MS;
  const age = Math.max(0, now - f.startedAt);
  const Origin = f.OriginIcon;
  const summary = [
    f.label,
    `${f.stateLabel} · ${tx(m.node_symbol_origin, { origin: f.originLabel })}`,
    ...(f.project ? [tx(m.node_symbol_project, { name: f.project })] : []),
    tx(m.node_symbol_elapsed, { time: compactAge(age) }),
    ...(over ? [m.queue_over_admitted] : []),
  ].join('\n');

  const body = (
    <>
      <span className="flex min-w-0 items-start gap-2">
        <Lamp lamp={lamp} className="mt-[7px]" />
        <span className="ae-clamp2 min-w-0 flex-1 typo-body text-foreground">{f.label}</span>
      </span>
      <span className="flex min-w-0 items-center gap-2 pl-[18px] typo-caption">
        <Origin className="h-3 w-3 flex-shrink-0 text-foreground" aria-hidden />
        <span className="min-w-0 truncate text-foreground">{f.stateLabel}</span>
        <span className="ml-auto flex-shrink-0 tabular-nums text-foreground">{compactAge(age)}</span>
      </span>
      <Segments
        count={AGE_RUNG_COUNT}
        lit={ageRungs(age)}
        tone={lamp.lit ? lamp.tone : 'off'}
        thin
        className="mt-1 w-full pl-[18px] opacity-80"
      />
    </>
  );

  return (
    <div
      className={`ae-win group relative flex w-full min-w-0 rounded-input ${toneClass(lamp.tone)} ${lamp.lit && fresh ? 'is-lit' : ''} ${
        over ? 'is-over ae-hatch' : ''} ${flash ? 'is-flash' : ''}`}
      data-testid="fleet-grid-session"
      data-state={session.state}
    >
      <Tooltip content={<span className="whitespace-pre-line">{summary}</span>} placement="right">
        {onOpen ? (
          <Button
            variant="ghost"
            onClick={() => onOpen(session)}
            aria-label={summary.replace(/\n/g, ', ')}
            className="ae-focus min-w-0 flex-1 rounded-input px-2.5 py-1.5 text-left hover:bg-transparent [&>span]:flex [&>span]:w-full [&>span]:min-w-0 [&>span]:flex-col [&>span]:gap-0.5"
          >
            {body}
          </Button>
        ) : (
          <span role="img" aria-label={summary.replace(/\n/g, ', ')} className="flex min-w-0 flex-1 flex-col gap-0.5 px-2.5 py-1.5">
            {body}
          </span>
        )}
      </Tooltip>
      <Tooltip content={m.grid_session_recap_open}>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onRecap(session)}
          aria-label={m.grid_session_recap_open}
          data-testid="fleet-grid-session-recap"
          className="mr-1 mt-1 flex-shrink-0"
          icon={<ScanEye className="h-3.5 w-3.5" aria-hidden />}
        />
      </Tooltip>
    </div>
  );
});
