// InstrumentLanes — three instrument columns (In flight / Queued / Parked),
// each under an annunciator header whose top edge carries the lane's hue.
// Parked keeps the last hour of finished work, as the baseline's LanesBoard.

import { useMemo, type ReactNode } from 'react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { buildQueueModel } from '../../board/queue/useQueueModel';
import type { ActivitySurface } from '../useActivitySurface';
import { InstrumentSessionCell } from './InstrumentSessionCell';
import { InstrumentQueueRow } from './InstrumentQueueRow';

const PARKED_WINDOW_MS = 60 * 60 * 1_000;
function isParked(s: FleetSession, now: number): boolean {
  if (s.state === 'hibernated' || s.state === 'finished') return true;
  return s.state === 'exited' && now - Number(s.lastActivityMs) <= PARKED_WINDOW_MS;
}

function Lane({ title, count, edge, testId, children }: {
  title: string; count: number; edge: string; testId: string; children: ReactNode;
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-interactive border border-primary/10 bg-foreground/[0.015]" data-testid={testId}>
      <header className="relative flex flex-shrink-0 items-baseline justify-between px-3 pb-2 pt-3">
        <span aria-hidden className={`absolute inset-x-0 top-0 h-0.5 rounded-pill ${edge}`} />
        <span className="typo-label uppercase tracking-wider text-foreground">{title}</span>
        <span className="typo-data tabular-nums text-foreground"><Numeric value={count} /></span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1.5 pb-2">{children}</div>
    </section>
  );
}

export function InstrumentLanes({
  surface, now, askStart, askCancel,
}: {
  surface: ActivitySurface;
  now: number;
  askStart: Parameters<typeof InstrumentQueueRow>[0]['onStart'];
  askCancel: Parameters<typeof InstrumentQueueRow>[0]['onCancel'];
}) {
  const { t } = useTranslation();
  const s = t.monitor;
  const { queueModel: model, queueOrder: order, focusKey, board } = surface;
  const sessions = board.sessionList;

  const running = useMemo(() => model.running.filter((i) => !isParked(i.session, Date.now())), [model.running]);
  const parked = useMemo(() => {
    const at = Date.now();
    const rows = sessions.filter((x) => isParked(x, at));
    return buildQueueModel(rows.map((x) => (x.state === 'exited' ? { ...x, state: 'finished' as const } : x)), null)
      .running.map((i) => ({ ...i, session: sessions.find((x) => x.id === i.sessionId) ?? i.session }))
      .sort((a, b) => Number(b.session.lastActivityMs) - Number(a.session.lastActivityMs));
  }, [sessions]);

  return (
    <div className="flex min-h-0 flex-1 gap-4 overflow-hidden px-5 pb-5 pt-4" data-testid="fleet-queue-lanes">
      <Lane title={s.queue_band_running} count={running.length} edge="bg-primary" testId="fleet-queue-lane-running">
        {running.map((item, i) => (
          <InstrumentSessionCell
            key={item.sessionId}
            session={item.session}
            item={item}
            now={now}
            showProject
            overAdmitted={model.cap > 0 && i >= model.cap}
            flash={focusKey === `s:${item.sessionId}`}
            onOpen={surface.setTerminal}
            onRecap={surface.setRecap}
          />
        ))}
      </Lane>
      <Lane title={s.queue_band_queued} count={order.items.length} edge="bg-foreground/30" testId="fleet-queue-lane-queued">
        <div role="list" aria-label={s.queue_reorder_aria}>
          {order.items.map((item, i) => (
            <InstrumentQueueRow
              key={item.sessionId}
              item={item}
              index={i}
              first={i === 0}
              last={i === order.items.length - 1}
              compact
              flash={focusKey === `s:${item.sessionId}`}
              onNudge={order.nudge}
              onStart={askStart}
              onCancel={askCancel}
            />
          ))}
        </div>
      </Lane>
      <Lane title={s.queue_lane_parked} count={parked.length} edge="bg-status-success/60" testId="fleet-queue-lane-parked">
        {parked.map((item) => (
          <InstrumentSessionCell
            key={item.sessionId}
            session={item.session}
            item={item}
            now={now}
            showProject
            onOpen={item.session.state === 'exited' ? undefined : surface.setTerminal}
            onRecap={surface.setRecap}
          />
        ))}
      </Lane>
    </div>
  );
}
