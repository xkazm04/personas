// Atelier lanes — three soft columns over the same sessions: Working (holding
// a slot), Up next (the queue, reorderable) and Resting & done (hibernated,
// finished, or exited within the hour). Each lane is a quiet surface with a
// pill count; its items are the same SessionChip / QueueRow the runway uses.

import { useMemo, type ReactNode } from 'react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useTranslation } from '@/i18n/useTranslation';
import { buildQueueModel } from '../../board/queue/useQueueModel';
import type { ActivitySurface } from '../useActivitySurface';
import { SessionChip } from './SessionChip';
import { QueueRow } from './QueueRow';
import { SectionLabel } from './parts';

const PARKED_WINDOW_MS = 60 * 60 * 1_000;

function isParked(s: FleetSession, now: number): boolean {
  if (s.state === 'hibernated' || s.state === 'finished') return true;
  return s.state === 'exited' && now - Number(s.lastActivityMs) <= PARKED_WINDOW_MS;
}

function Lane({ title, count, testId, children }: { title: string; count: number; testId: string; children: ReactNode }) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 rounded-card bg-secondary/20 p-2 shadow-elevation-1" data-testid={testId}>
      <div className="pt-1"><SectionLabel count={count}>{title}</SectionLabel></div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">{children}</div>
    </section>
  );
}

export function AtelierLanes({
  surface, now, askStart, askCancel,
}: {
  surface: ActivitySurface;
  now: number;
  askStart: Parameters<typeof QueueRow>[0]['onStart'];
  askCancel: Parameters<typeof QueueRow>[0]['onCancel'];
}) {
  const { t } = useTranslation();
  const s = t.monitor;
  const { queueModel: model, queueOrder: order, board, reducedMotion, focusKey } = surface;
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
    <div className="flex min-h-0 flex-1 gap-3 overflow-hidden p-4" data-testid="fleet-queue-lanes">
      <Lane title="Working" count={running.length} testId="fleet-queue-lane-running">
        {running.map((item, i) => (
          <SessionChip
            key={item.sessionId}
            session={item.session}
            item={item}
            now={now}
            flash={focusKey === `s:${item.sessionId}`}
            overAdmitted={model.cap > 0 && i >= model.cap}
            showProject
            reducedMotion={reducedMotion}
            onOpen={surface.setTerminal}
            onRecap={surface.setRecap}
          />
        ))}
      </Lane>
      <Lane title="Up next" count={order.items.length} testId="fleet-queue-lane-queued">
        <div role="list" aria-label={s.queue_reorder_aria} className="flex flex-col gap-0.5">
          {order.items.map((item, i) => (
            <QueueRow
              key={item.sessionId}
              item={item}
              first={i === 0}
              last={i === order.items.length - 1}
              flash={focusKey === `s:${item.sessionId}`}
              compact
              onNudge={order.nudge}
              onStart={askStart}
              onCancel={askCancel}
            />
          ))}
        </div>
      </Lane>
      <Lane title="Resting & done" count={parked.length} testId="fleet-queue-lane-parked">
        {parked.map((item) => (
          <SessionChip
            key={item.sessionId}
            session={item.session}
            item={item}
            now={now}
            flash={focusKey === `s:${item.sessionId}`}
            showProject
            reducedMotion={reducedMotion}
            onOpen={item.session.state === 'exited' ? undefined : surface.setTerminal}
            onRecap={surface.setRecap}
          />
        ))}
      </Lane>
    </div>
  );
}
