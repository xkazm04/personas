import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { User, Bot, CheckCircle2, Circle, Clock, AlertCircle, Target, Minus, Plus, Maximize2, ListChecks } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { toastCatch, silentCatch } from '@/lib/silentCatch';
import { KanbanBoard, type KanbanColumn } from '@/features/shared/components/kanban/KanbanBoard';
import type { DevGoal } from '@/lib/bindings/DevGoal';
import type { DevGoalItem } from '@/lib/bindings/DevGoalItem';
import * as devApi from '@/api/devTools/devTools';
import { GoalStatusBadge } from './GoalStatusBadge';
import { GOAL_STATUSES, GOAL_STATUS_META, normalizeGoalStatus, isOngoing, type GoalLane, type GoalStatus } from './goalStatus';
import { goalAccentEdgeStyle } from './goalsTheme';

// ---------------------------------------------------------------------------
// Lanes feed the shared <KanbanBoard>. Status→lane membership comes from the
// canonical GOAL_STATUS_META.lane, so the board can't drift from the rest of
// the module. Labels resolve via i18n; chrome is lane-local.
// ---------------------------------------------------------------------------

type LaneLabelKey = 'your_turn' | 'agents_turn' | 'done';

interface LaneMeta {
  id: GoalLane;
  labelKey: LaneLabelKey;
  icon: typeof User;
  iconColor: string;
  borderColor: string;
  bgColor: string;
  ringColor: string;
  /** Canonical status written when a card is dropped into this lane. */
  targetStatus: GoalStatus;
}

// Lane backgrounds are transparent — colour lives on the cards (and the lane
// border/icon), so the board reads as cards on the page, not tinted wells.
const LANE_CHROME: LaneMeta[] = [
  { id: 'your_turn', labelKey: 'your_turn', icon: User, iconColor: 'text-amber-400', borderColor: 'border-amber-500/25', bgColor: 'bg-transparent', ringColor: 'ring-amber-400/50', targetStatus: 'open' },
  { id: 'agent_turn', labelKey: 'agents_turn', icon: Bot, iconColor: 'text-blue-400', borderColor: 'border-blue-500/25', bgColor: 'bg-transparent', ringColor: 'ring-blue-400/50', targetStatus: 'in-progress' },
  { id: 'done', labelKey: 'done', icon: CheckCircle2, iconColor: 'text-emerald-400', borderColor: 'border-emerald-500/25', bgColor: 'bg-transparent', ringColor: 'ring-emerald-400/50', targetStatus: 'done' },
];

const PROGRESS_STEP = 5;
const DRAG_MIME = 'application/x-personas-goal-id';
/** Show at most this many checklist items on a card; the rest fold into "+N more". */
const MAX_INLINE_TODOS = 3;

/** Completeness from a checklist: done / total, rounded. */
function todoProgress(items: DevGoalItem[]): number {
  if (items.length === 0) return 0;
  return Math.round((items.filter((i) => i.done).length / items.length) * 100);
}

// ---------------------------------------------------------------------------
// Goal card (presentational — the shared board owns drag wiring)
// ---------------------------------------------------------------------------

