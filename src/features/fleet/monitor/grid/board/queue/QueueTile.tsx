// QueueTile — one session as the queue boards paint it: the verbs around a node.
//
// A THIN WRAPPER over `board/node/FleetNode` (which paints the shared two-row
// node, and reads the rank, the ETA, the origin and the gate from `item`).
// What this wrapper adds is what a QUEUE needs to DO with a row:
//
//   • a QUEUED row carries a drag handle (when a list drives it — framer's
//     `Reorder` on the Lanes board, or native HTML5 drag on the Runway's
//     wrapped grid), ↑/↓ for the keyboard, and a menu with the two verbs
//     (Cancel, Start now), each behind a `ConfirmDialog` because both are
//     irreversible from the queue's side;
//   • a RUNNING row carries a lock in the handle's slot (it holds a slot and
//     is not in the queue — nothing here can move it), opens its terminal on
//     click exactly as the classic tile does, and offers the recap.
//
// The menu is a portalled `ContextMenu` anchored under the ⋯ button, not a
// hover popover: the tile lives inside clipped, transformed columns and
// lanes, where an in-flow menu would be cut off. Every control here is a
// SIBLING of the node's body, never a child.

import { memo, useCallback, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { DragControls } from 'framer-motion';
import { ChevronDown, ChevronUp, Lock, MoreHorizontal, ScanEye, X, Zap } from 'lucide-react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useTranslation } from '@/i18n/useTranslation';
import { useFormattedDate } from '@/hooks/utility/data/useFormattedDate';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { DragHandle } from '@/features/shared/components/display/DragHandle';
import { ContextMenu, type ContextMenuItem } from '@/features/shared/components/overlays/ContextMenu';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { sessionLabel, sessionStateMeta } from '../../fleetSessionModel';
import { QUEUE_TILE_H, QUEUE_TILE_W } from '../../gridGeometry';
import { FleetNode } from '../node/FleetNode';
import type { QueueItem } from './useQueueModel';
import type { QueueActions } from './useQueueActions';

type Confirm = 'cancel' | 'start' | null;

export const QueueTile = memo(function QueueTile({
  item, width = QUEUE_TILE_W, height = QUEUE_TILE_H, flash = false, overAdmitted = false,
  onOpen, onRecap, actions, onNudge, first = false, last = false, dragControls, dragHandle = false,
}: {
  item: QueueItem;
  width?: number;
  height?: number;
  /** Athena pointed at this node — ring it until the board clears the signal. */
  flash?: boolean;
  /** A live row sitting past the cap after a Start now — warning border. */
  overAdmitted?: boolean;
  /** Open this session's terminal (running rows only). */
  onOpen?: (session: FleetSession) => void;
  /** Open the session's recap (running rows only). */
  onRecap?: (session: FleetSession) => void;
  actions: QueueActions;
  /** ↑ / ↓ — the keyboard alternative to dragging. Absent = no arrows. */
  onNudge?: (sessionId: string, delta: -1 | 1) => void;
  first?: boolean;
  last?: boolean;
  /** framer drag controls from the enclosing `Reorder.Item`; the handle starts them. */
  dragControls?: DragControls;
  /** The enclosing element is natively `draggable`; show the handle as the grip. */
  dragHandle?: boolean;
}) {
  const { t, tx } = useTranslation();
  const s = t.monitor;
  const { session } = item;
  const meta = sessionStateMeta(session.state);
  const stateLabel = t.plugins.fleet[meta.labelKey];
  const label = sessionLabel(session);
  const queued = !item.locked;
  const estimated = useFormattedDate(item.estimatedStartMs, { timeStyle: 'short' });
  const notBefore = useFormattedDate(item.notBeforeMs, { timeStyle: 'short' });

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const openMenu = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ x: r.left, y: r.bottom + 2 });
  }, []);

  const lines = [
    [label, stateLabel, session.projectLabel].filter(Boolean).join(' · '),
    ...(queued && item.rank !== null ? [tx(s.queue_rank_aria, { rank: item.rank })] : []),
    ...(queued ? [item.estimatedStartMs !== null ? tx(s.queue_estimated_start, { time: estimated }) : s.queue_no_estimate] : []),
    ...(item.notBeforeMs !== null && item.notBeforeMs > Date.now() ? [tx(s.queue_not_before, { time: notBefore })] : []),
    ...(item.locked ? [s.queue_locked] : []),
    ...(overAdmitted ? [s.queue_over_admitted] : []),
  ];
  const title = lines.join('\n');

  const menuItems: ContextMenuItem[] = [
    { id: 'start-now', label: s.queue_start_now, icon: <Zap className="h-3.5 w-3.5" />, onSelect: () => setConfirm('start') },
    { id: 'cancel', label: s.queue_cancel, icon: <X className="h-3.5 w-3.5" />, danger: true, separatorBefore: true, onSelect: () => setConfirm('cancel') },
  ];

  const arrowBtn = 'focus-ring flex h-3 w-4 items-center justify-center rounded-interactive text-foreground opacity-50 hover:opacity-100 disabled:opacity-20';

  // Leading slot: the handle (queued, when something drives a drag) or the
  // lock (running).
  const leading = queued ? (
    dragControls ? (
      <DragHandle
        reveal="always"
        label={s.queue_drag_aria}
        className="touch-none"
        onPointerDown={(e: PointerEvent<HTMLSpanElement>) => dragControls.start(e)}
      />
    ) : dragHandle ? (
      <DragHandle reveal="always" label={s.queue_drag_aria} />
    ) : null
  ) : (
    <Tooltip content={s.queue_locked}>
      <span className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center text-foreground opacity-40" aria-label={s.queue_locked} role="img">
        <Lock className="h-3 w-3" aria-hidden />
      </span>
    </Tooltip>
  );

  const trailing = (
    <>
      {item.locked && onRecap && (
        <Tooltip content={s.grid_session_recap_open}>
          <button
            type="button"
            onClick={() => onRecap(session)}
            aria-label={s.grid_session_recap_open}
            className="focus-ring flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-foreground opacity-40 transition-opacity hover:opacity-100 focus-visible:opacity-100"
          >
            <ScanEye className="h-3 w-3" aria-hidden />
          </button>
        </Tooltip>
      )}

      {queued && onNudge && (
        <span className="inline-flex flex-shrink-0 flex-col">
          <button type="button" className={arrowBtn} disabled={first} onClick={() => onNudge(item.sessionId, -1)} aria-label={s.queue_move_up}>
            <ChevronUp className="h-2.5 w-2.5" aria-hidden />
          </button>
          <button type="button" className={arrowBtn} disabled={last} onClick={() => onNudge(item.sessionId, 1)} aria-label={s.queue_move_down}>
            <ChevronDown className="h-2.5 w-2.5" aria-hidden />
          </button>
        </span>
      )}

      {queued && (
        <button
          ref={menuBtn}
          type="button"
          onClick={openMenu}
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          aria-label={tx(s.queue_menu_aria, { name: label })}
          data-testid="fleet-queue-menu"
          className="focus-ring flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-foreground opacity-50 transition-opacity hover:opacity-100 focus-visible:opacity-100"
        >
          <MoreHorizontal className="h-3 w-3" aria-hidden />
        </button>
      )}
    </>
  );

  return (
    <>
      <FleetNode
        kind="session"
        session={session}
        queue={item}
        overAdmitted={overAdmitted}
        width={width}
        height={height}
        flash={flash}
        leading={leading}
        trailing={trailing}
        // A terminal-opening body for a live row; an inert labelled body for a
        // queued one (there is no PTY to open yet).
        onActivate={onOpen && item.locked ? () => onOpen(session) : undefined}
        ariaLabel={title}
        tooltip={<span className="whitespace-pre-line">{title}</span>}
        bodyTestId={onOpen && item.locked ? 'fleet-queue-open' : undefined}
        testId="fleet-queue-tile"
        data={{ state: session.state, rank: item.rank ?? undefined, origin: item.origin }}
      />

      {menu && createPortal(
        <ContextMenu x={menu.x} y={menu.y} onClose={closeMenu} ariaLabel={tx(s.queue_menu_aria, { name: label })} widthClass="w-44" items={menuItems} />,
        document.body,
      )}

      {confirm === 'cancel' && (
        <ConfirmDialog
          title={s.queue_cancel_title}
          body={tx(s.queue_cancel_body, { name: label })}
          danger
          confirmLabel={s.queue_cancel}
          onConfirm={async () => { if (await actions.cancel(item.sessionId)) setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === 'start' && (
        <ConfirmDialog
          title={s.queue_start_now_title}
          body={tx(s.queue_start_now_body, { name: label })}
          confirmLabel={s.queue_start_now}
          onConfirm={async () => { if (await actions.startNow(item.sessionId)) setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
});

export default QueueTile;
