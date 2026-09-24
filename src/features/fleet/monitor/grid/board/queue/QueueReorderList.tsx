// QueueReorderList — the queued rows as a framer `Reorder.Group`.
//
// The Lanes board's queued column (`axis: 'y'`). The Runway's queue used to be
// this list on the `x` axis; it is a wrapped grid now, and framer's `Reorder`
// is one-dimensional, so the runway reorders with native HTML5 drag instead
// (`RunwayBoard`). Drag here starts from the tile's handle only
// (`dragListener={false}` + `useDragControls`, the pattern the Schedules
// orchestration editor used before it moved here), so a click on the menu, the
// arrows or the body never begins a drag. `Reorder` reports the whole new id
// order on every frame — the local order paints it — and the drop commits it
// to the door once. `layoutId` per session id lets a promotion or a reorder
// slide a tile between places and between lists rather than pop it; reduced
// motion turns the layout animation off.

import { Reorder, useDragControls } from 'framer-motion';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { QueueTile } from './QueueTile';
import type { QueueItem } from './useQueueModel';
import type { QueueActions } from './useQueueActions';
import type { LocalOrder } from './useLocalOrder';

function Row({
  item, index, count, order, actions, reducedMotion, focusKey, onOpen, onRecap, accentColor, fill,
}: {
  item: QueueItem;
  index: number;
  count: number;
  order: LocalOrder;
  actions: QueueActions;
  reducedMotion: boolean;
  focusKey: string | null;
  onOpen: (s: FleetSession) => void;
  onRecap: (s: FleetSession) => void;
  accentColor?: string;
  fill: boolean;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={item.sessionId}
      dragListener={false}
      dragControls={controls}
      onDragEnd={order.commit}
      layoutId={reducedMotion ? undefined : `queue:${item.sessionId}`}
      transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 32 }}
      className="group relative flex flex-shrink-0 flex-col"
      data-testid="fleet-queue-row"
    >
      <span className="flex items-center gap-1">
        {accentColor && <span aria-hidden className="h-4 w-0.5 flex-shrink-0 rounded-full" style={{ backgroundColor: accentColor }} />}
        <QueueTile
          item={item}
          actions={actions}
          onOpen={onOpen}
          onRecap={onRecap}
          onNudge={order.nudge}
          first={index === 0}
          last={index === count - 1}
          dragControls={controls}
          flash={focusKey === `s:${item.sessionId}`}
          fill={fill}
        />
      </span>
    </Reorder.Item>
  );
}

export function QueueReorderList({
  order, actions, axis, reducedMotion, focusKey, onOpen, onRecap, className, ariaLabel, accentFor, fill = false,
}: {
  order: LocalOrder;
  actions: QueueActions;
  axis: 'x' | 'y';
  reducedMotion: boolean;
  focusKey: string | null;
  onOpen: (s: FleetSession) => void;
  onRecap: (s: FleetSession) => void;
  className?: string;
  ariaLabel: string;
  /** A team colour for the leading accent, when the board knows one. */
  accentFor?: (item: QueueItem) => string | undefined;
  /**
   * Tiles span the row (beside the optional accent bar) instead of the fixed
   * node width. Only the Lanes board opts in; every other board keeps
   * fixed-width nodes.
   */
  fill?: boolean;
}) {
  const ids = order.items.map((i) => i.sessionId);
  const byId = new Map(order.items.map((i) => [i.sessionId, i]));
  return (
    <Reorder.Group
      as="ul"
      axis={axis}
      values={ids}
      onReorder={order.setOrder}
      aria-label={ariaLabel}
      className={className}
      data-testid="fleet-queue-list"
    >
      {ids.map((id, i) => {
        const item = byId.get(id)!;
        return (
          <Row
            key={id}
            item={item}
            index={i}
            count={ids.length}
            order={order}
            actions={actions}
            reducedMotion={reducedMotion}
            focusKey={focusKey}
            onOpen={onOpen}
            onRecap={onRecap}
            accentColor={accentFor?.(item)}
            fill={fill}
          />
        );
      })}
    </Reorder.Group>
  );
}

export default QueueReorderList;