function GoalCard({
  goal,
  items,
  onOpen,
  onToggleItem,
}: {
  goal: DevGoal;
  items: DevGoalItem[];
  onOpen?: () => void;
  onToggleItem?: (itemId: string, done: boolean) => void;
}) {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const updateGoal = useSystemStore((s) => s.updateGoal);
  const [hovered, setHovered] = useState(false);

  const hasTodos = items.length > 0;
  const doneCount = useMemo(() => items.filter((i) => i.done).length, [items]);
  // Checklist drives the bar when to-dos exist; otherwise the goal's own
  // manual progress (nudged inline) is the source of truth.
  const progressPct = hasTodos ? todoProgress(items) : (goal.progress ?? 0);

  const inlineItems = items.slice(0, MAX_INLINE_TODOS);
  const extraCount = items.length - inlineItems.length;

  const handleNudge = useCallback(async (delta: number) => {
    const next = Math.max(0, Math.min(100, (goal.progress ?? 0) + delta));
    if (next === (goal.progress ?? 0)) return;
    try {
      await updateGoal(goal.id, { progress: next });
    } catch (err) {
      toastCatch('Failed to update goal progress')(err);
    }
  }, [goal.id, goal.progress, updateGoal]);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={goalAccentEdgeStyle(goal.status)}
      className="rounded-modal border border-primary/10 bg-gradient-to-br from-card/60 to-card/20 p-3 pl-3.5 transition-[border-color,box-shadow] duration-200 hover:border-primary/25 hover:shadow-elevation-2"
    >
      <div className="flex items-start gap-2">
        <Target className="w-3.5 h-3.5 text-primary/60 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          {/* Full title, wrapping — never truncated. The description lives in
              the detail drawer (open affordance / "+N more"), not on the card. */}
          <h4 className="typo-card-label leading-snug break-words">{goal.title}</h4>
        </div>
        {onOpen && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpen(); }}
            aria-label={dl.goal_open_detail}
            title={dl.goal_open_detail}
            className={[
              'shrink-0 w-5 h-5 rounded-interactive flex items-center justify-center text-foreground transition-opacity',
              hovered ? 'opacity-100 hover:bg-primary/10' : 'opacity-0 pointer-events-none',
            ].join(' ')}
          >
            <Maximize2 className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Checklist — first few to-dos as inline checkboxes; click toggles done.
          Drives the completeness bar below. "+N more" opens the detail drawer. */}
      {hasTodos && (
        <div className="mt-2 space-y-1">
          {inlineItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggleItem?.(item.id, !item.done); }}
              aria-label={item.done ? dl.goal_item_mark_undone : dl.goal_item_mark_done}
              className="group/todo flex items-start gap-1.5 w-full text-left"
            >
              {item.done ? (
                <CheckCircle2 className="mt-px w-3.5 h-3.5 shrink-0 text-emerald-400" />
              ) : (
                <Circle className="mt-px w-3.5 h-3.5 shrink-0 text-foreground/30 group-hover/todo:text-foreground/50 transition-colors" />
              )}
              <span className={[
                'text-[11px] leading-snug',
                item.done ? 'text-foreground/40 line-through' : 'text-foreground/80',
              ].join(' ')}>
                {item.title}
              </span>
            </button>
          ))}
          {extraCount > 0 && onOpen && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpen(); }}
              className="pl-5 text-[10px] text-primary/70 hover:text-primary transition-colors"
            >
              {tx(dl.goal_card_items_more, { count: extraCount })}
            </button>
          )}
        </div>
      )}

      {/* Progress: checklist-derived (read-only + count) when to-dos exist,
          otherwise the manual nudge bar. */}
      {hasTodos ? (
        <div className="mt-2 flex items-center gap-1.5">
          <div className="flex-1 h-1 bg-primary/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500/60 rounded-full transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="text-[9px] text-foreground/70 tabular-nums whitespace-nowrap">
            {tx(dl.goal_card_todos_done, { done: doneCount, total: items.length })}
          </span>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleNudge(-PROGRESS_STEP); }}
            disabled={progressPct <= 0}
            aria-label={dl.kanban_nudge_decrease}
            title={dl.kanban_nudge_decrease}
            className={[
              'shrink-0 w-4 h-4 rounded-full border border-primary/20 flex items-center justify-center transition-opacity',
              hovered && progressPct > 0 ? 'opacity-100 hover:bg-primary/10' : 'opacity-0 pointer-events-none',
            ].join(' ')}
          >
            <Minus className="w-2.5 h-2.5 text-foreground" />
          </button>
          <div className="flex-1 h-1 bg-primary/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary/50 rounded-full transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleNudge(PROGRESS_STEP); }}
            disabled={progressPct >= 100}
            aria-label={dl.kanban_nudge_increase}
            title={dl.kanban_nudge_increase}
            className={[
              'shrink-0 w-4 h-4 rounded-full border border-primary/20 flex items-center justify-center transition-opacity',
              hovered && progressPct < 100 ? 'opacity-100 hover:bg-primary/10' : 'opacity-0 pointer-events-none',
            ].join(' ')}
          >
            <Plus className="w-2.5 h-2.5 text-foreground" />
          </button>
          <span className="text-[9px] text-foreground w-7 text-right tabular-nums">{progressPct}%</span>
        </div>
      )}

      {/* Meta row — date turns red when an ongoing goal is past its target.
          A subtle "add to-dos" affordance (hover) routes authoring to the drawer. */}
      <div className="flex items-center gap-2 mt-2">
        <GoalStatusBadge status={goal.status} />
        {goal.target_date && (() => {
          const overdue = isOngoing(goal.status) && new Date(goal.target_date).getTime() < Date.now();
          return (
            <span className={`text-[9px] flex items-center gap-0.5 ${overdue ? 'text-red-400 font-medium' : 'text-foreground'}`}>
              <Clock className="w-2.5 h-2.5" />
              <RelativeTime timestamp={goal.target_date} />
            </span>
          );
        })()}
        {!hasTodos && onOpen && hovered && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpen(); }}
            className="ml-auto text-[9px] flex items-center gap-0.5 text-primary/70 hover:text-primary transition-colors"
          >
            <ListChecks className="w-2.5 h-2.5" />
            {dl.goal_card_add_todos}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main kanban — thin wrapper over the shared board
// ---------------------------------------------------------------------------

