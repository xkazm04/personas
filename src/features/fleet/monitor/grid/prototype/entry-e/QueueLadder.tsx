// The queue as a LADDER you can rearrange by hand. Rank is a numeral read
// across the room; the wait is drawn (a bar against the longest wait, the
// not-before gate a fence on it). Drag a rung by its grip to reorder - the
// others make room as it moves, the lifted rung is ringed, and the new order
// is sent once on release. The arrows stay as the keyboard way (Alt+Up/Down
// on a focused rung too); Start now and Cancel go through the confirms.
// While the panel is filtered the ladder shows a subset, so dragging is off:
// a subset has no honest "between" to drop into.

import { memo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { DragHandle } from '@/features/shared/components/display/DragHandle';
import type { QueueItem } from '../../board/queue/useQueueModel';
import type { LocalOrder } from '../../board/queue/useLocalOrder';
import { QueueRung } from './QueueRung';

function Item({
  item, index, total, maxWait, now, compact, flash, order, reducedMotion, onStart, onCancel,
}: {
  item: QueueItem; index: number; total: number; maxWait: number; now: number; compact: boolean; flash: boolean;
  order: LocalOrder; reducedMotion: boolean; onStart: (i: QueueItem) => void; onCancel: (i: QueueItem) => void;
}) {
  const { t } = useTranslation();
  const controls = useDragControls();
  const [lifted, setLifted] = useState(false);
  const onKey = (e: KeyboardEvent<HTMLLIElement>) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    order.nudge(item.sessionId, e.key === 'ArrowUp' ? -1 : 1);
  };
  return (
    <Reorder.Item
      value={item.sessionId}
      dragListener={false}
      dragControls={controls}
      onDragStart={() => setLifted(true)}
      onDragEnd={() => { setLifted(false); order.commit(); }}
      onKeyDown={onKey}
      whileDrag={{ scale: reducedMotion ? 1 : 1.01, zIndex: 5 }}
      transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
      className="relative list-none"
      data-testid="fleet-queue-row"
      data-rank={item.rank ?? index + 1}
    >
      <QueueRung
        item={item}
        index={index}
        total={total}
        maxWait={maxWait}
        now={now}
        compact={compact}
        flash={flash}
        onNudge={order.nudge}
        onStart={onStart}
        onCancel={onCancel}
        lifted={lifted}
        grip={(
          <DragHandle
            reveal="always"
            label={t.monitor.queue_drag_aria}
            className="h-6 w-4 flex-shrink-0 touch-none"
            onPointerDown={(e: PointerEvent<HTMLSpanElement>) => controls.start(e)}
            data-testid="entry-e-queue-grip"
          />
        )}
      />
    </Reorder.Item>
  );
}

export const QueueLadder = memo(function QueueLadder({
  order, items: shown, now, compact = false, focusKey, reducedMotion, draggable, onStart, onCancel,
}: {
  order: LocalOrder;
  /** The rungs to paint - `order.items`, or the filtered subset of it. */
  items: QueueItem[];
  now: number;
  compact?: boolean;
  focusKey: string | null;
  reducedMotion: boolean;
  /** False while the panel is filtered. */
  draggable: boolean;
  onStart: (item: QueueItem) => void;
  onCancel: (item: QueueItem) => void;
}) {
  const { t } = useTranslation();
  const maxWait = shown.reduce((mx, i) => Math.max(
    mx,
    i.estimatedStartMs !== null ? i.estimatedStartMs - now : 0,
    i.notBeforeMs !== null ? i.notBeforeMs - now : 0,
  ), 0);
  const rung = (item: QueueItem, i: number) => ({
    item, index: i, total: shown.length, maxWait, now, compact, flash: focusKey === `s:${item.sessionId}`, onStart, onCancel,
  });

  if (!draggable) {
    return (
      <ul aria-label={t.monitor.queue_reorder_aria} className={`flex flex-col ${compact ? '' : 'gap-1.5'}`} data-testid="fleet-queue-strip">
        {shown.map((item, i) => (
          <li key={item.sessionId} className="list-none" data-testid="fleet-queue-row" data-rank={item.rank ?? i + 1}>
            <QueueRung {...rung(item, i)} onNudge={order.nudge} grip={null} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Reorder.Group
      as="ul"
      axis="y"
      values={shown.map((i) => i.sessionId)}
      onReorder={order.setOrder}
      aria-label={t.monitor.queue_reorder_aria}
      className={`flex flex-col ${compact ? '' : 'gap-1.5'}`}
      data-testid="fleet-queue-strip"
    >
      {shown.map((item, i) => (
        <Item key={item.sessionId} {...rung(item, i)} order={order} reducedMotion={reducedMotion} />
      ))}
    </Reorder.Group>
  );
});
