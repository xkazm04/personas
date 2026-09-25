// The cap, drawn as the rack itself. One bay per slot the cap allows: a lit
// bay is a session holding that seat (its lamp is the session's state), a
// dashed bay is a free seat, and bays past the cap line are hatched in the
// warning tone, hanging outside the rack the way over-admitted work does.
// The queue waits beyond the rack as dashed ticks. The stepper moves the cap
// line itself, so raising it visibly opens a new empty bay.

import { Minus, Plus } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Button } from '@/features/shared/components/buttons';
import { sessionLabel, sessionStateMeta } from '../../fleetSessionModel';
import type { ActivitySurface } from '../useActivitySurface';
import type { useCapSetting } from '../shared';
import { holdsSeat, seat, sessionLamp, useRoom } from './rackModel';

const MAX_TICKS = 8;

export function RackGauge({ surface, cap }: {
  surface: ActivitySurface;
  cap: ReturnType<typeof useCapSetting>;
}) {
  const { t, tx } = useTranslation();
  const s = t.monitor;
  const { hot, setHot, openSession } = useRoom();
  const running = surface.queueModel.running.filter((it) => holdsSeat(it.session.state));
  const queued = surface.queueOrder.items;
  const inFlight = surface.sessionsInFlight;
  const over = Math.max(surface.overAdmitted, inFlight - cap.cap, 0);
  const bays = Math.max(cap.cap, running.length);
  const hint = over > 0
    ? tx(s.queue_cap_over_hint, { running: inFlight, cap: cap.cap, over })
    : tx(s.queue_cap_hint, { running: inFlight, cap: cap.cap });

  const cells = [];
  for (let i = 0; i < bays; i += 1) {
    if (i === cap.cap && i > 0) cells.push(<span key="cap" className="ed-capline" aria-hidden />);
    const item = running[i];
    const isOver = i >= cap.cap;
    const tip = item
      ? `${seat(i + 1)} · ${sessionLabel(item.session)} · ${t.plugins.fleet[sessionStateMeta(item.session.state).labelKey]}${item.projectLabel ? ` · ${item.projectLabel}` : ''}`
      : `${seat(i + 1)} · ${s.queue_slot_free}`;
    cells.push(
      <Tooltip key={item?.sessionId ?? `free-${i}`} content={isOver ? `${tip}\n${s.queue_over_admitted}` : tip} delay={150}>
        {item ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={tip}
            onClick={() => openSession(item.session)}
            onMouseEnter={() => setHot(item.sessionId)}
            onMouseLeave={() => setHot(null)}
            data-lamp={sessionLamp(item.session.state)}
            data-over={isOver || undefined}
            data-hot={hot === item.sessionId || undefined}
            data-testid="entry-d-bay"
            className="ed-bay rounded-input"
          />
        ) : (
          <span role="img" aria-label={tip} data-lamp="free" data-testid="fleet-queue-free-slot" className="ed-bay rounded-input" />
        )}
      </Tooltip>,
    );
  }
  if (over === 0) cells.push(<span key="cap-end" className="ed-capline" data-quiet="true" aria-hidden />);

  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-2"
      role="group"
      aria-label={s.queue_cap_aria}
      data-testid="fleet-max-parallel"
      data-over={over > 0 || undefined}
    >
      <Button variant="ghost" size="icon-sm" aria-label={s.queue_cap_decrease} disabled={!cap.canDecrease} onClick={cap.decrease}
        icon={<Minus className="h-3.5 w-3.5" aria-hidden />} />
      <Tooltip content={hint}>
        <span
          className={`flex-shrink-0 typo-data-lg tabular-nums ${over > 0 ? 'text-status-warning' : 'text-foreground'}`}
          data-testid="fleet-max-parallel-readout"
        >
          {inFlight}<span className="typo-data text-foreground"> / {cap.cap}</span>
        </span>
      </Tooltip>
      <Button variant="ghost" size="icon-sm" aria-label={s.queue_cap_increase} disabled={!cap.canIncrease} onClick={cap.increase}
        icon={<Plus className="h-3.5 w-3.5" aria-hidden />} />
      <div className="ed-bays ml-1" style={{ gap: bays > 24 ? 1 : 3 }}>{cells}</div>
      {queued.length > 0 && (
        <Tooltip content={`${s.queue_band_queued} ${queued.length}`}>
          <span className="flex flex-shrink-0 items-center gap-1" data-testid="entry-d-queue-ticks">
            {queued.slice(0, MAX_TICKS).map((q) => <span key={q.sessionId} className="ed-qtick rounded-input" aria-hidden />)}
            <span className="typo-caption tabular-nums">{queued.length > MAX_TICKS ? `+${queued.length - MAX_TICKS}` : queued.length}</span>
          </span>
        </Tooltip>
      )}
    </div>
  );
}