export default function GoalKanban({
  onOpenGoal,
  showDone = false,
}: { onOpenGoal?: (id: string) => void; showDone?: boolean } = {}) {
  const { t } = useTranslation();
  const dt = t.plugins.dev_tools;
  const goals = useSystemStore((s) => s.goals);
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const updateGoal = useSystemStore((s) => s.updateGoal);

  // Checklist items for every goal in the project — fetched in ONE batch query
  // (no per-card fan-out), grouped by goal id. Refetches when the project or
  // goal count changes; toggles update this map optimistically.
  const [itemsByGoal, setItemsByGoal] = useState<Map<string, DevGoalItem[]>>(new Map());
  const itemsRef = useRef(itemsByGoal);
  itemsRef.current = itemsByGoal;

  useEffect(() => {
    if (!activeProjectId || goals.length === 0) {
      setItemsByGoal(new Map());
      return;
    }
    let cancelled = false;
    devApi.listGoalItemsForProject(activeProjectId)
      .then((items) => {
        if (cancelled) return;
        const grouped = new Map<string, DevGoalItem[]>();
        for (const it of items) {
          const arr = grouped.get(it.goal_id);
          if (arr) arr.push(it);
          else grouped.set(it.goal_id, [it]);
        }
        setItemsByGoal(grouped);
      })
      .catch(silentCatch('GoalKanban.loadItems'));
    return () => { cancelled = true; };
  }, [activeProjectId, goals.length]);

  // Toggle a to-do: optimistic local flip → persist the item → recompute the
  // goal's % from the checklist and persist that too (so the Map agrees).
  const handleToggleItem = useCallback(async (goal: DevGoal, itemId: string, done: boolean) => {
    const current = itemsRef.current.get(goal.id) ?? [];
    const updated = current.map((it) => (it.id === itemId ? { ...it, done } : it));
    const pct = todoProgress(updated);
    setItemsByGoal((prev) => {
      const next = new Map(prev);
      next.set(goal.id, updated);
      return next;
    });
    try {
      await devApi.updateGoalItem(itemId, { done });
      if (pct !== (goal.progress ?? 0)) await updateGoal(goal.id, { progress: pct });
    } catch (err) {
      // Revert the optimistic flip on failure.
      setItemsByGoal((prev) => {
        const next = new Map(prev);
        next.set(goal.id, current);
        return next;
      });
      toastCatch('Failed to update to-do')(err);
    }
  }, [updateGoal]);

  // Done is opt-in (the GoalsPage toggle): hidden, "Your turn" / "Agent's
  // turn" split the full content width and titles truncate far later. Done
  // goals must also leave `items` — otherwise the board's fallback column
  // would re-bucket them into "Your turn".
  const lanes = useMemo(
    () => (showDone ? LANE_CHROME : LANE_CHROME.filter((l) => l.id !== 'done')),
    [showDone],
  );
  const visibleGoals = useMemo(
    () => (showDone ? goals : goals.filter((g) => normalizeGoalStatus(g.status) !== 'done')),
    [goals, showDone],
  );

  const columns: KanbanColumn[] = useMemo(
    () => lanes.map((l) => ({
      id: l.id,
      label: dt[l.labelKey],
      icon: l.icon,
      iconColor: l.iconColor,
      borderColor: l.borderColor,
      bgColor: l.bgColor,
      ringColor: l.ringColor,
      // Canonical statuses whose lane is this column (single source of truth).
      statuses: GOAL_STATUSES.filter((s) => GOAL_STATUS_META[s].lane === l.id),
      targetStatus: l.targetStatus,
    })),
    [dt, lanes],
  );

  const handleMove = useCallback(
    async (goalId: string, status: string) => {
      try {
        await updateGoal(goalId, { status });
      } catch (err) {
        toastCatch('Failed to move goal')(err);
      }
    },
    [updateGoal],
  );

  if (goals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <AlertCircle className="w-8 h-8 text-foreground mb-3" />
        {dt.no_goals_kanban}
      </div>
    );
  }

  return (
    <KanbanBoard<DevGoal>
      columns={columns}
      items={visibleGoals}
      getItemId={(g) => g.id}
      getItemStatus={(g) => normalizeGoalStatus(g.status)}
      onItemMove={handleMove}
      dragMimeType={DRAG_MIME}
      columnsClassName={showDone ? undefined : 'grid grid-cols-2 gap-4'}
      fallbackColumnId="your_turn"
      renderCard={(g) => (
        <GoalCard
          goal={g}
          items={itemsByGoal.get(g.id) ?? []}
          onOpen={onOpenGoal ? () => onOpenGoal(g.id) : undefined}
          onToggleItem={(itemId, done) => handleToggleItem(g, itemId, done)}
        />
      )}
      renderEmptyColumn={(_columnId, isDropTarget) => (
        <p className="text-[11px] text-foreground text-center py-6">
          {isDropTarget ? t.plugins.dev_lifecycle.kanban_drop_here : dt.no_goals_here}
        </p>
      )}
    />
  );
}
