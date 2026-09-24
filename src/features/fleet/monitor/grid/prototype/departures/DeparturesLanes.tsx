// Departures · DeparturesLanes — three ruled tables side by side: Running,
// Queued, Parked & done. PROTOTYPE (variant C). No lane boxes: each lane is a
// ruled header over compact ledger lines, separated by a hairline gutter.

import { useMemo, type ReactNode } from 'react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useTranslation } from '@/i18n/useTranslation';
import { buildQueueModel } from '../../board/queue/useQueueModel';
import type { ActivitySurface } from '../useActivitySurface';
import type { useQueueConfirm } from '../shared';
import { SessionLine } from './SessionLine';
import { ScheduledLine } from './ScheduledLine';
import { RuledHeader } from './parts';

/** Copied from LanesBoard: finished / hibernated, or exited within the hour. */
const PARKED_WINDOW_MS = 60 * 60 * 1_000;
function isParked(s: FleetSession, now: number): boolean {
  if (s.state === 'hibernated' || s.state === 'finished') return true;
  return s.state === 'exited' && now - Number(s.lastActivityMs) <= PARKED_WINDOW_MS;
}

function Lane({ title, count, testId, children }: { title: string; count: number; testId: string; children: ReactNode }) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col px-3 first:pl-0 last:pr-0" data-testid={testId}>
      <RuledHeader label={title} count={count} className="px-2" />
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}

export function DeparturesLanes({
  surface, now, confirm,
}: {
  surface: ActivitySurface;
  now: number;
  confirm: ReturnType<typeof useQueueConfirm>;
}) {
  const { t } = useTranslation();
  const s = t.monitor;
  const { queueModel: model, queueOrder: order, board, focusKey, setTerminal, setRecap } = surface;
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
    <div className="flex min-h-0 flex-1 divide-x divide-border/50 overflow-hidden p-4" data-testid="fleet-queue-lanes">
      <Lane title={s.queue_band_running} count={running.length} testId="fleet-queue-lane-running">
        {running.map((item, i) => (
          <SessionLine
            key={item.sessionId}
            session={item.session}
            item={item}
            now={now}
            compact
            flag={model.cap > 0 && i >= model.cap ? s.queue_over_admitted : undefined}
            flash={focusKey === `s:${item.sessionId}`}
            onOpen={setTerminal}
            onRecap={setRecap}
            testId="fleet-queue-tile"
          />
        ))}
      </Lane>
      <Lane title={s.queue_band_queued} count={order.items.length} testId="fleet-queue-lane-queued">
        <div role="list" aria-label={s.queue_reorder_aria}>
          {order.items.map((item, i) => (
            <ScheduledLine
              key={item.sessionId}
              item={item}
              position={i + 1}
              first={i === 0}
              last={i === order.items.length - 1}
              flash={focusKey === `s:${item.sessionId}`}
              compact
              onNudge={order.nudge}
              onStart={confirm.askStart}
              onCancel={confirm.askCancel}
            />
          ))}
        </div>
      </Lane>
      <Lane title={s.queue_lane_parked} count={parked.length} testId="fleet-queue-lane-parked">
        {parked.map((item) => (
          <SessionLine
            key={item.sessionId}
            session={item.session}
            item={item}
            now={now}
            compact
            flash={focusKey === `s:${item.sessionId}`}
            onOpen={item.session.state === 'exited' ? undefined : setTerminal}
            onRecap={setRecap}
            testId="fleet-queue-tile"
          />
        ))}
      </Lane>
    </div>
  );
}
