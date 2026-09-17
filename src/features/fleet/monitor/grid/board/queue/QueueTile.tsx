// QueueTile — one session as the queue boards paint it.
//
// It keeps `SessionTile`'s visuals — short, hollow, state on the border from
// the canonical palette — and adds what a QUEUE needs to say about a row:
//
//   • a QUEUED row is dashed, carries its rank, a drag handle and ↑/↓ for the
//     keyboard, and a menu with the two verbs (Cancel, Start now), each behind
//     a `ConfirmDialog` because both are irreversible from the queue's side;
//   • a RUNNING row is solid, carries a lock in the handle's slot (it holds a
//     slot and is not in the queue — nothing here can move it), and opens its
//     terminal on click exactly as the classic tile does;
//   • both carry an origin chip: who asked for this session.
//
// The menu is a portalled `ContextMenu` anchored under the ⋯ button, not a
// hover popover: the tile lives inside clipped, transformed columns and
// lanes, where an in-flow menu would be cut off (same reason `PersonaTile`
// portals its right-click menu). The tile is never a control inside a
// control — the body is a button only when it opens a terminal, and the
// menu, the handle and the arrows are its siblings.

import { memo, useCallback, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { DragControls } from 'framer-motion';
import { ChevronDown, ChevronUp, Lock, MoreHorizontal, ScanEye, X, Zap } from 'lucide-react';
import type { DispatchOrigin } from '@/lib/bindings/DispatchOrigin';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useTranslation } from '@/i18n/useTranslation';
import { useFormattedDate } from '@/hooks/utility/data/useFormattedDate';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { DragHandle } from '@/features/shared/components/display/DragHandle';
import { ContextMenu, type ContextMenuItem } from '@/features/shared/components/overlays/ContextMenu';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { SESSION_BORDER, sessionLabel, sessionStateMeta } from '../../fleetSessionModel';
import type { QueueItem } from './useQueueModel';
import type { QueueActions } from './useQueueActions';

/** Wider than `TILE_W`: the rank, the handle, the chip and the menu need room. */
export const QUEUE_TILE_W = 232;
export const QUEUE_TILE_H = 30;

type Monitor = ReturnType<typeof useTranslation>['t']['monitor'];

export function originLabel(s: Monitor, origin: DispatchOrigin): string {
  switch (origin) {
    case 'dev_runner': return s.queue_origin_dev_runner;
    case 'dispatch_ideas': return s.queue_origin_dispatch_ideas;
    case 'athena': return s.queue_origin_athena;
    case 'autopilot': return s.queue_origin_autopilot;
    case 'night_shift': return s.queue_origin_night_shift;
    case 'feed_impact': return s.queue_origin_feed_impact;
    case 'orphan_resume': return s.queue_origin_orphan_resume;
    default: return s.queue_origin_manual;
  }
}

type Confirm = 'cancel' | 'start' | null;

export const QueueTile = memo(function QueueTile({
  item, width = QUEUE_TILE_W, height = QUEUE_TILE_H, flash = false, overAdmitted = false,
  onOpen, onRecap, actions, onNudge, first = false, last = false, dragControls, showRank = true,
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
  /** framer drag controls from the enclosing `Reorder.Item`; absent = no handle. */
  dragControls?: DragControls;
  showRank?: boolean;
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

  const border = overAdmitted ? 'border-status-warning' : SESSION_BORDER[session.state];
  const shell = `relative flex flex-shrink-0 items-center gap-1 overflow-hidden rounded-input border-[1.5px] pl-1 pr-0.5 ${
    queued ? 'border-dashed bg-foreground/[0.015]' : 'border-solid'
  } ${border} ${meta.chip} ${flash ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}`;

  const body = (
    <>
      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${meta.dot}`} aria-hidden />
      <span className={`min-w-0 flex-1 truncate typo-caption ${meta.text}`}>{label}</span>
    </>
  );

  const arrowBtn = 'focus-ring flex h-3 w-4 items-center justify-center rounded-interactive text-foreground opacity-50 hover:opacity-100 disabled:opacity-20';

  return (
    <div
      className={shell}
      style={{ width, height }}
      data-state={session.state}
      data-rank={item.rank ?? undefined}
      data-origin={item.origin}
      data-testid="fleet-queue-tile"
    >
      {/* Leading slot: the handle (queued, draggable) or the lock (running). */}
      {queued ? (
        dragControls ? (
          <DragHandle
            reveal="always"
            label={s.queue_drag_aria}
            className="touch-none"
            onPointerDown={(e: PointerEvent<HTMLSpanElement>) => dragControls.start(e)}
          />
        ) : null
      ) : (
        <Tooltip content={s.queue_locked}>
          <span className="inline-flex h-4 w-4 items-center justify-center text-foreground opacity-40" aria-label={s.queue_locked} role="img">
            <Lock className="h-3 w-3" aria-hidden />
          </span>
        </Tooltip>
      )}

      {queued && showRank && (
        <span
          className="inline-flex h-4 min-w-[18px] flex-shrink-0 items-center justify-center rounded-full bg-secondary/60 px-1 typo-caption font-semibold tabular-nums text-foreground"
          aria-label={item.rank !== null ? tx(s.queue_rank_aria, { rank: item.rank }) : s.queue_rank_unknown}
          data-testid="fleet-queue-rank"
        >
          {item.rank !== null ? tx(s.queue_rank, { rank: item.rank }) : '·'}
        </span>
      )}

      {/* The body: a terminal-opening button for a live row, an inert
          labelled span for a queued one (there is no PTY to open yet). */}
      {onOpen && item.locked ? (
        <Tooltip content={title}>
          <button
            type="button"
            onClick={() => onOpen(session)}
            aria-label={title}
            data-testid="fleet-queue-open"
            className="focus-ring flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-interactive px-1 text-left transition-colors hover:brightness-125"
          >
            {body}
          </button>
        </Tooltip>
      ) : (
        <Tooltip content={title}>
          <span role="img" aria-label={title} className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-1">
            {body}
          </span>
        </Tooltip>
      )}

      <span
        className="flex-shrink-0 rounded-full border border-border px-1 typo-caption leading-4 text-foreground opacity-60"
        data-testid="fleet-queue-origin"
      >
        {originLabel(s, item.origin)}
      </span>

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
    </div>
  );
});

export default QueueTile;
