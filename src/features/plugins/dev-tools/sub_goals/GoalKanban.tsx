import { useCallback, useMemo, useState } from 'react';
import { User, Bot, CheckCircle2, Clock, AlertCircle, Target, Minus, Plus, Maximize2 } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { toastCatch } from '@/lib/silentCatch';
import { KanbanBoard, type KanbanColumn } from '@/features/shared/components/kanban/KanbanBoard';
import type { DevGoal } from '@/lib/bindings/DevGoal';
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

const LANE_CHROME: LaneMeta[] = [
  { id: 'your_turn', labelKey: 'your_turn', icon: User, iconColor: 'text-amber-400', borderColor: 'border-amber-500/25', bgColor: 'bg-amber-500/5', ringColor: 'ring-amber-400/50', targetStatus: 'open' },
  { id: 'agent_turn', labelKey: 'agents_turn', icon: Bot, iconColor: 'text-blue-400', borderColor: 'border-blue-500/25', bgColor: 'bg-blue-500/5', ringColor: 'ring-blue-400/50', targetStatus: 'in-progress' },
  { id: 'done', labelKey: 'done', icon: CheckCircle2, iconColor: 'text-emerald-400', borderColor: 'border-emerald-500/25', bgColor: 'bg-emerald-500/5', ringColor: 'ring-emerald-400/50', targetStatus: 'done' },
];

const PROGRESS_STEP = 5;
const DRAG_MIME = 'application/x-personas-goal-id';

// ---------------------------------------------------------------------------
// Goal card (presentational — the shared board owns drag wiring)
// ---------------------------------------------------------------------------

function GoalCard({ goal, onOpen }: { goal: DevGoal; onOpen?: () => void }) {
  const { t } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const updateGoal = useSystemStore((s) => s.updateGoal);
  const progressPct = goal.progress ?? 0;
  const [hovered, setHovered] = useState(false);

  const handleNudge = useCallback(async (delta: number) => {
    const next = Math.max(0, Math.min(100, progressPct + delta));
    if (next === progressPct) return;
    try {
      await updateGoal(goal.id, { progress: next });
    } catch (err) {
      toastCatch('Failed to update goal progress')(err);
    }
  }, [goal.id, progressPct, updateGoal]);

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
          <h4 className="typo-card-label truncate">{goal.title}</h4>
          {goal.description && (
            <p className="text-[11px] text-foreground mt-0.5 line-clamp-2">{goal.description}</p>
          )}
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

      {/* Progress bar + nudge buttons (buttons appear on hover) */}
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

      {/* Meta row — date turns red when an ongoing goal is past its target. */}
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
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main kanban — thin wrapper over the shared board
// ---------------------------------------------------------------------------

export default function GoalKanban({ onOpenGoal }: { onOpenGoal?: (id: string) => void } = {}) {
  const { t } = useTranslation();
  const dt = t.plugins.dev_tools;
  const goals = useSystemStore((s) => s.goals);
  const updateGoal = useSystemStore((s) => s.updateGoal);

  const columns: KanbanColumn[] = useMemo(
    () => LANE_CHROME.map((l) => ({
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
    [dt],
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
      items={goals}
      getItemId={(g) => g.id}
      getItemStatus={(g) => normalizeGoalStatus(g.status)}
      onItemMove={handleMove}
      dragMimeType={DRAG_MIME}
      fallbackColumnId="your_turn"
      renderCard={(g) => <GoalCard goal={g} onOpen={onOpenGoal ? () => onOpenGoal(g.id) : undefined} />}
      renderEmptyColumn={(_columnId, isDropTarget) => (
        <p className="text-[11px] text-foreground text-center py-6">
          {isDropTarget ? t.plugins.dev_lifecycle.kanban_drop_here : dt.no_goals_here}
        </p>
      )}
    />
  );
}
