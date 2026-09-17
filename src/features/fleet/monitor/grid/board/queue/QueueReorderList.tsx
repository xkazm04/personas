// QueueReorderList — the queued rows as a framer `Reorder.Group`.
//
// One list, two axes: the Lanes board stacks it (`y`), the Runway and Horizon
// boards run it along a strip (`x`). Drag starts from the tile's handle only
// (`dragListener={false}` + `useDragControls`, the pattern the Schedules
// orchestration editor used before it moved here), so a click on the menu, the
// arrows or the body never begins a drag. `Reorder` reports the whole new id
// order on every frame — the local order paints it — and the drop commits it
// to the door once. `layoutId` per session id lets a promotion or a reorder
// slide a tile between places and between lists rather than pop it; reduced
// motion turns the layout animation off.

import { Reorder, useDragControls } from 'framer-motion';
import type { CSSProperties, ReactNode } from 'react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { QueueTile } from './QueueTile';
import type { QueueItem } from './useQueueModel';
import type { QueueActions } from './useQueueActions';
import type { LocalOrder } from './useLocalOrder';

function Row({
  item, index, count, order, actions, reducedMotion, focusKey, onOpen, onRecap, style, accentColor, children,
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
  style?: CSSProperties;
  accentColor?: string;
  children?: ReactNode;
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
      style={style}
      data-testid="fleet-queue-row"
    >
      {children}
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
        />
      </span>
    </Reorder.Item>
  );
}

export function QueueReorderList({
  order, actions, axis, reducedMotion, focusKey, onOpen, onRecap, className, ariaLabel, itemStyle, accentFor, decorate,
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
  /** Per-item positioning (the Horizon's time gaps). */
  itemStyle?: (item: QueueItem, index: number) => CSSProperties | undefined;
  /** A team colour for the leading accent, when the board knows one. */
  accentFor?: (item: QueueItem) => string | undefined;
  /** Something drawn above the tile (the Horizon's time label). */
  decorate?: (item: QueueItem) => ReactNode;
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
            style={itemStyle?.(item, i)}
            accentColor={accentFor?.(item)}
          >
            {decorate?.(item)}
          </Row>
        );
      })}
    </Reorder.Group>
  );
}

export default QueueReorderList;
