// Runway: the cap as a rack of SOCKETS. Each slot the cap allows is a physical
// well in the panel - filled by a running session or standing empty, so free
// capacity is a shape you see rather than a number you subtract. A session
// admitted past the cap sits outside the rack on hatched ground. Below the
// rack, the queue waits its turn as a ladder.

import { Layers } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useFixedTicker } from '@/hooks/utility/timing/relativeTimeTicker';
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { ActivitySurface } from '../useActivitySurface';
import type { QueueItem } from '../../board/queue/useQueueModel';
import { SessionWindow } from './SessionWindow';
import { QueueLadder } from './QueueLadder';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { SocketGhosts } from './Ghosts';
import { Engraved } from './parts';

const HOLDS: ReadonlySet<string> = new Set(['running', 'spawning', 'awaiting_input', 'idle']);

export function RunwayPanel({
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
  const { queueModel: model, queueOrder: order, setTerminal, setRecap, focusKey, reducedMotion } = surface;
  // Only a working session holds a socket. Finished, hibernated and stale rows
  // stay visible, but under the rack, so the rack agrees with the door's count.
  const holders = model.running.filter((i) => HOLDS.has(i.session.state));
  const resting = model.running.filter((i) => !HOLDS.has(i.session.state));
  const inRack = holders.slice(0, cap);
  const over = holders.slice(cap);
  const free = Math.max(0, cap - inRack.length);

  if (surface.queueCold) {
    return <div className="flex min-h-0 flex-1 flex-col gap-3 p-3"><SocketGhosts count={Math.max(4, cap)} /></div>;
  }
  if (model.empty && cap === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6" data-testid="entry-e-empty">
        <ScenarioEmptyState icon={Layers} title={m.queue_empty_title} description={m.queue_empty_hint} />
      </div>
    );
  }

  const socket = (item: QueueItem, isOver: boolean) => (
    <div key={item.sessionId} className={`rounded-card p-1 ${isOver ? 'ae-hatch' : 'ae-well'}`} data-testid={isOver ? 'entry-e-over-socket' : 'entry-e-socket'}>
      <SessionWindow
        session={item.session}
        item={item}
        onOpen={setTerminal}
        onRecap={setRecap}
        flash={focusKey === `s:${item.sessionId}`}
        over={isOver}
        now={now}
      />
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3" data-testid="fleet-queue-runway">
      <section className="ae-plate flex flex-col gap-2.5 rounded-card p-3">
        <header className="flex items-baseline gap-3 px-1">
          <Engraved>{m.queue_band_running}</Engraved>
          <span className="typo-data-lg tabular-nums text-foreground">
            <Numeric value={holders.length} /><span className="typo-data text-foreground"> / <Numeric value={cap} /></span>
          </span>
          {over.length > 0 && (
            <span className="rounded-pill border border-status-warning/40 bg-status-warning/10 px-2 typo-caption text-status-warning">
              {m.queue_over_admitted} · {over.length}
            </span>
          )}
        </header>
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }} data-testid="fleet-queue-running-band">
          {inRack.map((item) => socket(item, false))}
          {Array.from({ length: free }, (_, i) => (
            <div
              key={`free-${i}`}
              role="img"
              aria-label={m.queue_slot_free}
              data-testid="fleet-queue-free-slot"
              className="ae-well flex min-h-[64px] items-center justify-center gap-2 rounded-card typo-caption"
            >
              <span className="ae-lamp ae-t-off" aria-hidden />
              {m.queue_slot_free}
            </div>
          ))}
        </div>
        {over.length > 0 && (
          <>
            <div className="flex items-center gap-2 px-1" aria-hidden>
              <span className="h-px flex-1 bg-status-warning/50" />
              <span className="typo-caption text-status-warning">{m.queue_over_admitted}</span>
              <span className="h-px flex-1 bg-status-warning/50" />
            </div>
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
              {over.map((item) => socket(item, true))}
            </div>
          </>
        )}
        {resting.length > 0 && (
          <>
            <div className="flex items-center gap-2 px-1" aria-hidden>
              <span className="h-px flex-1 bg-border" />
              <span className="typo-caption">{m.queue_lane_parked} · {resting.length}</span>
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="grid gap-2 opacity-80" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
              {resting.map((item) => (
                <SessionWindow key={item.sessionId} session={item.session} item={item} onOpen={setTerminal} onRecap={setRecap} flash={focusKey === `s:${item.sessionId}`} now={now} />
              ))}
            </div>
          </>
        )}
      </section>

      <section className="ae-plate flex flex-col gap-2.5 rounded-card p-3">
        <header className="flex items-baseline gap-3 px-1">
          <Engraved>{m.queue_band_queued}</Engraved>
          <span className="typo-data-lg tabular-nums text-foreground"><Numeric value={order.items.length} /></span>
        </header>
        {order.items.length > 0 ? (
          <QueueLadder order={order} now={now} focusKey={focusKey} reducedMotion={reducedMotion} onStart={onStart} onCancel={onCancel} />
        ) : (
          <p className="px-1 typo-caption">{m.queue_strip_empty}</p>
        )}
      </section>
    </div>
  );
}
