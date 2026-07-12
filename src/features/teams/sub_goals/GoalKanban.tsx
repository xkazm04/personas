import { useCallback, useEffect, useMemo, useState } from 'react';
import { User, Bot, CheckCircle2, AlertCircle } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch, silentCatch } from '@/lib/silentCatch';
import { KanbanBoard, type KanbanColumn } from '@/features/shared/components/kanban/KanbanBoard';
import type { DevGoal } from '@/lib/bindings/DevGoal';
import type { DevGoalItem } from '@/lib/bindings/DevGoalItem';
import * as devApi from '@/api/devTools/devTools';
import { GOAL_STATUSES, GOAL_STATUS_META, normalizeGoalStatus, type GoalLane, type GoalStatus } from './goalStatus';
import GoalCard from './GoalCard';

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

const DRAG_MIME = 'application/x-personas-goal-id';

// ---------------------------------------------------------------------------
// Main kanban — thin wrapper over the shared board
// ---------------------------------------------------------------------------

export default function GoalKanban({
  onOpenGoal,
  showDone = false,
  showProject = false,
}: { onOpenGoal?: (id: string) => void; showDone?: boolean; showProject?: boolean } = {}) {
  const { t } = useTranslation();
  const dt = t.plugins.dev_tools;
  const goals = useSystemStore((s) => s.goals);
  const projects = useSystemStore((s) => s.projects);
  const updateGoal = useSystemStore((s) => s.updateGoal);

  // project id → name, for the cross-project origin chip.
  const projectNameById = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  );

  // The set of projects the visible goals span (one in single-project scope,
  // many in cross-project). Stable key so the item fetch only re-runs when the
  // project set actually changes.
  const projectIds = useMemo(
    () => [...new Set(goals.map((g) => g.project_id))],
    [goals],
  );
  const projectIdsKey = projectIds.slice().sort().join(',');

  // Checklist items for every visible goal — one batch query per project the
  // goals span, grouped by goal id. The card reads done/total from this map to
  // drive its completion gauge (no inline toggling; that lives in the drawer).
  const [itemsByGoal, setItemsByGoal] = useState<Map<string, DevGoalItem[]>>(new Map());

  useEffect(() => {
    if (projectIds.length === 0) {
      setItemsByGoal(new Map());
      return;
    }
    let cancelled = false;
    Promise.all(projectIds.map((pid) => devApi.listGoalItemsForProject(pid)))
      .then((lists) => {
        if (cancelled) return;
        const grouped = new Map<string, DevGoalItem[]>();
        for (const it of lists.flat()) {
          const arr = grouped.get(it.goal_id);
          if (arr) arr.push(it);
          else grouped.set(it.goal_id, [it]);
        }
        setItemsByGoal(grouped);
      })
      .catch(silentCatch('GoalKanban.loadItems'));
    return () => { cancelled = true; };
    // projectIdsKey captures the project set; goals.length captures within-project adds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectIdsKey, goals.length]);

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
          projectName={showProject ? projectNameById.get(g.project_id) : undefined}
          onOpen={onOpenGoal ? () => onOpenGoal(g.id) : undefined}
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
