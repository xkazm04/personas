// Lanes: the same sessions as three plates side by side - Running, Queued,
// Parked / done - each headed by its own lamp and count. The lamp is lit only
// when the lane holds something, so an empty lane is a dark plate at a glance.
//
// `isParked` mirrors `board/queue/LanesBoard.tsx`, where it is module-private.

import { useMemo, type ReactNode } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { useFixedTicker } from '@/hooks/utility/timing/relativeTimeTicker';
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { ActivitySurface } from '../useActivitySurface';
import type { QueueItem } from '../../board/queue/useQueueModel';
import { SessionWindow } from './SessionWindow';
import { QueueLadder } from './QueueLadder';
import { SocketGhosts } from './Ghosts';
import { Engraved, Lamp } from './parts';
import type { Tone } from './tone';

const HOLDS: ReadonlySet<string> = new Set(['running', 'spawning', 'awaiting_input', 'idle']);
const PARKED_WINDOW_MS = 60 * 60 * 1_000;

function isParked(s: FleetSession, now: number): boolean {
  if (s.state === 'hibernated' || s.state === 'finished') return true;
  return s.state === 'exited' && now - Number(s.lastActivityMs) <= PARKED_WINDOW_MS;
}

function Lane({
  title, count, tone, children, empty, testId,
}: { title: string; count: number; tone: Tone; children: ReactNode; empty: string; testId: string }) {
  return (
    <section className="ae-plate flex min-h-0 min-w-0 flex-1 flex-col rounded-card" data-testid={testId}>
      <header className="flex flex-shrink-0 items-center gap-2.5 border-b border-border px-3 py-2.5">
        <Lamp lamp={{ tone, lit: count > 0 }} size="lg" />
        <Engraved>{title}</Engraved>
        <span className="ml-auto typo-data-lg tabular-nums text-foreground"><Numeric value={count} /></span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
        {count > 0 ? children : <p className="ae-well m-1 rounded-card px-3 py-6 text-center typo-caption">{empty}</p>}
      </div>
    </section>
  );
}

export function LanesPanel({
  surface, cap, onStart, onCancel,
}: {
  surface: ActivitySurface;
  cap: number;
  onStart: (item: QueueItem) => void;
  onCancel: (item: QueueItem) => void;
}) {
  const { t } = useTranslation();
  const m = t.monitor;
  useFixedTicker(30_000);
  const now = Date.now();
  const { queueModel: model, queueOrder: order, board, setTerminal, setRecap, focusKey, reducedMotion } = surface;

  const running = useMemo(() => model.running.filter((i) => !isParked(i.session, Date.now())), [model.running]);
  const overIds = useMemo(() => {
    const holders = running.filter((i) => HOLDS.has(i.session.state));
    return new Set(cap > 0 ? holders.slice(cap).map((i) => i.sessionId) : []);
  }, [running, cap]);
  const parked = useMemo(() => {
    const at = Date.now();
    return board.sessionList
      .filter((s) => isParked(s, at))
      .sort((a, b) => Number(b.lastActivityMs) - Number(a.lastActivityMs));
  }, [board.sessionList]);

  if (surface.queueCold) {
    return <div className="flex min-h-0 flex-1 gap-3 p-3">{[0, 1, 2].map((i) => <div key={i} className="flex-1"><SocketGhosts count={3} /></div>)}</div>;
  }

  return (
    <div className="flex min-h-0 flex-1 gap-2.5 overflow-hidden p-3" data-testid="fleet-queue-lanes">
      <Lane title={m.queue_band_running} count={running.length} tone="run" empty={m.queue_empty_title} testId="fleet-queue-lane-running">
        {running.map((item) => (
          <SessionWindow
            key={item.sessionId}
            session={item.session}
            item={item}
            onOpen={setTerminal}
            onRecap={setRecap}
            flash={focusKey === `s:${item.sessionId}`}
            over={overIds.has(item.sessionId)}
            now={now}
          />
        ))}
      </Lane>
      <Lane title={m.queue_band_queued} count={order.items.length} tone="info" empty={m.queue_strip_empty} testId="fleet-queue-lane-queued">
        <QueueLadder order={order} now={now} compact focusKey={focusKey} reducedMotion={reducedMotion} onStart={onStart} onCancel={onCancel} />
      </Lane>
      <Lane title={m.queue_lane_parked} count={parked.length} tone="ok" empty={m.queue_lane_parked} testId="fleet-queue-lane-parked">
        {parked.map((s) => (
          <SessionWindow
            key={s.id}
            session={s}
            onOpen={s.state === 'exited' ? undefined : setTerminal}
            onRecap={setRecap}
            flash={focusKey === `s:${s.id}`}
            now={now}
          />
        ))}
      </Lane>
    </div>
  );
}
