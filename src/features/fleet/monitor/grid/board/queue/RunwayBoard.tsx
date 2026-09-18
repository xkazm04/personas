// RunwayBoard — the cap made visible: exactly `cap` slots, then the queue.
//
// The RUNNING band has as many slots as the cap says, filled oldest-first;
// an unfilled slot is a ghost card, so "three free slots" is something you
// count rather than compute. A live row past the cap (a Start now) is
// appended AFTER the band with a warning border: it is running, it is over
// the line, and the band's arithmetic should not hide that.
//
// THE QUEUE WRAPS. It was one strip on the `x` axis — a taxiway that put the
// thirtieth queued session four screens to the right of the first and made
// "what is waiting" a question you answered by scrolling sideways. It is now
// a grid in rank order, left → right then top → bottom, wrapping at whatever
// count fits the board's width by the same ResizeObserver discipline the
// classic board runs (`useBoardRows`, measured with the node's own width and
// no five-column ceiling), so there is no horizontal scroll at any width.
//
// A wrapped grid is two-dimensional and framer's `Reorder` is not, so the
// reorder is NATIVE HTML5 DRAG (`draggable`, `onDragStart/Over/Drop` — the
// shape `shared/components/kanban/KanbanBoard` runs): the drop lands before
// or after the node under the pointer by which half of it the pointer is on,
// and `dropPayload` turns that into the full ordered id list the door takes.
// ↑/↓ on the node stay the keyboard alternative. Every node carries the same
// `layoutId` it has on the other boards, so a drop or a promotion slides the
// node to its new slot rather than popping it; reduced motion turns that off.

import { Fragment, useCallback, useMemo, useState, type DragEvent } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { BOARD_GAP, QUEUE_TILE_H, QUEUE_TILE_W } from '../../gridGeometry';
import { useBoardRows } from '../useBoardRows';
import { QueueTile } from './QueueTile';
import type { QueueBoardProps } from './queueBoardTypes';
import type { QueueItem } from './useQueueModel';

const DRAG_MIME = 'application/x-personas-queue-session';
/** No practical ceiling — the width decides. */
const MAX_PER_ROW = 64;

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

