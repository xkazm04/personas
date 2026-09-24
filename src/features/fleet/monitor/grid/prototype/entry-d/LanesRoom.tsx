// Lanes: the same units, sorted by where they are in their life. Mounted in
// the rack, waiting outside it, and parked or done in the last hour. Each lane
// is a chassis with a lamp for what it holds; the rows are the board's rows,
// so a unit keeps its seat plate (or queue rank) whichever lane it is in.

import { useMemo, type ReactNode } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { ActivitySurface } from '../useActivitySurface';
import type { useQueueConfirm } from '../shared';
import { holdsSeat, isParked } from './rackModel';
import { UnitRow, UNIT_H } from './UnitRow';
import { WaitingLine } from './RunwayRoom';

function Lane({ title, count, lamp, children, testId }: {
  title: string; count: number; lamp: string; children: ReactNode; testId: string;
}) {
  return (
    <section className="ed-chassis flex min-h-0 min-w-0 flex-1 flex-col rounded-card" style={{ marginBottom: 0 }} data-testid={testId}>
      <header className="flex h-12 flex-shrink-0 items-center gap-2.5 px-3">
        <span aria-hidden data-lamp={lamp} className="ed-lamp" />
        <span className="typo-label text-foreground">{title}</span>
        <span className="ml-auto typo-data-lg tabular-nums text-foreground">{count}</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}

export function LanesRoom({ surface, confirm, now }: {
  surface: ActivitySurface;
  confirm: ReturnType<typeof useQueueConfirm>;
  now: number;
}) {
  const { t } = useTranslation();
  const s = t.monitor;
  const running = useMemo(
    () => surface.queueModel.running.filter((i) => holdsSeat(i.session.state)),
    [surface.queueModel.running],
  );
  const parked = useMemo(
    () => surface.board.sessionList
      .filter((x) => isParked(x, now) || x.state === 'stale')
      .sort((a, b) => Number(b.lastActivityMs) - Number(a.lastActivityMs)),
    [surface.board.sessionList, now],
  );
  if (surface.queueCold) {
    return (
      <div className="flex min-h-0 flex-1 gap-3.5 p-4" aria-hidden>
        {[4, 2, 3].map((n, i) => (
          <div key={i} className="ed-chassis flex min-w-0 flex-1 flex-col rounded-card" style={{ marginBottom: 0 }}>
            <div className="flex h-12 items-center px-3"><span className="ed-ghost h-3 w-24 rounded-full" /></div>
            {Array.from({ length: n }, (_, r) => <div key={r} className="ed-row" style={{ height: UNIT_H }} />)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 gap-3.5 p-4" data-testid="fleet-queue-lanes">
      <Lane title={s.queue_band_running} count={running.length} lamp="live" testId="entry-d-lane-running">
        {running.length === 0
          ? <p className="px-3 py-3 typo-body">{t.plugins.fleet.preview_no_sessions}</p>
          : running.map((item) => <UnitRow key={item.sessionId} session={item.session} item={item} now={now} />)}
      </Lane>
      <Lane title={s.queue_band_queued} count={surface.queueOrder.items.length} lamp="queued" testId="entry-d-lane-queued">
        <WaitingLine surface={surface} confirm={confirm} now={now} compact />
      </Lane>
      <Lane title={s.queue_lane_parked} count={parked.length} lamp="done" testId="entry-d-lane-parked">
        {parked.length === 0
          ? <p className="px-3 py-3 typo-body">{t.plugins.fleet.activity_empty}</p>
          : parked.map((x) => <UnitRow key={x.id} session={x} now={now} />)}
      </Lane>
    </div>
  );
}
