/**
 * The right-click menu for the Progress canvas - one menu, three targets.
 *
 * Drawn at the pointer on `document.body` through the shared
 * `overlays/ContextMenu` primitive (which already owns viewport clamping,
 * dismissal and arrow-key roving focus), so a row's own `overflow-hidden` can
 * never clip it.
 *
 * The anchor holds IDS, not objects: the items are rebuilt from the live lane
 * map on every render, so a lane deleted while the menu is open disappears from
 * it instead of offering a move to a milestone that is gone.
 */
import { useCallback, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CircleOff, Flag, Plus, Target, Trash2 } from 'lucide-react';

import { ContextMenu, type ContextMenuItem } from '@/features/shared/components/overlays/ContextMenu';
import { useTranslation } from '@/i18n/useTranslation';

import type { MilestoneLane } from './milestoneOps';

export type CanvasTarget =
  /** The project row itself - where a milestone or a goal is created. */
  | { kind: 'project'; projectId: string; name: string }
  /** A milestone lane or chip - where a milestone is removed. */
  | { kind: 'milestone'; milestoneId: string; name: string }
  /** A goal frame - where a goal is re-bound. */
  | { kind: 'goal'; goalId: string; projectId: string; name: string };

export interface CanvasMenuHandlers {
  lanesByProject: ReadonlyMap<string, MilestoneLane[]> | null;
  lanesOfGoal: (goalId: string) => string[];
  onCreateMilestone: (projectId: string) => void;
  onDeleteMilestone: (milestoneId: string) => void;
  onCreateGoal: (projectId: string) => void;
  onBindGoal: (goalId: string, milestoneId: string | null) => void;
}

export interface CanvasMenu {
  /** Pass to `useMenuKey(onMenu)` so the pointer and the keyboard share a door. */
  openAt: (e: MouseEvent, target: CanvasTarget) => void;
  menu: ReactNode;
}

export function useCanvasMenu(h: CanvasMenuHandlers): CanvasMenu {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const [anchor, setAnchor] = useState<{ x: number; y: number; target: CanvasTarget } | null>(null);
  const close = useCallback(() => setAnchor(null), []);

  const openAt = useCallback((e: MouseEvent, target: CanvasTarget) => {
    e.preventDefault();
    e.stopPropagation();
    setAnchor({ x: e.clientX, y: e.clientY, target });
  }, []);

  const items = useMemo<ContextMenuItem[]>(() => {
    const target = anchor?.target;
    if (!target) return [];
    if (target.kind === 'project') {
      return [
        {
          id: 'new-milestone',
          label: t.athena.ship_milestone_confirm,
          icon: <Flag className="w-3.5 h-3.5" />,
          testId: 'canvas-menu-new-milestone',
          onSelect: () => h.onCreateMilestone(target.projectId),
        },
        {
          id: 'new-goal',
          label: dl.goal_new_title,
          icon: <Plus className="w-3.5 h-3.5" />,
          onSelect: () => h.onCreateGoal(target.projectId),
        },
      ];
    }
    if (target.kind === 'milestone') {
      return [
        {
          id: 'delete-milestone',
          label: t.common.delete,
          hint: target.name,
          danger: true,
          icon: <Trash2 className="w-3.5 h-3.5" />,
          testId: 'canvas-menu-delete-milestone',
          onSelect: () => h.onDeleteMilestone(target.milestoneId),
        },
      ];
    }
    // A goal: every lane of its own project it is not already in, then the
    // unbind. The lane name IS the label - a menu of destinations.
    const bound = new Set(h.lanesOfGoal(target.goalId));
    const lanes = h.lanesByProject?.get(target.projectId) ?? [];
    const moves: ContextMenuItem[] = lanes
      .filter((lane) => !bound.has(lane.id))
      .map((lane, i) => ({
        id: `bind-${lane.id}`,
        label: lane.name,
        icon: <Target className="w-3.5 h-3.5" />,
        separatorBefore: i === 0,
        onSelect: () => h.onBindGoal(target.goalId, lane.id),
      }));
    if (bound.size > 0) {
      moves.push({
        id: 'unbind',
        label: t.ship.unassigned,
        icon: <CircleOff className="w-3.5 h-3.5" />,
        separatorBefore: moves.length > 0,
        testId: 'canvas-menu-unbind',
        onSelect: () => h.onBindGoal(target.goalId, null),
      });
    }
    return [
      {
        id: 'new-goal',
        label: dl.goal_new_title,
        icon: <Plus className="w-3.5 h-3.5" />,
        onSelect: () => h.onCreateGoal(target.projectId),
      },
      ...(moves.length > 0
        ? moves
        : [
            {
              id: 'no-lanes',
              label: t.athena.ship_milestone_confirm,
              icon: <Flag className="w-3.5 h-3.5" />,
              separatorBefore: true,
              onSelect: () => h.onCreateMilestone(target.projectId),
            },
          ]),
    ];
  }, [anchor, h, t, dl]);

  const menu =
    anchor && items.length > 0
      ? createPortal(
          <ContextMenu
            x={anchor.x}
            y={anchor.y}
            onClose={close}
            ariaLabel={tx(t.ship.bind_aria, { name: anchor.target.name })}
            widthClass="w-60"
            items={items}
          />,
          document.body,
        )
      : null;

  return { openAt, menu };
}
