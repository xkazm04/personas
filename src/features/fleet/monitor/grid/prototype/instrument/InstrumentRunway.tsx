// InstrumentRunway — the cap as a literal SLOT RACK. Bays 01…N, one per slot
// the cap allows; each holds its live session or stands open behind a dashed
// frame. Sessions admitted past the cap sit in amber over-bays. Below the rack,
// the queue as a ranked mono list with its verbs.

import type { ReactNode } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { ActivitySurface } from '../useActivitySurface';
import { InstrumentSessionCell } from './InstrumentSessionCell';
import { InstrumentQueueRow } from './InstrumentQueueRow';
import { bay, Bracketed } from './parts';

const RACK = 'grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3';

function Bay({ n, over = false, emptyLabel, children }: { n: string; over?: boolean; emptyLabel?: string; children?: ReactNode }) {
  return (
    <div
      className={`relative min-h-[5.25rem] rounded-interactive border px-2 pb-1.5 pt-5 ${
        children
          ? over ? 'border-status-warning/40 bg-status-warning/[0.05]' : 'border-primary/15 bg-foreground/[0.02]'
          : 'border-dashed border-primary/15'
      }`}
      data-testid={children ? 'fleet-queue-bay' : 'fleet-queue-free-slot'}
    >
      <span className={`absolute left-2 top-1 typo-code tabular-nums ${over ? 'text-status-warning' : 'text-primary opacity-70'}`}>{n}</span>
      {children ?? (
        <span className="flex h-full items-center justify-center pb-3 typo-code text-foreground opacity-40">{emptyLabel}</span>
      )}
    </div>
  );
}

export function InstrumentRunway({
  surface, now, askStart, askCancel,
}: {
  surface: ActivitySurface;
  now: number;
  askStart: Parameters<typeof InstrumentQueueRow>[0]['onStart'];
  askCancel: Parameters<typeof InstrumentQueueRow>[0]['onCancel'];
}) {
  const { t } = useTranslation();
  const s = t.monitor;
  const { queueModel: model, queueOrder: order, focusKey } = surface;
  const cap = Math.max(0, model.cap);
  const inBand = model.running.slice(0, cap);
  const over = model.running.slice(cap);
  const free = Math.max(0, cap - inBand.length);
  const queued = order.items;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4" data-testid="fleet-queue-runway">
      <header className="mb-3 flex items-baseline gap-3">
        <Bracketed className="typo-label uppercase tracking-wider text-foreground">{s.queue_band_running}</Bracketed>
        <span className="typo-code tabular-nums text-foreground opacity-70">
          <Numeric value={model.running.length} /> / <Numeric value={cap} />
        </span>
      </header>
      <div className={RACK} data-testid="fleet-queue-running-band">
        {inBand.map((item, i) => (
          <Bay key={item.sessionId} n={bay(i + 1)}>
            <InstrumentSessionCell session={item.session} item={item} now={now} showProject flash={focusKey === `s:${item.sessionId}`} onOpen={surface.setTerminal} onRecap={surface.setRecap} />
          </Bay>
        ))}
        {Array.from({ length: free }, (_, i) => (
          <Bay key={`free-${i}`} n={bay(inBand.length + i + 1)} emptyLabel={s.queue_slot_free} />
        ))}
        {over.map((item, i) => (
          <Bay key={item.sessionId} n={`+${i + 1}`} over>
            <InstrumentSessionCell session={item.session} item={item} now={now} showProject overAdmitted flash={focusKey === `s:${item.sessionId}`} onOpen={surface.setTerminal} onRecap={surface.setRecap} />
          </Bay>
        ))}
      </div>

      <header className="mb-1 mt-7 flex items-baseline gap-3 border-t border-primary/10 pt-4">
        <Bracketed className="typo-label uppercase tracking-wider text-foreground">{s.queue_band_queued}</Bracketed>
        <span className="typo-code tabular-nums text-foreground opacity-70"><Numeric value={queued.length} /></span>
      </header>
      {queued.length > 0 ? (
        <div role="list" aria-label={s.queue_reorder_aria} data-testid="fleet-queue-strip">
          {queued.map((item, i) => (
            <InstrumentQueueRow
              key={item.sessionId}
              item={item}
              index={i}
              first={i === 0}
              last={i === queued.length - 1}
              flash={focusKey === `s:${item.sessionId}`}
              onNudge={order.nudge}
              onStart={askStart}
              onCancel={askCancel}
            />
          ))}
        </div>
      ) : (
        <p className="typo-body text-foreground opacity-60">{s.queue_strip_empty}</p>
      )}
    </div>
  );
}
