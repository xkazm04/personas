// Lanes: the same sessions as three plates side by side - Running, Queued,
// Parked / done - each headed by its own lamp and count. Inside a lane every
// session is one compact two-row line (hairlines between, no box around), so a
// lane holds three times what a card column did. The lamp is lit only when the
// lane holds something; an empty lane is a dark plate at a glance.

import { useMemo, type ReactNode } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { useFixedTicker } from '@/hooks/utility/timing/relativeTimeTicker';
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { ActivitySurface } from '../useActivitySurface';
import type { QueueItem } from '../../board/queue/useQueueModel';
import { SessionLine } from './SessionLine';
import { QueueLadder } from './QueueLadder';
import { SocketGhosts } from './Ghosts';
import { Engraved, Lamp } from './parts';
import type { Tone } from './tone';
import { isParked, type PanelFilter } from './boardFilter';

const HOLDS: ReadonlySet<string> = new Set(['running', 'spawning', 'awaiting_input', 'idle']);

function Lane({
  title, count, tone, children, empty, testId,
}: { title: string; count: number; tone: Tone; children: ReactNode; empty: string; testId: string }) {
  return (
    <section className="ae-plate flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-card" data-testid={testId}>
      <header className="flex flex-shrink-0 items-center gap-2.5 border-b border-border px-3 py-2">
        <Lamp lamp={{ tone, lit: count > 0 }} size="lg" />
        <Engraved>{title}</Engraved>
        <span className="ml-auto typo-data-lg tabular-nums text-foreground"><Numeric value={count} /></span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {count > 0 ? children : <p className="ae-well m-2 rounded-card px-3 py-5 text-center typo-caption">{empty}</p>}
      </div>
    </section>
  );
}

export function LanesPanel({
  surface, filter, cap, onStart, onCancel,
}: {
  surface: ActivitySurface;
  filter: PanelFilter;
  cap: number;
  onStart: (item: QueueItem) => void;
  onCancel: (item: QueueItem) => void;
}) {
  const { t } = useTranslation();
  const m = t.monitor;
  useFixedTicker(30_000);
  const now = Date.now();
  const { queueModel: model, queueOrder: order, board, setTerminal, setRecap, focusKey, reducedMotion } = surface;

  const live = useMemo(() => model.running.filter((i) => !isParked(i.session, Date.now())), [model.running]);
  const overIds = useMemo(() => {
    const holders = live.filter((i) => HOLDS.has(i.session.state));
    return new Set(cap > 0 ? holders.slice(cap).map((i) => i.sessionId) : []);
  }, [live, cap]);
  const running = live.filter((i) => filter.session(i.session));
  const queued = order.items.filter((i) => filter.session(i.session));
  const parked = useMemo(() => {
    const at = Date.now();
    return board.sessionList
      .filter((s) => isParked(s, at) && filter.session(s))
      .sort((a, b) => Number(b.lastActivityMs) - Number(a.lastActivityMs));
  }, [board.sessionList, filter]);

  if (surface.queueCold) {
    return <div className="flex min-h-0 flex-1 gap-3 p-3">{[0, 1, 2].map((i) => <div key={i} className="flex-1"><SocketGhosts count={3} /></div>)}</div>;
  }

  return (
    <div className="flex min-h-0 flex-1 gap-2.5 overflow-hidden p-3" data-testid="fleet-queue-lanes">
      <Lane title={m.queue_band_running} count={running.length} tone="run" empty={m.queue_empty_title} testId="fleet-queue-lane-running">
        {running.map((item) => (
          <SessionLine key={item.sessionId} session={item.session} item={item} onOpen={setTerminal} onRecap={setRecap}
            flash={focusKey === `s:${item.sessionId}`} over={overIds.has(item.sessionId)} now={now} showProject />
        ))}
      </Lane>
      <Lane title={m.queue_band_queued} count={queued.length} tone="info" empty={m.queue_strip_empty} testId="fleet-queue-lane-queued">
        <QueueLadder order={order} items={queued} now={now} compact focusKey={focusKey} reducedMotion={reducedMotion} draggable={!filter.active} onStart={onStart} onCancel={onCancel} />
      </Lane>
      <Lane title={m.queue_lane_parked} count={parked.length} tone="ok" empty={m.queue_lane_parked} testId="fleet-queue-lane-parked">
        {parked.map((s) => (
          <SessionLine key={s.id} session={s} onOpen={s.state === 'exited' ? undefined : setTerminal} onRecap={setRecap}
            flash={focusKey === `s:${s.id}`} now={now} showProject />
        ))}
      </Lane>
    </div>
  );
}
