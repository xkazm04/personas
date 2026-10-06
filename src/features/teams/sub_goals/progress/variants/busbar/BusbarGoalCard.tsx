/**
 * One goal as a Busbar terminal card: status glyph and word, its `#NN` down
 * the sheet, the title, a twenty-cell meter and a FIN / DUE stamp, hung from
 * its rail on a wire with a junction dot (a dashed stub with an open ring on
 * the open bus, an elbow from its parent when it is a sub-goal).
 *
 * Pointer: click puts the cursor on it, double-click opens the goal drawer,
 * drag re-binds it, right-click opens the shared canvas menu. Keyboard: the
 * sheet's key grammar (useBusbarKeys) drives the cursor; Shift+F10 / the Menu
 * key reach the same menu through `useMenuKey`.
 */
import { memo, useEffect, useRef, type CSSProperties } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import { goalStatusLabel, goalStatusMeta, isComplete } from '../../../goalStatus';
import { useProgressView } from '../../canvasHost';
import { useMenuKey } from '../../rowCanvas';
import { goalPct, statusInk, type BusGoal } from './busbarModel';
import { Meter, shortDay } from './busbarParts';
import type { BusFlash } from './useBusbarState';

export interface BusbarGoalCardProps {
  bus: BusGoal;
  projectId: string;
  /** Rail ink; the open bus passes its own. */
  ink: string;
  onOpenBus: boolean;
  /** Where it hangs, already worded, for the accessible name. */
  where: string;
  isCursor: boolean;
  isMarked: boolean;
  flash: BusFlash | undefined;
  navTick: number;
  onCursor: (goalId: string) => void;
}

export const BusbarGoalCard = memo(function BusbarGoalCard({
  bus,
  projectId,
  ink,
  onOpenBus,
  where,
  isCursor,
  isMarked,
  flash,
  navTick,
  onCursor,
}: BusbarGoalCardProps) {
  const { tx, language } = useTranslation();
  const { canvas, openGoal, dl } = useProgressView();
  const { goal, overdue } = bus.node;
  const ref = useRef<HTMLDivElement>(null);
  const { onKeyDown, onContextMenu } = useMenuKey((e) =>
    canvas.openMenu(e, { kind: 'goal', goalId: goal.id, projectId, name: goal.title }),
  );

  // Follow the keyboard: a cursor move a person made focuses this card and
  // brings it into view. `navTick` is 0 on mount, so the view opening never
  // steals focus or scrolls.
  useEffect(() => {
    if (!isCursor || navTick === 0) return;
    ref.current?.focus({ preventScroll: true });
    ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [isCursor, navTick]);

  const meta = goalStatusMeta(goal.status);
  const Icon = meta.icon;
  const done = isComplete(goal.status);
  const pct = goalPct(goal);
  const status = goalStatusLabel(dl, goal.status);
  const day = shortDay(done ? (goal.completed_at ?? goal.target_date) : goal.target_date, language);
  const stampCls = day ? (done ? 'fin' : overdue ? 'late' : 'due') : 'none';
  const dragging = canvas.drag.draggingId === goal.id;
  const cls = [
    'bb-card',
    isCursor && 'is-cursor',
    isMarked && 'is-marked',
    done && 'is-done',
    dragging && 'is-dragging',
    onOpenBus && 'on-open',
    bus.sub && 'is-sub',
    flash === 'bind' && 'is-wired',
    flash === 'unbind' && 'is-cut',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={isCursor ? 0 : -1}
      aria-pressed={isMarked}
      aria-label={tx(dl.busbar_card_aria, { title: goal.title, status, pct, where })}
      data-testid={`busbar-goal-${goal.id}`}
      data-busbar-goal={goal.id}
      className={cls}
      style={{ '--h': ink, '--sc': statusInk(goal.status) } as CSSProperties}
      draggable
      onDragStart={(e) => canvas.drag.onDragStart(e, goal.id)}
      onDragEnd={canvas.drag.onDragEnd}
      onClick={() => onCursor(goal.id)}
      onDoubleClick={() => openGoal(goal.id)}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
    >
      <span className="bb-wire" aria-hidden="true" />
      <span className="bb-k a" aria-hidden="true" />
      <span className="bb-k b" aria-hidden="true" />
      {flash === 'unbind' && <span className="bb-spark" aria-hidden="true" />}

      <div className="bb-ph">
        <Icon className="bb-sc w-3.5 h-3.5 shrink-0" />
        <span className="bb-sc bb-mono typo-data uppercase truncate">{status}</span>
        <span className="bb-dim bb-mono typo-data ml-auto tabular-nums">
          #{String(bus.number).padStart(2, '0')}
        </span>
      </div>
      <div className="typo-body-lg leading-snug text-foreground line-clamp-2 mt-px mb-1 [overflow-wrap:anywhere]">{goal.title}</div>
      <div className="bb-pl">
        <span className="bb-mono typo-data text-foreground tabular-nums">{pct}%</span>
        <Meter pct={pct} />
        <span className={`bb-stamp bb-mono typo-data uppercase ${stampCls}`}>
          {done ? dl.busbar_finished : dl.busbar_due} {day ?? '--.--'}
        </span>
      </div>
    </div>
  );
});
