// QueueTile — one session as the queue boards paint it: the verbs around a node.
//
// A THIN WRAPPER over `board/node/FleetNode` (which paints the shared two-row
// node, and reads the rank, the ETA, the origin and the gate from `item` into
// its symbol row). What this wrapper adds is what a QUEUE needs to DO with a
// row — its AFFORDANCES, handed to the node as `symbols`, which the node
// reveals at the symbol row's right end on hover or focus-within:
//
//   • a QUEUED row carries a drag grip (when a list drives it — framer's
//     `Reorder` on the Lanes board, or native HTML5 drag on the Runway's
//     wrapped grid), ↑/↓ for the keyboard, Cancel and Start now as direct
//     buttons, and the ⋯ menu with the same two verbs — each verb behind a
//     `ConfirmDialog` because both are irreversible from the queue's side;
//   • a RUNNING row carries a lock (it holds a slot and is not in the queue —
//     nothing here can move it), opens its terminal on click exactly as the
//     classic tile does, and offers the recap.
//
// The menu is a portalled `ContextMenu` anchored under the ⋯ button, not a
// hover popover: the tile lives inside clipped, transformed columns and
// lanes, where an in-flow menu would be cut off. Every control here is a
// SIBLING of the node's body, never a child, and every one of them is a
// button — keyboard reach is unchanged.

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
import { AFFORDANCE_BTN, FleetNode } from '../node/FleetNode';
import { originLabel } from './originLabel';
import type { QueueItem } from './useQueueModel';
import type { QueueActions } from './useQueueActions';

type Confirm = 'cancel' | 'start' | null;

export const QueueTile = memo(function QueueTile({
  item, width = QUEUE_TILE_W, height = QUEUE_TILE_H, fill = false, flash = false, overAdmitted = false,
  onOpen, onRecap, actions, onNudge, first = false, last = false, dragControls, dragHandle = false,
}: {
  item: QueueItem;
  width?: number;
  height?: number;
  /** Span the parent's width instead of `width` — the Lanes board opts in. */
  fill?: boolean;
  /** Athena pointed at this node — ring it until the board clears the signal. */
  flash?: boolean;
  /** A live row sitting past the cap after a Start now — warning frame. */
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
  /** framer drag controls from the enclosing `Reorder.Item`; the grip starts them. */
  dragControls?: DragControls;
  /** The enclosing element is natively `draggable`; show the grip. */
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
    tx(s.node_symbol_origin, { origin: originLabel(s, item.origin) }),
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

  // The grip (queued, when something drives a drag) or the lock (running)
  // leads the cluster; the verbs follow, the menu last.
  const grip = queued ? (
    dragControls ? (
      <DragHandle
        reveal="always"
        label={s.queue_drag_aria}
        className="h-4 w-4 touch-none"
        onPointerDown={(e: PointerEvent<HTMLSpanElement>) => dragControls.start(e)}
      />
    ) : dragHandle ? (
      <DragHandle reveal="always" label={s.queue_drag_aria} className="h-4 w-4" />
    ) : null
  ) : (
    <Tooltip content={s.queue_locked}>
      <span className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center text-foreground opacity-70" aria-label={s.queue_locked} role="img" data-testid="fleet-queue-lock">
        <Lock className="h-2.5 w-2.5" aria-hidden />
      </span>
    </Tooltip>
  );

  const affordances = (
    <>
      {grip}

      {item.locked && onRecap && (
        <Tooltip content={s.grid_session_recap_open}>
          <button type="button" onClick={() => onRecap(session)} aria-label={s.grid_session_recap_open} data-testid="fleet-queue-recap" className={AFFORDANCE_BTN}>
            <ScanEye className="h-2.5 w-2.5" aria-hidden />
          </button>
        </Tooltip>
      )}

      {queued && onNudge && (
        <>
          <Tooltip content={s.queue_move_up}>
            <button type="button" className={AFFORDANCE_BTN} disabled={first} onClick={() => onNudge(item.sessionId, -1)} aria-label={s.queue_move_up} data-testid="fleet-queue-up">
              <ChevronUp className="h-2.5 w-2.5" aria-hidden />
            </button>
          </Tooltip>
          <Tooltip content={s.queue_move_down}>
            <button type="button" className={AFFORDANCE_BTN} disabled={last} onClick={() => onNudge(item.sessionId, 1)} aria-label={s.queue_move_down} data-testid="fleet-queue-down">
              <ChevronDown className="h-2.5 w-2.5" aria-hidden />
            </button>
          </Tooltip>
        </>
      )}

      {queued && (
        <>
          <Tooltip content={s.queue_start_now}>
            <button type="button" onClick={() => setConfirm('start')} aria-label={s.queue_start_now} data-testid="fleet-queue-start-now" className={AFFORDANCE_BTN}>
              <Zap className="h-2.5 w-2.5" aria-hidden />
            </button>
          </Tooltip>
          <Tooltip content={s.queue_cancel}>
            <button type="button" onClick={() => setConfirm('cancel')} aria-label={s.queue_cancel} data-testid="fleet-queue-cancel" className={`${AFFORDANCE_BTN} hover:text-status-error`}>
              <X className="h-2.5 w-2.5" aria-hidden />
            </button>
          </Tooltip>
          <button
            ref={menuBtn}
            type="button"
            onClick={openMenu}
            aria-haspopup="menu"
            aria-expanded={menu !== null}
            aria-label={tx(s.queue_menu_aria, { name: label })}
            data-testid="fleet-queue-menu"
            className={AFFORDANCE_BTN}
          >
            <MoreHorizontal className="h-2.5 w-2.5" aria-hidden />
          </button>
        </>
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
        fill={fill}
        flash={flash}
        symbols={affordances}
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
