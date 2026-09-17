// RankedGridBoard — the fleet as ONE sequence, wrapped into the board's grid.
//
// Running rows first (oldest slot-holder first), then the queue by rank, and
// the tiles flow left → right, top → bottom, wrapping at whatever count fits
// the board's width — the same ResizeObserver discipline the classic board
// runs (`useBoardRows`), measured with the queue tile's own width and no
// five-column ceiling. The team survives as a coloured accent on the tile's
// leading edge, so the column's colour strip is still readable across a row.
//
// NO DRAG HERE, and that is a constraint, not an omission: framer's `Reorder`
// is one-dimensional (`axis: 'x' | 'y'`) and a wrapped grid is not. The
// keyboard verbs (↑/↓) and the tile menu are complete on their own; drag lives
// on the Lanes, Runway and Horizon boards, whose queues are one row or one
// column. A promotion still animates: the tile's `layoutId` follows it from
// its queued slot to its running one.

import { Fragment, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { useBoardRows } from '../useBoardRows';
import { QueueTile, QUEUE_TILE_W } from './QueueTile';
import type { QueueBoardProps } from './queueBoardTypes';
import type { QueueItem } from './useQueueModel';

export function RankedGridBoard({
  model, order, actions, teams, reducedMotion, focusKey, onOpenSession, onRecapSession,
}: QueueBoardProps) {
  const { t } = useTranslation();
  const teamColor = useMemo(() => new Map(teams.map((tm) => [tm.id, tm.color])), [teams]);
  const sequence = useMemo(() => [...model.running, ...order.items], [model.running, order.items]);
  const { boardRef, rows } = useBoardRows(sequence, true, QUEUE_TILE_W, 64);
  const queuedCount = order.items.length;
  const overFrom = model.cap > 0 ? model.cap : Number.POSITIVE_INFINITY;

  const tile = (item: QueueItem, runningIndex: number | null, queuedIndex: number | null) => {
    const color = item.teamId ? teamColor.get(item.teamId) : undefined;
    return (
      <motion.div
        key={item.sessionId}
        layoutId={reducedMotion ? undefined : `queue:${item.sessionId}`}
        initial={reducedMotion ? false : { opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
        transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 32 }}
        className="flex items-center gap-1"
        style={{ borderLeft: color ? `2px solid ${colorWithAlpha(color, 0.7)}` : undefined, paddingLeft: color ? 4 : 0 }}
      >
        <QueueTile
          item={item}
          actions={actions}
          onOpen={onOpenSession}
          onRecap={onRecapSession}
          onNudge={queuedIndex === null ? undefined : order.nudge}
          first={queuedIndex === 0}
          last={queuedIndex === queuedCount - 1}
          overAdmitted={runningIndex !== null && runningIndex >= overFrom}
          flash={focusKey === `s:${item.sessionId}`}
        />
      </motion.div>
    );
  };

  const runningCount = model.running.length;
  return (
    <div ref={boardRef} className="min-h-0 flex-1 overflow-auto p-3" aria-label={t.monitor.queue_reorder_aria} data-testid="fleet-queue-ranked">
      <AnimatePresence initial={false}>
        <div className="flex min-w-max flex-col gap-2">
          {rows.map((row, r) => (
            <Fragment key={r}>
              <div className="flex flex-shrink-0 items-start gap-2" data-testid="fleet-queue-ranked-row">
                {row.map((item, c) => {
                  const idx = r * (rows[0]?.length ?? 1) + c;
                  const running = idx < runningCount;
                  return tile(item, running ? idx : null, running ? null : idx - runningCount);
                })}
              </div>
            </Fragment>
          ))}
        </div>
      </AnimatePresence>
    </div>
  );
}

export default RankedGridBoard;
