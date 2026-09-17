// RunwayBoard — the cap made visible: exactly `cap` slots, then the queue.
//
// The RUNNING band has as many slots as the cap says, filled oldest-first;
// an unfilled slot is a ghost card, so "three free slots" is something you
// count rather than compute. A live row past the cap (a Start now) is
// appended AFTER the band with a warning border: it is running, it is over
// the line, and the band's arithmetic should not hide that. The QUEUE below
// is one strip in rank order — a taxiway — and the strip is the reorder list
// (framer `Reorder`, axis x): drag a tile along it, or use its arrows.

import { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { QueueTile, QUEUE_TILE_H, QUEUE_TILE_W } from './QueueTile';
import { QueueReorderList } from './QueueReorderList';
import type { QueueBoardProps } from './queueBoardTypes';

function FreeSlot({ label }: { label: string }) {
  return (
    <div
      aria-label={label}
      role="img"
      className="flex flex-shrink-0 items-center justify-center rounded-input border border-dashed border-border/70 bg-foreground/[0.015] typo-caption text-foreground opacity-40"
      style={{ width: QUEUE_TILE_W, height: QUEUE_TILE_H }}
      data-testid="fleet-queue-free-slot"
    >
      {label}
    </div>
  );
}

export function RunwayBoard({
  model, order, actions, teams, reducedMotion, focusKey, onOpenSession, onRecapSession,
}: QueueBoardProps) {
  const { t } = useTranslation();
  const s = t.monitor;
  const teamColor = useMemo(() => new Map(teams.map((tm) => [tm.id, tm.color])), [teams]);
  const cap = Math.max(0, model.cap);
  const inBand = model.running.slice(0, cap);
  const over = model.running.slice(cap);
  const free = Math.max(0, cap - inBand.length);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto p-3" data-testid="fleet-queue-runway">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="typo-label text-foreground">{s.queue_band_running}</span>
        <span className="typo-caption tabular-nums text-foreground opacity-60">
          <Numeric value={model.running.length} /> / <Numeric value={cap} />
        </span>
        {over.length > 0 && (
          <span className="rounded-full border border-status-warning/40 bg-status-warning/10 px-1.5 typo-caption text-status-warning">
            {s.queue_over_admitted}
          </span>
        )}
      </div>
      <AnimatePresence initial={false}>
        <div className="flex flex-wrap gap-2" data-testid="fleet-queue-running-band">
          {inBand.map((item) => (
            <motion.div
              key={item.sessionId}
              layoutId={reducedMotion ? undefined : `queue:${item.sessionId}`}
              transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 32 }}
            >
              <QueueTile item={item} actions={actions} onOpen={onOpenSession} onRecap={onRecapSession} flash={focusKey === `s:${item.sessionId}`} />
            </motion.div>
          ))}
          {Array.from({ length: free }, (_, i) => <FreeSlot key={`free-${i}`} label={s.queue_slot_free} />)}
          {over.map((item) => (
            <motion.div
              key={item.sessionId}
              layoutId={reducedMotion ? undefined : `queue:${item.sessionId}`}
              transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 32 }}
            >
              <QueueTile item={item} actions={actions} onOpen={onOpenSession} onRecap={onRecapSession} overAdmitted flash={focusKey === `s:${item.sessionId}`} />
            </motion.div>
          ))}
        </div>
      </AnimatePresence>

      <div className="mt-4 mb-1.5 flex items-center gap-2 border-t border-border/60 pt-3">
        <span className="typo-label text-foreground">{s.queue_band_queued}</span>
        <span className="typo-caption tabular-nums text-foreground opacity-60"><Numeric value={order.items.length} /></span>
      </div>
      {order.items.length > 0 ? (
        <div className="min-w-0 overflow-x-auto pb-1" data-testid="fleet-queue-strip">
          <QueueReorderList
            order={order}
            actions={actions}
            axis="x"
            reducedMotion={reducedMotion}
            focusKey={focusKey}
            onOpen={onOpenSession}
            onRecap={onRecapSession}
            ariaLabel={s.queue_reorder_aria}
            className="flex w-max items-center gap-2"
            accentFor={(item) => (item.teamId ? teamColor.get(item.teamId) : undefined)}
          />
        </div>
      ) : (
        <p className="typo-caption text-foreground opacity-50">{s.queue_strip_empty}</p>
      )}
    </div>
  );
}

export default RunwayBoard;
