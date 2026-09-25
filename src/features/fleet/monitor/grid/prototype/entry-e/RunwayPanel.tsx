// Runway: the cap as a rack of SOCKETS. Each slot the cap allows is a well in
// the panel - filled by a working session or standing empty, so free capacity
// is a shape rather than a number to subtract. A session admitted past the cap
// sits outside the rack on hatched ground; resting sessions sit under it. Below
// the rack the queue waits as a ladder you can drag into a new order.
// The panel filter narrows every card; the rack's own count stays the door's.

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
import type { PanelFilter } from './boardFilter';

const HOLDS: ReadonlySet<string> = new Set(['running', 'spawning', 'awaiting_input', 'idle']);
const GRID = { gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' };

function Divider({ label, warn = false }: { label: string; warn?: boolean }) {
  return (
    <div className="flex items-center gap-2 px-1" aria-hidden>
      <span className={`h-px flex-1 ${warn ? 'bg-status-warning/50' : 'bg-border'}`} />
      <span className={`typo-caption ${warn ? 'text-status-warning' : ''}`}>{label}</span>
      <span className={`h-px flex-1 ${warn ? 'bg-status-warning/50' : 'bg-border'}`} />
    </div>
  );
}

export function RunwayPanel({
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
  const { queueModel: model, queueOrder: order, setTerminal, setRecap, focusKey, reducedMotion } = surface;
  const holders = model.running.filter((i) => HOLDS.has(i.session.state));
  const resting = model.running.filter((i) => !HOLDS.has(i.session.state) && filter.session(i.session));
  const inRack = holders.slice(0, cap).filter((i) => filter.session(i.session));
  const over = holders.slice(cap).filter((i) => filter.session(i.session));
  const free = filter.active ? 0 : Math.max(0, cap - Math.min(cap, holders.length));
  const queued = order.items.filter((i) => filter.session(i.session));

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

  const card = (item: QueueItem, isOver: boolean) => (
    <div key={item.sessionId} className={`rounded-card p-1 ${isOver ? 'ae-hatch' : 'ae-well'}`} data-testid={isOver ? 'entry-e-over-socket' : 'entry-e-socket'}>
      <SessionWindow session={item.session} item={item} onOpen={setTerminal} onRecap={setRecap} flash={focusKey === `s:${item.sessionId}`} over={isOver} now={now} />
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3" data-testid="fleet-queue-runway">
      <section className="ae-plate flex flex-col gap-2.5 rounded-card p-3">
        <header className="flex items-baseline gap-3 px-1">
          <Engraved>{m.queue_band_running}</Engraved>
          <span className="typo-data-lg tabular-nums text-foreground">
            <Numeric value={holders.length} /><span className="typo-data text-foreground"> / <Numeric value={cap} /></span>
          </span>
          {holders.length > cap && cap > 0 && (
            <span className="rounded-pill border border-status-warning/40 bg-status-warning/10 px-2 typo-caption text-status-warning">
              {m.queue_over_admitted} · {holders.length - cap}
            </span>
          )}
        </header>
        <div className="grid gap-2" style={GRID} data-testid="fleet-queue-running-band">
          {inRack.map((item) => card(item, false))}
          {Array.from({ length: free }, (_, i) => (
            <div key={`free-${i}`} role="img" aria-label={m.queue_slot_free} data-testid="fleet-queue-free-slot" className="ae-well flex min-h-[60px] items-center justify-center gap-2 rounded-card typo-caption">
              <span className="ae-lamp ae-t-off" aria-hidden />{m.queue_slot_free}
            </div>
          ))}
        </div>
        {over.length > 0 && (<><Divider label={m.queue_over_admitted} warn /><div className="grid gap-2" style={GRID}>{over.map((item) => card(item, true))}</div></>)}
        {resting.length > 0 && (
          <>
            <Divider label={`${m.queue_lane_parked} · ${resting.length}`} />
            <div className="grid gap-2 opacity-85" style={GRID}>
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
          <span className="typo-data-lg tabular-nums text-foreground"><Numeric value={queued.length} /></span>
          {filter.active && order.items.length > 0 && <span className="ml-auto typo-caption">Clear the filter to reorder</span>}
        </header>
        {queued.length > 0 ? (
          <QueueLadder order={order} items={queued} now={now} focusKey={focusKey} reducedMotion={reducedMotion} draggable={!filter.active} onStart={onStart} onCancel={onCancel} />
        ) : (
          <p className="px-1 typo-caption">{m.queue_strip_empty}</p>
        )}
      </section>
    </div>
  );
}
