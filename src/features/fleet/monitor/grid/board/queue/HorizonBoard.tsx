// HorizonBoard — the fleet on a time axis.
//
// One horizontal axis, "now" near the left. Left of now, a compressed past:
// every RUNNING row is a bar from its `createdAtMs` to now, so the longest
// bar is the oldest slot-holder and a row that just started is a stub. Right
// of now, the future: every QUEUED row sits at its `estimatedStartMs` — the
// door's `now + rank × mean duration` — with the time printed above it. Rows
// the door could not estimate (no history yet) stack at the right edge under
// a "no estimate" label rather than at an invented time.
//
// The queued row is the reorder list (framer `Reorder`, axis x): a drop sends
// the new order to the door, and until the snapshot returns the board
// re-estimates LOCALLY from the mean the last snapshot implied
// (`useLocalOrder`), so the tiles slide to where they will be, not to where
// they were. The past is compressed into a fixed fraction of the width and
// the future scales to the last estimate, because "how long has this run" and
// "when does that start" are different questions with different ranges.

import { useMemo, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { useFormattedDate } from '@/hooks/utility/data/useFormattedDate';
import { formatElapsedCompact } from '@/lib/utils/formatters';
import { QueueTile, QUEUE_TILE_H, QUEUE_TILE_W } from './QueueTile';
import { QueueReorderList } from './QueueReorderList';
import type { QueueBoardProps } from './queueBoardTypes';
import type { QueueItem } from './useQueueModel';

/** Share of the scroll width the past takes; the future gets the rest. */
const PAST_FRACTION = 0.28;
const MIN_PAST_MS = 5 * 60 * 1_000;
const MIN_FUTURE_MS = 15 * 60 * 1_000;
const ROW_GAP = 6;
const BAR_H = 22;

function StartLabel({ at }: { at: number }) {
  const text = useFormattedDate(at, { timeStyle: 'short' });
  return <span className="mb-0.5 block typo-caption tabular-nums text-foreground opacity-60">{text}</span>;
}

export function HorizonBoard({
  model, order, actions, teams, reducedMotion, focusKey, onOpenSession, onRecapSession,
}: QueueBoardProps) {
  const { t } = useTranslation();
  const s = t.monitor;
  const teamColor = useMemo(() => new Map(teams.map((tm) => [tm.id, tm.color])), [teams]);
  const now = Date.now();

  const estimated = useMemo(() => order.items.filter((i) => i.estimatedStartMs !== null), [order.items]);
  const unestimated = useMemo(() => order.items.filter((i) => i.estimatedStartMs === null), [order.items]);
  // The reorder list only holds the estimated tiles; `applyOrder` keeps the
  // unlisted (unestimated) rows at the tail, so the door still gets every id.
  const estimatedOrder = useMemo(() => ({ ...order, items: estimated }), [order, estimated]);

  const pastMs = Math.max(MIN_PAST_MS, ...model.running.map((i) => now - Number(i.session.createdAtMs)));
  const futureMs = Math.max(MIN_FUTURE_MS, ...estimated.map((i) => i.estimatedStartMs! - now));
  // The future must hold every estimated tile side by side at minimum.
  const futurePx = Math.max(720, estimated.length * (QUEUE_TILE_W + 8));
  const pastPx = Math.round((futurePx * PAST_FRACTION) / (1 - PAST_FRACTION));
  const pxPerMsPast = pastPx / pastMs;
  const pxPerMsFuture = futurePx / futureMs;

  // Reorder.Item positions are in flow; the gap to the previous tile is the
  // margin that puts this tile's LEFT edge at its estimate. A negative gap
  // (estimates closer than one tile width) is clamped to a hair, which keeps
  // the ORDER honest even where the axis would overlap.
  const itemStyle = (item: QueueItem, index: number): CSSProperties | undefined => {
    if (item.estimatedStartMs === null) return undefined;
    const x = (item.estimatedStartMs - now) * pxPerMsFuture;
    const prev = estimated[index - 1];
    const prevRight = prev ? (prev.estimatedStartMs! - now) * pxPerMsFuture + QUEUE_TILE_W : 0;
    return { marginLeft: Math.max(4, x - prevRight) };
  };
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3" aria-label={s.queue_horizon_aria} data-testid="fleet-queue-horizon">
      <div className="relative" style={{ width: pastPx + futurePx + 16, minHeight: '100%' }}>
        {/* The axis: past to the left of the now-line, future to the right. */}
        <div
          aria-hidden
          className="absolute inset-y-0 w-px bg-primary/60"
          style={{ left: pastPx }}
        />
        <span
          className="absolute -top-0.5 rounded-full bg-primary/15 px-1.5 typo-caption font-medium text-primary"
          style={{ left: pastPx + 4 }}
          data-testid="fleet-queue-now"
        >
          {s.queue_horizon_now}
        </span>

        {/* Running bars, one row each, from createdAt to now. */}
        <div className="flex flex-col pt-5" style={{ gap: ROW_GAP }} data-testid="fleet-queue-horizon-running">
          <AnimatePresence initial={false}>
            {model.running.map((item, i) => {
              const startPx = pastPx - (now - Number(item.session.createdAtMs)) * pxPerMsPast;
              const width = Math.max(QUEUE_TILE_W, pastPx - startPx);
              const color = item.teamId ? teamColor.get(item.teamId) : undefined;
              const over = model.cap > 0 && i >= model.cap;
              return (
                <motion.div
                  key={item.sessionId}
                  layoutId={reducedMotion ? undefined : `queue:${item.sessionId}`}
                  transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 32 }}
                  className="relative flex items-center"
                  style={{ marginLeft: Math.max(0, startPx), width, height: QUEUE_TILE_H }}
                >
                  <span
                    aria-hidden
                    className={`absolute inset-y-1 left-0 right-0 rounded-full ${over ? 'bg-status-warning/15' : 'bg-primary/[0.08]'}`}
                    style={{ height: BAR_H, top: (QUEUE_TILE_H - BAR_H) / 2, borderLeft: color ? `2px solid ${color}` : undefined }}
                  />
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 typo-caption tabular-nums text-foreground opacity-50">
                    {formatElapsedCompact(new Date(Number(item.session.createdAtMs)).toISOString(), '')}
                  </span>
                  <span className="relative ml-auto">
                    <QueueTile item={item} actions={actions} onOpen={onOpenSession} onRecap={onRecapSession} overAdmitted={over} flash={focusKey === `s:${item.sessionId}`} />
                  </span>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* The queue: at its estimates, right of now; unestimated stacked at the edge. */}
        <div className="mt-3 flex items-start" style={{ paddingLeft: pastPx + 1 }}>
          {estimated.length > 0 && (
            <QueueReorderList
              order={estimatedOrder}
              actions={actions}
              axis="x"
              reducedMotion={reducedMotion}
              focusKey={focusKey}
              onOpen={onOpenSession}
              onRecap={onRecapSession}
              ariaLabel={s.queue_reorder_aria}
              className="flex items-end"
              itemStyle={itemStyle}
              accentFor={(item) => (item.teamId ? teamColor.get(item.teamId) : undefined)}
              decorate={(item) => (item.estimatedStartMs !== null ? <StartLabel at={item.estimatedStartMs} /> : null)}
            />
          )}
          {unestimated.length > 0 && (
            <div className="ml-auto flex flex-col gap-1.5 border-l border-dashed border-border/70 pl-2" data-testid="fleet-queue-unestimated">
              <span className="typo-caption text-foreground opacity-60">{s.queue_no_estimate}</span>
              {unestimated.map((item, i) => (
                <QueueTile
                  key={item.sessionId}
                  item={item}
                  actions={actions}
                  onNudge={order.nudge}
                  first={estimated.length === 0 && i === 0}
                  last={i === unestimated.length - 1}
                  flash={focusKey === `s:${item.sessionId}`}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default HorizonBoard;
