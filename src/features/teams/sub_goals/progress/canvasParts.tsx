/**
 * The canvas parts every variant composes: a goal frame that can be dragged and
 * right-clicked, a milestone lane that can be dropped onto and right-clicked,
 * and the explicit button that creates one.
 *
 * Every pointer gesture here has a keyboard route. Right-click opens through
 * `useMenuKey` (Shift+F10 / the Menu key, dispatched as a real `contextmenu` at
 * the element's own box, so there is one handler and not two), and a re-bind is
 * reachable from that menu as a list of destinations. A drag is therefore an
 * ACCELERATOR for a move that is already reachable without a pointer, which is
 * the only shape in which drag-and-drop is allowed to be the headline gesture.
 */
import { Flag, Plus } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import { GoalSquare, NODE_PX, type DevLifecycleT } from '../progressShared';
import { useProgressView } from './canvasHost';
import type { MilestoneLane } from './milestoneOps';
import { laneTone, useMenuKey } from './rowCanvas';
import type { ProgressNode } from './useProgressModel';

/**
 * One goal, draggable and right-clickable.
 *
 * `GoalSquare` is untouched: it already owns the status fill, the progress bar,
 * the overdue ring and the memoized done-filter CSS, and it is mounted hundreds
 * of times per view. The canvas behaviour is a WRAPPER so that cost model
 * stays exactly as measured.
 */
export function CanvasFrame({
  node,
  projectId,
  dl,
  bound,
  laneStatus,
}: {
  node: ProgressNode;
  projectId: string;
  dl: DevLifecycleT;
  /** Bound to at least one milestone - drawn as a flag on the frame. */
  bound: boolean;
  /** Cut state of the milestone it is bound to, for the flag's tone. */
  laneStatus: string | null;
  }) {
  const { canvas, openGoal } = useProgressView();
  const { onKeyDown, onContextMenu } = useMenuKey((e) =>
    canvas.openMenu(e, { kind: 'goal', goalId: node.goal.id, projectId, name: node.goal.title }),
  );
  const dragging = canvas.drag.draggingId === node.goal.id;
  const tone = bound ? laneTone(laneStatus ?? 'planned') : null;

  return (
    <span
      className={`relative inline-flex transition-opacity ${dragging ? 'opacity-40' : ''}`}
      draggable
      onDragStart={(e) => canvas.drag.onDragStart(e, node.goal.id)}
      onDragEnd={canvas.drag.onDragEnd}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
    >
      <GoalSquare goal={node.goal} overdue={node.overdue} delay={node.delay} dl={dl} onOpen={openGoal} />
      {tone && (
        <span
          aria-hidden="true"
          className={`absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-1 rounded-full ${tone.icon}`}
        />
      )}
    </span>
  );
}

/**
 * A milestone as a drop target with a name.
 *
 * The count is the lane's own goals, not a percentage: progress on a cut is
 * derived from exit criteria in the Ship tab, and a second, cheaper number here
 * would be a second answer to the same question.
 */
export function LaneChip({
  lane,
  count,
  dense,
  asDropTarget = true,
}: {
  lane: MilestoneLane;
  count: number;
  /** Chip form (the filmstrip legend) instead of a lane header. */
  dense?: boolean;
  /**
   * False when an ANCESTOR is the drop target for the same lane - two nested
   * handlers on one key would fire `onBind` twice for a single drop, since the
   * inner one bubbles.
   */
  asDropTarget?: boolean;
}) {
  const { canvas } = useProgressView();
  const { onKeyDown, onContextMenu } = useMenuKey((e) =>
    canvas.openMenu(e, { kind: 'milestone', milestoneId: lane.id, name: lane.name }),
  );
  const tone = laneTone(lane.status);
  const over = canvas.drop.overKey === lane.id;
  return (
    <span
      {...(asDropTarget ? canvas.drop.propsFor(lane.id, lane.id) : {})}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="group"
      aria-label={lane.name}
      data-testid={`progress-lane-${lane.id}`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 focus-ring transition-colors ${tone.border} ${
        over ? `${tone.bg} ring-1 ring-inset ${tone.border}` : 'bg-card/40'
      } ${dense ? '' : 'px-2.5 py-1'}`}
    >
      <Flag className={`w-3 h-3 shrink-0 ${tone.text}`} aria-hidden />
      <span className={`typo-caption truncate ${dense ? 'max-w-[11rem]' : 'max-w-[14rem]'} ${tone.text}`}>
        {lane.name}
      </span>
      <span className="typo-caption text-foreground tabular-nums">{count}</span>
    </span>
  );
}

/**
 * The unassigned lane: goals bound to no cut. It is a real drop target, because
 * un-binding has to be as easy as binding or the canvas is a one-way door.
 */
export function UnassignedLane({ projectId, count, children }: {
  projectId: string;
  count: number;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { canvas } = useProgressView();
  const key = `${projectId}:none`;
  const over = canvas.drop.overKey === key;
  return (
    <div
      {...canvas.drop.propsFor(key, null)}
      data-testid={`progress-lane-none-${projectId}`}
      className={`flex items-center gap-1.5 rounded-input border border-dashed px-2 py-1 transition-colors ${
        over ? 'border-primary/40 bg-primary/[0.06]' : 'border-primary/15'
      }`}
      style={{ minHeight: NODE_PX + 8 }}
    >
      <span className="typo-eyebrow text-foreground shrink-0">
        {t.ship.unassigned}
      </span>
      <span className="typo-caption text-foreground tabular-nums shrink-0">{count}</span>
      {children}
    </div>
  );
}

/** The non-right-click route to a new milestone. A gesture only reachable by
 *  right-click is not reachable; this is the same action with an affordance. */
export function AddLaneButton({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const { canvas } = useProgressView();
  return (
    <Tooltip content={t.athena.ship_milestone_confirm}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t.athena.ship_milestone_confirm}
        data-testid={`progress-add-lane-${projectId}`}
        onClick={() => canvas.startCreateMilestone(projectId)}
        className="border border-dashed border-primary/25 hover:border-primary/50"
      >
        <Plus className="w-3 h-3" />
      </Button>
    </Tooltip>
  );
}