/** Which side of the node the pointer is on: the left half drops before it. */
export function dropBefore(clientX: number, rect: { left: number; width: number }): boolean {
  return clientX < rect.left + rect.width / 2;
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
  const spring = reducedMotion ? { duration: 0 } : { type: 'spring' as const, stiffness: 400, damping: 32 };

  // The wrap point, from the scroller's width — the queue rows share it.
  const { boardRef, rows } = useBoardRows(order.items, true, QUEUE_TILE_W, MAX_PER_ROW);

  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<{ id: string; before: boolean } | null>(null);

  const onDragStart = useCallback((e: DragEvent<HTMLElement>, id: string) => {
    e.dataTransfer.setData(DRAG_MIME, id);
    e.dataTransfer.effectAllowed = 'move';
    setDragging(id);
  }, []);
  const onDragOver = useCallback((e: DragEvent<HTMLElement>, id: string) => {
    if (!dragging || dragging === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const before = dropBefore(e.clientX, e.currentTarget.getBoundingClientRect());
    setTarget((prev) => (prev && prev.id === id && prev.before === before ? prev : { id, before }));
  }, [dragging]);
  const onDrop = useCallback((e: DragEvent<HTMLElement>, id: string) => {
    e.preventDefault();
    const fromId = e.dataTransfer.getData(DRAG_MIME) || dragging;
    const before = dropBefore(e.clientX, e.currentTarget.getBoundingClientRect());
    // Clear here as well as on `dragend`: the dragged element re-keys into a
    // new slot on drop, and its own `dragend` may never fire.
    setDragging(null);
    setTarget(null);
    if (fromId && fromId !== id) order.place(fromId, id, before);
  }, [dragging, order]);
  const onDragEnd = useCallback(() => { setDragging(null); setTarget(null); }, []);

  const queuedCount = order.items.length;
  const queuedNode = (item: QueueItem, index: number) => {
    const color = item.teamId ? teamColor.get(item.teamId) : undefined;
    const isTarget = target?.id === item.sessionId;
    return (
      // The motion element owns the LAYOUT animation only; the native drag
      // lives on a plain child, because a motion component redefines
      // `onDragStart` / `onDragEnd` as its own pan gesture and would never
      // hand the browser's `dragstart` through.
      <motion.div
        key={item.sessionId}
        role="listitem"
        layout={!reducedMotion}
        layoutId={reducedMotion ? undefined : `queue:${item.sessionId}`}
        transition={spring}
        className="relative flex flex-shrink-0"
      >
        <div
          draggable
          onDragStart={(e) => onDragStart(e, item.sessionId)}
          onDragOver={(e) => onDragOver(e, item.sessionId)}
          onDrop={(e) => onDrop(e, item.sessionId)}
          onDragEnd={onDragEnd}
          data-testid="fleet-queue-row"
          data-drop={isTarget ? (target!.before ? 'before' : 'after') : undefined}
          className={`relative flex items-center gap-1 ${
            dragging === item.sessionId ? 'cursor-grabbing opacity-40' : 'cursor-grab'
          }`}
          style={{ borderLeft: color ? `2px solid ${colorWithAlpha(color, 0.7)}` : undefined, paddingLeft: color ? 4 : 0 }}
        >
          {/* The drop marker: a hairline on the side the row will land on. */}
          {isTarget && (
            <span
              aria-hidden
              className={`absolute inset-y-0 w-0.5 rounded-full bg-primary ${target!.before ? '-left-1.5' : '-right-1.5'}`}
            />
          )}
          <QueueTile
            item={item}
            actions={actions}
            onNudge={order.nudge}
            first={index === 0}
            last={index === queuedCount - 1}
            dragHandle
            flash={focusKey === `s:${item.sessionId}`}
          />
        </div>
      </motion.div>
    );
  };

  return (
    <LayoutGroup>
      <div ref={boardRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden p-3" data-testid="fleet-queue-runway">
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
          <div className="flex flex-wrap" style={{ gap: BOARD_GAP }} data-testid="fleet-queue-running-band">
            {inBand.map((item) => (
              <motion.div key={item.sessionId} layoutId={reducedMotion ? undefined : `queue:${item.sessionId}`} transition={spring}>
                <QueueTile item={item} actions={actions} onOpen={onOpenSession} onRecap={onRecapSession} flash={focusKey === `s:${item.sessionId}`} />
              </motion.div>
            ))}
            {Array.from({ length: free }, (_, i) => <FreeSlot key={`free-${i}`} label={s.queue_slot_free} />)}
            {over.map((item) => (
              <motion.div key={item.sessionId} layoutId={reducedMotion ? undefined : `queue:${item.sessionId}`} transition={spring}>
                <QueueTile item={item} actions={actions} onOpen={onOpenSession} onRecap={onRecapSession} overAdmitted flash={focusKey === `s:${item.sessionId}`} />
              </motion.div>
            ))}
          </div>
        </AnimatePresence>

        <div className="mt-4 mb-1.5 flex items-center gap-2 border-t border-border/60 pt-3">
          <span className="typo-label text-foreground">{s.queue_band_queued}</span>
          <span className="typo-caption tabular-nums text-foreground opacity-60"><Numeric value={queuedCount} /></span>
        </div>
        {queuedCount > 0 ? (
          <div
            role="list"
            aria-label={s.queue_reorder_aria}
            className="flex min-w-0 flex-col"
            style={{ gap: BOARD_GAP }}
            data-testid="fleet-queue-strip"
          >
            {rows.map((row, r) => (
              <Fragment key={r}>
                <div className="flex min-w-0 flex-shrink-0 items-start" style={{ gap: BOARD_GAP }} data-testid="fleet-queue-strip-row">
                  {row.map((item, c) => queuedNode(item, r * (rows[0]?.length ?? 1) + c))}
                </div>
              </Fragment>
            ))}
          </div>
        ) : (
          <p className="typo-caption text-foreground opacity-50">{s.queue_strip_empty}</p>
        )}
      </div>
    </LayoutGroup>
  );
}

export default RunwayBoard;
